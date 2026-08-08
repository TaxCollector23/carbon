import { Queue, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from '@carbon/core';

/**
 * Shared ingestion queue + worker plumbing.
 *
 * The API enqueues an ingest job here; either a standalone `apps/workers`
 * process or the API itself (when `EMBED_WORKERS=true`) processes it. The
 * worker is intentionally decoupled from Fastify — its only dependencies are
 * an `IngestionPipeline`-shaped callable, a job status writer, and a Redis
 * connection.
 */

export const INGEST_QUEUE_NAME = 'carbon.ingest';

export interface IngestJobSource {
  readonly kind: 'json' | 'text';
  // `unknown` is optional-by-default in zod's inferred type, so mirror that.
  readonly content?: unknown;
  readonly hint?: string;
}

export interface IngestJobPayload {
  /** ID of the JobService status record — the worker writes progress here. */
  readonly statusJobId: string;
  readonly orgId?: string;
  /** Storage-scoped slug (e.g. `orgId/slug`) — what the pipeline uses on disk. */
  readonly projectSlug: string;
  /** Public project slug, retained for observability. */
  readonly publicSlug?: string;
  readonly source: IngestJobSource;
  readonly origin?: string;
  readonly enrich?: boolean;
}

export interface IngestJobResult {
  readonly irId: string;
  readonly graphId: string;
  readonly api: unknown;
  readonly endpoints: number;
  readonly resources: number;
  readonly warnings: readonly string[];
}

/**
 * Minimum surface the ingest worker needs from the API's JobService. Kept
 * narrow so `apps/workers` doesn't have to import Fastify or Drizzle just to
 * write status hashes.
 */
export interface IngestJobStatusWriter {
  update(
    id: string,
    patch: { status: 'running' | 'succeeded' | 'failed'; result?: unknown; error?: string },
  ): Promise<void>;
}

export interface IngestionRunner {
  // Kept structurally compatible with `@carbon/ingestion`'s `IngestionPipeline`
  // without importing it (which would tug the parser/graph deps into workers).
  ingest(input: {
    projectSlug: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input: any;
    origin?: string;
    enrich?: boolean;
  }): Promise<{
    irId: string;
    graphId: string;
    ir: { api: unknown; endpoints: readonly unknown[]; resources: readonly unknown[] };
    warnings: readonly string[];
  }>;
}

export interface CreateIngestionQueueOptions {
  readonly connection: Redis;
}

/**
 * Build the ingestion queue with the retry/retention policy every enqueuer
 * should share. Callers get a plain BullMQ `Queue` back so they can inspect
 * or add jobs as needed.
 */
export function createIngestionQueue(opts: CreateIngestionQueueOptions): Queue<IngestJobPayload> {
  return new Queue<IngestJobPayload>(INGEST_QUEUE_NAME, {
    connection: opts.connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  });
}

/**
 * Callback surface the worker uses to report timing/outcome to whatever metrics
 * system the host process happens to run. Kept as a plain interface so
 * `packages/workers` never has to depend on prom-client — the API wires a
 * prom-backed implementation, and the standalone worker can ignore it.
 */
export interface IngestMetricsSink {
  /** Delta the local process should apply to its "active jobs" gauge. */
  onActiveDelta(delta: number): void;
  /** Called once per terminal job outcome (after all retries are exhausted). */
  onJobResult(input: { outcome: 'succeeded' | 'failed'; durationMs: number }): void;
}

export interface RegisterIngestWorkerOptions {
  readonly connection: Redis;
  readonly ingestion: IngestionRunner;
  readonly jobs: IngestJobStatusWriter;
  readonly logger: Logger;
  /** Max jobs processed in parallel by this worker. Defaults to 4. */
  readonly concurrency?: number;
  /** Optional metrics hook — see {@link IngestMetricsSink}. */
  readonly metrics?: IngestMetricsSink;
  /**
   * Redis URL, logged with credentials redacted so operators can tell which
   * Redis a given worker attached to. Never log the raw URL.
   */
  readonly redisUrl?: string;
}

/**
 * Strip credentials from a Redis URL so it's safe to log. Uses WHATWG URL
 * parsing rather than a regex — the shape of a userinfo section is subtle
 * (percent-encoding, empty-user forms like `redis://:pw@host`, IPv6 hosts).
 */
export function redactRedisUrl(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    if (url.password || url.username) {
      url.password = '';
      url.username = '';
    }
    return url.toString();
  } catch {
    return 'invalid-url';
  }
}

/**
 * Register a BullMQ worker for the ingestion queue.
 *
 * Progress transitions are mirrored to the status record so the existing
 * `GET /v1/jobs/:id` polling API keeps working. Errors bubble up so BullMQ's
 * own retry/backoff policy kicks in; the final failure is what the client
 * sees on the status hash.
 */
