import type { Redis } from 'ioredis';
import type { Logger } from '@carbon/core';
import { makeId, NotFoundError } from '@carbon/core';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface JobRecord {
  readonly id: string;
  readonly kind: string;
  readonly orgId?: string;
  readonly status: JobStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly result?: unknown;
  readonly error?: string;
}

/**
 * Redis-backed job status tracker. Async endpoints create a job, enqueue the
 * unit of work, and return the job id. The worker updates status as it moves
 * through the pipeline. Clients poll GET /v1/jobs/:id for terminal state.
 *
 * Keys expire after 24h — status is not durable audit history; it's for
 * clients to observe progress. Move to Postgres if you want longer retention.
 */
export interface JobService {
  create(kind: string, meta?: Record<string, unknown>): Promise<JobRecord>;
  get(id: string): Promise<JobRecord>;
  update(id: string, patch: { status: JobStatus; result?: unknown; error?: string }): Promise<void>;
}

const TTL_SEC = 60 * 60 * 24;
const PREFIX = 'carbon:job';

export function createJobService(deps: { redis: Redis; logger: Logger }): JobService {
  return {
    async create(kind, meta) {
      const id = makeId('job');
      const now = Date.now();
      const orgId = typeof meta?.orgId === 'string' ? meta.orgId : undefined;
      const record: JobRecord = {
        id,
        kind,
        orgId,
        status: 'queued',
        createdAt: now,
        updatedAt: now,
      };
      const fields: Record<string, string> = {
        id,
        kind,
        status: 'queued',
        createdAt: String(now),
        updatedAt: String(now),
        meta: meta ? JSON.stringify(meta) : '',
      };
      if (orgId) fields.orgId = orgId;
      await deps.redis
        .multi()
        .hset(`${PREFIX}:${id}`, fields)
        .expire(`${PREFIX}:${id}`, TTL_SEC)
        .exec();
      return record;
    },

    async get(id) {
      const row = await deps.redis.hgetall(`${PREFIX}:${id}`);
      if (!row || !row.id) throw new NotFoundError('job', id);
      return {
        id: row.id,
        kind: row.kind ?? '',
        orgId: row.orgId || undefined,
        status: (row.status ?? 'queued') as JobStatus,
        createdAt: Number(row.createdAt ?? 0),
        updatedAt: Number(row.updatedAt ?? 0),
        result: row.result ? JSON.parse(row.result) : undefined,
        error: row.error || undefined,
      };
    },

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
