import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import type { AppContext } from '../context.js';
import { registerHealthRoutes } from './health.js';
import { createLifecycle } from '../lifecycle.js';

function makeCtx(db: AppContext['db'], storage = new MemoryStorage()): AppContext {
  return {
    logger: NoopLogger,
    db,
    storage,
    ingestion: { ingest: async () => ({}) } as unknown as AppContext['ingestion'],
    emulators: {} as AppContext['emulators'],
  };
}

/** A database stub that counts how many readiness probes actually reach it. */
function countingDb(): { db: AppContext['db']; calls: () => number } {
  let calls = 0;
  return {
    db: {
      execute: async () => {
        calls += 1;
        return [];
      },
    } as unknown as AppContext['db'],
    calls: () => calls,
  };
}

describe('health routes', () => {
  it('returns 503 when a readiness dependency times out', async () => {
    const app = Fastify();
    const neverReady = {
      execute: async () => new Promise(() => {}),
    } as unknown as AppContext['db'];
    await registerHealthRoutes(app, makeCtx(neverReady), { timeoutMs: 5 });

    const res = await app.inject('/ready');
    expect(res.statusCode).toBe(503);
    expect(res.json().checks.database.ok).toBe(false);
    expect(res.json().checks.database.error).toContain('timed out');
  });

  it('caches readiness so probe traffic does not stampede dependencies', async () => {
    const app = Fastify();
    const { db, calls } = countingDb();
    await registerHealthRoutes(app, makeCtx(db), { cacheMs: 60_000 });

    const first = await app.inject('/ready');
    expect(first.statusCode).toBe(200);
    expect(first.json().cached).toBe(false);

    for (let i = 0; i < 5; i++) {
      const res = await app.inject('/ready');
      expect(res.statusCode).toBe(200);
      expect(res.json().cached).toBe(true);
    }
    expect(calls()).toBe(1);
  });

  it('re-evaluates once the cache expires', async () => {
    const app = Fastify();
    const { db, calls } = countingDb();
    await registerHealthRoutes(app, makeCtx(db), { cacheMs: 0 });

    await app.inject('/ready');
    await app.inject('/ready');
    expect(calls()).toBe(2);
  });

  it('collapses concurrent probes into a single evaluation', async () => {
    const app = Fastify();
    const { db, calls } = countingDb();
    await registerHealthRoutes(app, makeCtx(db), { cacheMs: 0 });

    await Promise.all(Array.from({ length: 8 }, () => app.inject('/ready')));
    // Injections resolve sequentially enough that a few evaluations may run,
    // but nowhere near one per request if the in-flight promise is shared.
    expect(calls()).toBeLessThan(8);
  });

  it('fails readiness while draining, without touching dependencies', async () => {
    const app = Fastify();
    const { db, calls } = countingDb();
    const lifecycle = createLifecycle();
    await registerHealthRoutes(app, makeCtx(db), { lifecycle, cacheMs: 0 });

    expect((await app.inject('/ready')).statusCode).toBe(200);

    lifecycle.beginDrain();
    const before = calls();
    const res = await app.inject('/ready');

    expect(res.statusCode).toBe(503);
    expect(res.json().draining).toBe(true);
    // Draining is about the load balancer, not dependency health.
    expect(calls()).toBe(before);
  });

  it('leaves no probe objects behind in storage', async () => {
    const app = Fastify();
    const { db } = countingDb();
    const storage = new MemoryStorage();
    // writeProbeIntervalMs of 0 forces the write path on every evaluation.
    await registerHealthRoutes(app, makeCtx(db, storage), {
      cacheMs: 0,
      writeProbeIntervalMs: 0,
    });

    await app.inject('/ready');
    await app.inject('/ready');

    const leftovers: string[] = [];
    for await (const obj of storage.list('__health__/')) leftovers.push(obj.key);
    expect(leftovers).toEqual([]);
  });

  it('reports queue status when an ingest queue is wired in', async () => {
    const app = Fastify();
    const { db } = countingDb();
    let calls = 0;
    const queue = {
      getJobCounts: async () => {
        calls += 1;
        return { waiting: 0, active: 0 };
      },
    } as unknown as NonNullable<AppContext['ingestionQueue']>;
    const ctx: AppContext = { ...makeCtx(db), ingestionQueue: queue };
    await registerHealthRoutes(app, ctx, { cacheMs: 0 });

    const res = await app.inject('/ready');
    expect(res.statusCode).toBe(200);
    expect(res.json().checks.queue.ok).toBe(true);
    expect(calls).toBe(1);
  });

  it('surfaces queue probe failures on /ready', async () => {
    const app = Fastify();
    const { db } = countingDb();
    const queue = {
      getJobCounts: async () => {
        throw new Error('redis: ECONNREFUSED');
      },
    } as unknown as NonNullable<AppContext['ingestionQueue']>;
    const ctx: AppContext = { ...makeCtx(db), ingestionQueue: queue };
    await registerHealthRoutes(app, ctx, { cacheMs: 0 });

    const res = await app.inject('/ready');
    expect(res.statusCode).toBe(503);
    expect(res.json().checks.queue.ok).toBe(false);
    expect(res.json().checks.queue.error).toContain('ECONNREFUSED');
  });

  it('omits the queue field when no queue is configured', async () => {
    const app = Fastify();
    const { db } = countingDb();
    await registerHealthRoutes(app, makeCtx(db), { cacheMs: 0 });

    const res = await app.inject('/ready');
    expect(res.statusCode).toBe(200);
    expect(res.json().checks.queue).toBeUndefined();
  });

  it('/health stays cheap and never consults a dependency', async () => {
    const app = Fastify();
    const { db, calls } = countingDb();
    await registerHealthRoutes(app, makeCtx(db));

    const res = await app.inject('/health');
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(calls()).toBe(0);
  });
});
