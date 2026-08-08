import type { Redis } from 'ioredis';
import type { Logger } from '@carbon/core';
import { makeId, NotFoundError, CarbonError } from '@carbon/core';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'needs_review';

export interface JobRecord {
  readonly id: string;
  readonly kind: string;
  readonly orgId?: string;
  readonly status: JobStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly result?: unknown;
  readonly error?: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  /** Epoch-ms of the next retry attempt, or null if not currently retryable. */
  readonly nextAttemptAt: number | null;
  readonly deadLetter: boolean;
}

/**
 * Redis-backed job status tracker.
 *
 * The tracker now owns retry/backoff/DLQ bookkeeping so an operator can see —
 * and a retry poller can act on — the full picture without cracking open
 * BullMQ internals. When a job is marked `failed`:
 *
 *   - `attempts` (incremented on the running-transition) is checked against
 *     `maxAttempts`.
 *   - If room remains, the record stays `failed` but gets a
 *     `nextAttemptAt = now + backoffMs(attempts)` (capped at 5min).
 *     A separate poller (see `apps/workers/src/job-retry-worker.ts`) picks
 *     these up and re-enqueues them.
 *   - Otherwise `deadLetter = true` and the record is left alone.
 *
 * Keys expire after 24h. Move to Postgres if you need longer retention.
 */
export interface JobService {
  create(kind: string, meta?: Record<string, unknown>): Promise<JobRecord>;
  get(id: string): Promise<JobRecord>;
  update(
    id: string,
    patch: { status: JobStatus; result?: unknown; error?: string },
  ): Promise<JobRecord>;
  /**
   * Reset a `failed` (non-dead-letter) job back to `queued`. Used by the
   * retry poller and by the manual retry endpoint. No-ops on `succeeded` and
   * throws `CARBON_STATE_VIOLATION` on `deadLetter=true` — a dead letter is
   * dead on purpose, not a stalled retry.
   */
  retry(id: string): Promise<JobRecord>;
  /**
   * Scan for jobs eligible for automatic retry (failed, not dead-letter,
   * nextAttemptAt <= now). Bounded scan so this stays cheap on large keyspaces.
   */
  listRetryable(limit?: number): Promise<JobRecord[]>;
}

const TTL_SEC = 60 * 60 * 24;
const PREFIX = 'carbon:job';
const DEFAULT_MAX_ATTEMPTS = 5;
const MAX_BACKOFF_MS = 5 * 60 * 1000;

/**
 * Exponential backoff with full jitter, capped at 5 minutes.
 *
 *   base = min(2^attempts * 1000ms, 5min)
 *   next = uniform(0.5x, 1.5x) * base
 */
export function backoffMs(attempts: number): number {
  const base = Math.min(2 ** Math.max(0, attempts) * 1000, MAX_BACKOFF_MS);
  const jitter = base * (0.5 + Math.random());
  return Math.min(Math.floor(jitter), MAX_BACKOFF_MS);
}

function hydrate(row: Record<string, string>): JobRecord {
  return {
    id: row.id ?? '',
    kind: row.kind ?? '',
    orgId: row.orgId || undefined,
    status: (row.status ?? 'queued') as JobStatus,
    createdAt: Number(row.createdAt ?? 0),
    updatedAt: Number(row.updatedAt ?? 0),
    result: row.result ? JSON.parse(row.result) : undefined,
    error: row.error || undefined,
    attempts: Number(row.attempts ?? 0),
    maxAttempts: Number(row.maxAttempts ?? DEFAULT_MAX_ATTEMPTS),
    nextAttemptAt: row.nextAttemptAt ? Number(row.nextAttemptAt) : null,
    deadLetter: row.deadLetter === '1',
  };
}

