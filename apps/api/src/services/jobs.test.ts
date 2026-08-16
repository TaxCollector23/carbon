import { describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import { NoopLogger } from '@carbon/core';
import { createJobService } from './jobs.js';

function makeRedisStub(): { redis: Redis; hashes: Map<string, Record<string, string>> } {
  const hashes = new Map<string, Record<string, string>>();

  function multi() {
    const ops: Array<() => void> = [];
    const chain = {
      hset(key: string, fields: Record<string, string>) {
        ops.push(() => {
          hashes.set(key, { ...(hashes.get(key) ?? {}), ...fields });
        });
        return chain;
      },
      hdel(key: string, ...fields: string[]) {
        ops.push(() => {
          const row = hashes.get(key);
          if (!row) return;
          for (const field of fields) delete row[field];
        });
        return chain;
      },
      expire(_key: string, _ttl: number) {
        return chain;
      },
      async exec() {
        for (const op of ops) op();
        return [];
      },
    };
    return chain;
  }

  const redis = {
    hgetall: async (key: string) => hashes.get(key) ?? {},
    scan: async () => ['0', [...hashes.keys()]],
    multi,
  } as unknown as Redis;

  return { redis, hashes };
}

describe('createJobService', () => {
  it('lets create metadata derive from the generated job id in one write', async () => {
    const { redis } = makeRedisStub();
    const jobs = createJobService({ redis, logger: NoopLogger });

    const job = await jobs.create('ingest', (id) => ({
      orgId: 'org_1',
      payload: {
        statusJobId: id,
        projectSlug: 'org_1/acme',
        source: { kind: 'json', content: { openapi: '3.0.0' } },
      },
    }));

    expect(job.orgId).toBe('org_1');
    expect(job.meta?.payload).toMatchObject({ statusJobId: job.id });
    await expect(jobs.get(job.id)).resolves.toMatchObject({
      id: job.id,
      meta: { payload: { statusJobId: job.id } },
    });
  });

  it('does not let corrupted JSON fields break job reads or lists', async () => {
    const { redis, hashes } = makeRedisStub();
    const jobs = createJobService({ redis, logger: NoopLogger });
    const job = await jobs.create('ingest', { orgId: 'org_1' });
    const row = hashes.get(`carbon:job:${job.id}`)!;
    row.meta = '{';
    row.result = '{';

    const read = await jobs.get(job.id);
    expect(read.meta).toBeUndefined();
    expect(read.result).toBeUndefined();

    const listed = await jobs.list({ orgId: 'org_1' });
    expect(listed.data).toHaveLength(1);
    expect(listed.data[0]?.id).toBe(job.id);
  });
});
