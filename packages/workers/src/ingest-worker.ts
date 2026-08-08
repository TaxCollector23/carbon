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

export interface RegisterIngestWorkerOptions {
  readonly connection: Redis;
  readonly ingestion: IngestionRunner;
  readonly jobs: IngestJobStatusWriter;
  readonly logger: Logger;
  /** Max jobs processed in parallel by this worker. Defaults to 4. */
  readonly concurrency?: number;
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

  worker.on('failed', (job, err) => {
    logger.warn('ingest.worker.attempt_failed', {
      jobId: job?.id,
      attemptsMade: job?.attemptsMade,
      message: err.message,
    });
  });

  logger.info('ingest.worker.ready', { queue: INGEST_QUEUE_NAME, concurrency });
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
