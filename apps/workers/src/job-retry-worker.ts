import type { Logger } from '@carbon/core';
import type { IngestJobPayload, createIngestionQueue, createRedisConnection } from '@carbon/workers';

type IngestQueue = ReturnType<typeof createIngestionQueue>;
type RedisConn = ReturnType<typeof createRedisConnection>;

/**
 * Periodically re-enqueues jobs the ingest worker gave up on after a single
 * attempt but whose backoff window has now elapsed.
 *
 * Two hard requirements:
 *   - Read the same Redis hashes the API writes (see `apps/api/src/services/jobs.ts`).
 *   - Never double-fire — the job service resets `status='queued'` and clears
 *     `nextAttemptAt` atomically before the queue push, so a concurrent poller
 *     tick sees no candidate.
 *
 * The retryable set is discovered via SCAN — cheap at the volumes we ship
 * with, and it keeps the workers process out of the API's JobService.
 */

const PREFIX = 'carbon:job';
const DEFAULT_INTERVAL_MS = 15_000;

export interface JobRetryWorkerOptions {
  readonly redis: RedisConn;
  readonly ingestionQueue: IngestQueue;
  readonly logger: Logger;
  readonly intervalMs?: number;
  /** Cap on jobs re-enqueued per tick — keeps a burst from stampeding. */
  readonly batchSize?: number;
}

export interface JobRetryWorkerHandle {
  stop(): void;
}

interface StoredJob {
  id: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: number | null;
  deadLetter: boolean;
  meta: Record<string, unknown> | undefined;
}

function parseRow(row: Record<string, string>): StoredJob | null {
  if (!row?.id) return null;
  let meta: Record<string, unknown> | undefined;
  if (row.meta) {
    try {
      meta = JSON.parse(row.meta) as Record<string, unknown>;
    } catch {
      meta = undefined;
    }
  }
  return {
    id: row.id,
    status: row.status ?? 'queued',
    attempts: Number(row.attempts ?? 0),
    maxAttempts: Number(row.maxAttempts ?? 0),
    nextAttemptAt: row.nextAttemptAt ? Number(row.nextAttemptAt) : null,
    deadLetter: row.deadLetter === '1',
    meta,
  };
}

export function startJobRetryWorker(opts: JobRetryWorkerOptions): JobRetryWorkerHandle {
  const interval = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const batchSize = opts.batchSize ?? 50;
  const logger = opts.logger.child({ component: 'job-retry-worker' });
  let stopped = false;

  async function tick(): Promise<void> {
    if (stopped) return;
    const now = Date.now();
    const eligible: StoredJob[] = [];
    let cursor = '0';
    try {
      do {
        const [next, keys] = await opts.redis.scan(
          cursor,
          'MATCH',
          `${PREFIX}:*`,
          'COUNT',
          200,
        );
        cursor = next;
        for (const key of keys) {
          const row = await opts.redis.hgetall(key);
          const parsed = parseRow(row);
          if (!parsed) continue;
          if (
            parsed.status === 'failed' &&
            !parsed.deadLetter &&
            parsed.nextAttemptAt !== null &&
            parsed.nextAttemptAt <= now &&
            parsed.attempts < parsed.maxAttempts
          ) {
            eligible.push(parsed);
            if (eligible.length >= batchSize) break;
          }
        }
      } while (cursor !== '0' && eligible.length < batchSize);
    } catch (err) {
      logger.warn('job_retry.scan_failed', { message: (err as Error).message });
      return;
    }

    for (const job of eligible) {
      if (stopped) return;
      try {
        // Reset status BEFORE re-enqueueing so the worker's start-transition
        // is what increments `attempts`. Order matters — a queue push that
        // races the state reset would either double-fire or leak an attempt.
        await opts.redis
          .multi()
          .hset(`${PREFIX}:${job.id}`, { status: 'queued', updatedAt: String(Date.now()) })
          .hdel(`${PREFIX}:${job.id}`, 'nextAttemptAt', 'error')
          .exec();

        const meta = job.meta ?? {};
        const payload = meta.payload as IngestJobPayload | undefined;
        if (payload && typeof payload === 'object') {
          await opts.ingestionQueue.add('ingest', payload, {
            jobId: `${job.id}:retry:${job.attempts}`,
          });
          logger.info('job_retry.enqueued', {
            id: job.id,
            attempts: job.attempts,
          });
        } else {
          // No payload snapshot — the API didn't record enough context to
          // re-enqueue. Log so the operator can decide whether to add it.
          logger.warn('job_retry.no_payload', { id: job.id });
        }
      } catch (err) {
        logger.warn('job_retry.enqueue_failed', {
          id: job.id,
          message: (err as Error).message,
        });
      }
    }
  }

  const timer = setInterval(() => {
    void tick();
  }, interval);
  timer.unref();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