export function registerIngestWorker(opts: RegisterIngestWorkerOptions): Worker<
  IngestJobPayload,
  IngestJobResult
> {
  const concurrency = opts.concurrency ?? 4;
  const logger = opts.logger.child({ component: 'ingest-worker' });
  const metrics = opts.metrics;
  // Per-job start times so `completed`/`failed` events can compute duration
  // without smuggling wall-clocks through the job payload.
  const startedAt = new Map<string, number>();

  const worker = new Worker<IngestJobPayload, IngestJobResult>(
    INGEST_QUEUE_NAME,
    async (job: Job<IngestJobPayload>) => {
      const { statusJobId, projectSlug, source, origin, enrich } = job.data;
      logger.info('ingest.worker.start', { statusJobId, jobId: job.id, projectSlug });
      await opts.jobs.update(statusJobId, { status: 'running' });
      try {
        const result = await opts.ingestion.ingest({
          projectSlug,
          input: source,
          origin,
          enrich,
        });
        const summary: IngestJobResult = {
          irId: result.irId,
          graphId: result.graphId,
          api: result.ir.api,
          endpoints: result.ir.endpoints.length,
          resources: result.ir.resources.length,
          warnings: result.warnings,
        };
        await opts.jobs.update(statusJobId, { status: 'succeeded', result: summary });
        logger.info('ingest.worker.done', { statusJobId, jobId: job.id });
        return summary;
      } catch (err) {
        const message = (err as Error).message;
        logger.error('ingest.worker.failed', { statusJobId, jobId: job.id, message });
        // Only mark the status record as `failed` once BullMQ has exhausted
        // its retries — otherwise a client polling the record would see
        // `failed` between attempts and give up prematurely.
        if ((job.attemptsMade ?? 0) + 1 >= (job.opts.attempts ?? 1)) {
          await opts.jobs.update(statusJobId, { status: 'failed', error: message });
        }
        throw err;
      }
    },
    { connection: opts.connection, concurrency },
  );

  worker.on('active', (job) => {
    if (job.id) startedAt.set(job.id, Date.now());
    metrics?.onActiveDelta(1);
    logger.info('ingest.worker.active', {
      jobId: job.id,
      kind: job.name,
      statusJobId: job.data?.statusJobId,
    });
  });

  worker.on('completed', (job) => {
    metrics?.onActiveDelta(-1);
    const start = job.id ? startedAt.get(job.id) : undefined;
    const durationMs = start === undefined ? 0 : Date.now() - start;
    if (job.id) startedAt.delete(job.id);
    metrics?.onJobResult({ outcome: 'succeeded', durationMs });
    logger.info('ingest.worker.completed', {
      jobId: job.id,
      kind: job.name,
      durationMs,
    });
  });

  worker.on('failed', (job, err) => {
    metrics?.onActiveDelta(-1);
    const start = job?.id ? startedAt.get(job.id) : undefined;
    const durationMs = start === undefined ? 0 : Date.now() - start;
    // Terminal failure = attempts exhausted. Only then does the metric fire
    // as `failed`; a retryable attempt is not a job outcome.
    const attemptsMade = (job?.attemptsMade ?? 0) + 1;
    const totalAttempts = job?.opts?.attempts ?? 1;
    const terminal = attemptsMade >= totalAttempts;
    if (terminal) {
      if (job?.id) startedAt.delete(job.id);
      metrics?.onJobResult({ outcome: 'failed', durationMs });
    }
    logger.warn('ingest.worker.attempt_failed', {
      jobId: job?.id,
      kind: job?.name,
      attemptsMade,
      totalAttempts,
      terminal,
      durationMs,
      message: err.message,
    });
  });

  logger.info('ingest.worker.ready', {
    queue: INGEST_QUEUE_NAME,
    concurrency,
    redisUrl: redactRedisUrl(opts.redisUrl),
  });
  return worker;
}

/**
 * Redis-backed implementation of `IngestJobStatusWriter` that writes the same
 * hash schema as `apps/api/src/services/jobs.ts`. Used by `apps/workers`
 * where the API's JobService isn't directly available.
 */
export function createRedisIngestJobStatusWriter(deps: { redis: Redis }): IngestJobStatusWriter {
  const PREFIX = 'carbon:job';
  const TTL_SEC = 60 * 60 * 24;
  return {
    async update(id, patch) {
      const now = Date.now();
      const fields: Record<string, string> = {
        status: patch.status,
        updatedAt: String(now),
      };
      if (patch.result !== undefined) fields.result = JSON.stringify(patch.result);
      if (patch.error !== undefined) fields.error = patch.error;
      await deps.redis
        .multi()
        .hset(`${PREFIX}:${id}`, fields)
        .expire(`${PREFIX}:${id}`, TTL_SEC)
        .exec();
    },
  };
}
