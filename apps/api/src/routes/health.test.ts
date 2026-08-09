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

  it('/v1/health/deep reports each dependency with { status, latencyMs }', async () => {
    const app = Fastify();
    const { db } = countingDb();
    await registerHealthRoutes(app, makeCtx(db));
    const res = await app.inject({ method: 'GET', url: '/v1/health/deep' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      ok: boolean;
      dependencies: Record<string, { status: 'ok' | 'slow' | 'down'; latencyMs: number }>;
    };
    expect(body.ok).toBe(true);
    expect(body.dependencies.db?.status).toBe('ok');
    expect(typeof body.dependencies.db?.latencyMs).toBe('number');
    expect(body.dependencies.storage?.status).toBe('ok');
  });

  it('/v1/health/deep marks a broken dep as down and returns 503', async () => {
    const app = Fastify();
    const brokenDb = {
      execute: async () => {
        throw new Error('ECONNREFUSED');
      },
    } as unknown as AppContext['db'];
    await registerHealthRoutes(app, makeCtx(brokenDb));
    const res = await app.inject({ method: 'GET', url: '/v1/health/deep' });
    expect(res.statusCode).toBe(503);
    const body = res.json() as {
      ok: boolean;
      dependencies: Record<string, { status: string; message?: string }>;
    };
    expect(body.ok).toBe(false);
    expect(body.dependencies.db?.status).toBe('down');
    expect(body.dependencies.db?.message).toContain('ECONNREFUSED');
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

  it('/v1/health/live is an alias of /health and does not touch dependencies', async () => {
    const app = Fastify();
    const { db, calls } = countingDb();
    await registerHealthRoutes(app, makeCtx(db));

    const res = await app.inject('/v1/health/live');
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().service).toBe('carbon-api');
    expect(calls()).toBe(0);
  });

  it('/v1/version reports build metadata, plans, and feature toggles', async () => {
    const prev = {
      sha: process.env.CARBON_GIT_SHA,
      buildTime: process.env.CARBON_BUILD_TIME,
      stripe: process.env.STRIPE_SECRET_KEY,
      sso: process.env.BETTER_AUTH_SSO,
    };
    process.env.CARBON_GIT_SHA = 'abc123';
    process.env.CARBON_BUILD_TIME = '2026-01-01T00:00:00Z';
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.BETTER_AUTH_SSO;
    try {
      const app = Fastify();
      const { db } = countingDb();
      await registerHealthRoutes(app, makeCtx(db));
      const res = await app.inject('/v1/version');
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.gitSha).toBe('abc123');
      expect(body.buildTime).toBe('2026-01-01T00:00:00Z');
      expect(body.plans).toEqual(['developer', 'team', 'enterprise']);
      expect(body.features).toEqual({ billing: false, sso: false, scim: true });
    } finally {
      restoreEnv('CARBON_GIT_SHA', prev.sha);
      restoreEnv('CARBON_BUILD_TIME', prev.buildTime);
      restoreEnv('STRIPE_SECRET_KEY', prev.stripe);
      restoreEnv('BETTER_AUTH_SSO', prev.sso);
    }
  });

  it('/v1/version flips features.billing on when STRIPE_SECRET_KEY is set', async () => {
    const prev = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = 'sk_test_xyz';
    try {
      const app = Fastify();
      const { db } = countingDb();
      await registerHealthRoutes(app, makeCtx(db));
      const body = (await app.inject('/v1/version')).json();
      expect(body.features.billing).toBe(true);
    } finally {
      restoreEnv('STRIPE_SECRET_KEY', prev);
    }
  });
});

function restoreEnv(name: string, prev: string | undefined): void {
  if (prev === undefined) delete process.env[name];
  else process.env[name] = prev;
}