export function createJobService(deps: {
  redis: Redis;
  logger: Logger;
  maxAttempts?: number;
}): JobService {
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  async function fetchRow(id: string): Promise<Record<string, string>> {
    const row = await deps.redis.hgetall(`${PREFIX}:${id}`);
    if (!row || !row.id) throw new NotFoundError('job', id);
    return row;
  }

  return {
    async create(kind, meta) {
      const id = makeId('job');
      const now = Date.now();
      const orgId = typeof meta?.orgId === 'string' ? meta.orgId : undefined;
      const fields: Record<string, string> = {
        id,
        kind,
        status: 'queued',
        createdAt: String(now),
        updatedAt: String(now),
        attempts: '0',
        maxAttempts: String(maxAttempts),
        deadLetter: '0',
        meta: meta ? JSON.stringify(meta) : '',
      };
      if (orgId) fields.orgId = orgId;
      await deps.redis
        .multi()
        .hset(`${PREFIX}:${id}`, fields)
        .expire(`${PREFIX}:${id}`, TTL_SEC)
        .exec();
      return {
        id,
        kind,
        orgId,
        status: 'queued',
        createdAt: now,
        updatedAt: now,
        attempts: 0,
        maxAttempts,
        nextAttemptAt: null,
        deadLetter: false,
      };
    },

    async get(id) {
      return hydrate(await fetchRow(id));
    },

    async update(id, patch) {
      const now = Date.now();
      const existing = hydrate(await fetchRow(id));
      const fields: Record<string, string> = {
        status: patch.status,
        updatedAt: String(now),
      };
      if (patch.result !== undefined) fields.result = JSON.stringify(patch.result);
      if (patch.error !== undefined) fields.error = patch.error;

      let attempts = existing.attempts;
      let nextAttemptAt: number | null = existing.nextAttemptAt;
      let deadLetter = existing.deadLetter;
      let clearNext = false;

      if (patch.status === 'running' && existing.status !== 'running') {
        // Attempts are counted at start — that's when work actually happens,
        // and it lets update('failed') decide DLQ purely on the counter.
        attempts += 1;
        fields.attempts = String(attempts);
        clearNext = true;
        nextAttemptAt = null;
      } else if (patch.status === 'failed') {
        if (attempts >= existing.maxAttempts) {
          deadLetter = true;
          fields.deadLetter = '1';
          clearNext = true;
          nextAttemptAt = null;
        } else {
          const delay = backoffMs(attempts);
          nextAttemptAt = now + delay;
          fields.nextAttemptAt = String(nextAttemptAt);
        }
      } else if (patch.status === 'succeeded') {
        clearNext = true;
        nextAttemptAt = null;
      }

      const multi = deps.redis.multi().hset(`${PREFIX}:${id}`, fields);
      if (clearNext) multi.hdel(`${PREFIX}:${id}`, 'nextAttemptAt');
      multi.expire(`${PREFIX}:${id}`, TTL_SEC);
      await multi.exec();

      return {
        ...existing,
        status: patch.status,
        updatedAt: now,
        attempts,
        nextAttemptAt,
        deadLetter,
        result: patch.result !== undefined ? patch.result : existing.result,
        error: patch.error !== undefined ? patch.error : existing.error,
      };
    },

    async retry(id) {
      const existing = hydrate(await fetchRow(id));
      if (existing.deadLetter) {
        throw new CarbonError({
          code: 'CARBON_STATE_VIOLATION',
          message: 'Job is dead-lettered — retries exhausted',
          details: { id, attempts: existing.attempts, maxAttempts: existing.maxAttempts },
          expose: true,
        });
      }
      if (existing.status === 'succeeded' || existing.status === 'running') {
        return existing;
      }
      const now = Date.now();
      await deps.redis
        .multi()
        .hset(`${PREFIX}:${id}`, {
          status: 'queued',
          updatedAt: String(now),
        })
        .hdel(`${PREFIX}:${id}`, 'nextAttemptAt', 'error')
        .expire(`${PREFIX}:${id}`, TTL_SEC)
        .exec();
      return {
        ...existing,
        status: 'queued',
        updatedAt: now,
        nextAttemptAt: null,
        error: undefined,
      };
    },

    async listRetryable(limit = 100) {
      const now = Date.now();
      const out: JobRecord[] = [];
      // SCAN keeps this bounded per call; the poller runs every 15s so we do
      // not need a secondary sorted-set index for the volumes we ship with.
      let cursor = '0';
      do {
        const [next, keys] = await deps.redis.scan(
          cursor,
          'MATCH',
          `${PREFIX}:*`,
          'COUNT',
          200,
        );
        cursor = next;
        for (const key of keys) {
          const row = await deps.redis.hgetall(key);
          if (!row?.id) continue;
          const rec = hydrate(row);
          if (
            rec.status === 'failed' &&
            !rec.deadLetter &&
            rec.nextAttemptAt !== null &&
            rec.nextAttemptAt <= now &&
            rec.attempts < rec.maxAttempts
          ) {
            out.push(rec);
            if (out.length >= limit) return out;
          }
        }
      } while (cursor !== '0' && out.length < limit);
      return out;
    },
  };
}
