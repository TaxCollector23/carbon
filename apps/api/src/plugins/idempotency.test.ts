import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import { registerIdempotency } from './idempotency.js';
import { resetIdempotencyCountersForTest } from './metrics.js';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from './api-key.js';
import type { Redis } from 'ioredis';

/**
 * Tiny in-memory Redis stub covering only the surface the idempotency plugin
 * touches: `get`, `del`, `set` (with EX/NX), and a `multi().set().del().exec()`
 * chain. Enough to drive the hook flow end-to-end without a live Redis.
 */
class MemoryRedis {
  private readonly strings = new Map<string, { value: string; expiresAt: number | null }>();

  private live(key: string): { value: string; expiresAt: number | null } | undefined {
    const entry = this.strings.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.strings.delete(key);
      return undefined;
    }
    return entry;
  }

  async get(key: string): Promise<string | null> {
    return this.live(key)?.value ?? null;
  }

  async del(key: string): Promise<number> {
    return this.strings.delete(key) ? 1 : 0;
  }

  async set(
    key: string,
    value: string,
    _exFlag?: 'EX',
    ttl?: number,
    nxFlag?: 'NX',
  ): Promise<'OK' | null> {
    if (nxFlag === 'NX' && this.live(key)) return null;
    const expiresAt = ttl ? Date.now() + ttl * 1000 : null;
    this.strings.set(key, { value, expiresAt });
    return 'OK';
  }

  multi() {
    const redis = this;
    const ops: Array<() => Promise<unknown>> = [];
    const chain = {
      set(key: string, value: string, exFlag?: 'EX', ttl?: number) {
        ops.push(() => redis.set(key, value, exFlag, ttl));
        return chain;
      },
      del(key: string) {
        ops.push(() => redis.del(key));
        return chain;
      },
      async exec() {
        const out: unknown[] = [];
        for (const op of ops) out.push(await op());
        return out;
      },
    };
    return chain;
  }
}

function makeCtx(redis: Redis): AppContext {
  return {
    logger: NoopLogger,
    db: {} as AppContext['db'],
    storage: new MemoryStorage(),
    ingestion: { ingest: async () => ({}) } as unknown as AppContext['ingestion'],
    emulators: {} as AppContext['emulators'],
    redis,
  };
}

// Fixture keys must satisfy the plugin's regex: 16-128 URL-safe chars.
const KEY_A = 'idem-fixture-key-aaaa';
const KEY_B = 'idem-fixture-key-bbbb';
const KEY_C = 'idem-fixture-key-cccc';
const KEY_D = 'idem-fixture-key-dddd';
const KEY_E = 'idem-fixture-key-eeee';
const KEY_F = 'idem-fixture-key-ffff';
const KEY_G = 'idem-fixture-key-gggg';

async function buildApp(): Promise<FastifyInstance> {
  const redis = new MemoryRedis() as unknown as Redis;
  const app = Fastify();
  let counter = 0;

  app.addHook('onRequest', async (req) => {
    const prefix = String(req.headers['x-test-key'] ?? 'anonymous');
    (req as AuthenticatedRequest).apiKey = {
      id: `key-${prefix}`,
      orgId: 'org_1',
      prefix,
      scopes: ['admin'],
      projectIds: null,
      expiresAt: null,
    };
  });
  await registerIdempotency(app, makeCtx(redis), { redis });

  app.post('/v1/widgets', async (req, reply) => {
    counter += 1;
    reply.status(201);
    return {
      counter,
      prefix: (req as AuthenticatedRequest).apiKey?.prefix,
      route: 'widgets',
    };
  });

  return app;
}

beforeEach(() => {
  resetIdempotencyCountersForTest();
});

describe('idempotency', () => {
  it('replays a successful write for the same caller with idempotent-replay: true', async () => {
    const app = await buildApp();
    const first = await app.inject({
      method: 'POST',
      url: '/v1/widgets',
      headers: { 'idempotency-key': KEY_A, 'x-test-key': 'aa11' },
      payload: { name: 'Fixture' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/v1/widgets',
      headers: { 'idempotency-key': KEY_A, 'x-test-key': 'aa11' },
      payload: { name: 'Fixture' },
    });

    expect(first.headers['idempotent-replay']).toBe('false');
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(second.statusCode).toBe(first.statusCode);
    expect(second.json()).toEqual(first.json());
    // Content-type is preserved so the replay looks byte-for-byte the same.
    expect(second.headers['content-type']).toEqual(first.headers['content-type']);
  });

  it('does not replay across different API keys', async () => {
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/v1/widgets',
      headers: { 'idempotency-key': KEY_B, 'x-test-key': 'aa11' },
      payload: { name: 'Fixture' },
    });
    const secondCaller = await app.inject({
      method: 'POST',
      url: '/v1/widgets',
      headers: { 'idempotency-key': KEY_B, 'x-test-key': 'bb22' },
      payload: { name: 'Fixture' },
    });

    expect(secondCaller.headers['idempotent-replay']).toBe('false');
    expect(secondCaller.json()).toMatchObject({ prefix: 'bb22' });
  });

  it('rejects concurrent duplicates while the first request is in progress', async () => {
    const redis = new MemoryRedis() as unknown as Redis;
    const app = Fastify();
    let calls = 0;
    let release!: () => void;
    let enteredResolve!: () => void;
    const entered = new Promise<void>((resolve) => {
      enteredResolve = resolve;
    });
    await registerIdempotency(app, makeCtx(redis), { redis });
    app.post('/v1/slow', async () => {
      calls += 1;
      enteredResolve();
      await new Promise<void>((innerResolve) => {
        release = innerResolve;
      });
      return { ok: true };
    });

    const first = app.inject({
      method: 'POST',
      url: '/v1/slow',
      headers: { 'idempotency-key': KEY_C },
      payload: { name: 'Fixture' },
    });
    await entered;
    const second = await app.inject({
      method: 'POST',
      url: '/v1/slow',
      headers: { 'idempotency-key': KEY_C },
      payload: { name: 'Fixture' },
    });
    release();
    await first;

    expect(second.statusCode).toBe(409);
    expect(second.headers['retry-after']).toBe('1');
    expect(second.json()).toMatchObject({ error: { code: 'CARBON_CONFLICT' } });
    expect(calls).toBe(1);
  });

  it('does not cache 5xx responses so retries hit the handler again', async () => {
    const redis = new MemoryRedis() as unknown as Redis;
    const app = Fastify();
    let calls = 0;
    await registerIdempotency(app, makeCtx(redis), { redis });
    app.post('/v1/flaky', async (_req, reply) => {
      calls += 1;
      if (calls === 1) {
        reply.status(500);
        return { error: 'boom' };
      }
      reply.status(201);
      return { ok: true };
    });

    const first = await app.inject({
      method: 'POST',
      url: '/v1/flaky',
      headers: { 'idempotency-key': KEY_D },
      payload: { name: 'Fixture' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/v1/flaky',
      headers: { 'idempotency-key': KEY_D },
      payload: { name: 'Fixture' },
    });

    expect(first.statusCode).toBe(500);
    expect(second.statusCode).toBe(201);
    expect(calls).toBe(2);
  });

  it('does not cache 4xx responses so a corrected retry gets a fresh answer', async () => {
    const redis = new MemoryRedis() as unknown as Redis;
    const app = Fastify();
    let calls = 0;
    await registerIdempotency(app, makeCtx(redis), { redis });
    app.post('/v1/validated', async (req, reply) => {
      calls += 1;
      const body = req.body as { name?: string };
      if (!body.name) {
        reply.status(400);
        return { error: { code: 'CARBON_INVALID_INPUT' } };
      }
      reply.status(201);
      return { ok: true, name: body.name };
    });

    const first = await app.inject({
      method: 'POST',
      url: '/v1/validated',
      headers: { 'idempotency-key': KEY_E },
      payload: {},
    });
    const retry = await app.inject({
      method: 'POST',
      url: '/v1/validated',
      headers: { 'idempotency-key': KEY_E },
      payload: { name: 'Corrected' },
    });

    expect(first.statusCode).toBe(400);
    expect(retry.statusCode).toBe(201);
    expect(retry.headers['idempotent-replay']).toBe('false');
    expect(calls).toBe(2);
  });

  it('rejects malformed idempotency keys with 400', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/widgets',
      headers: { 'idempotency-key': 'too-short', 'x-test-key': 'aa11' },
      payload: { name: 'Fixture' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'CARBON_INVALID_INPUT' },
    });
  });

  it('skips caching for stream payloads without crashing', async () => {
    const redis = new MemoryRedis() as unknown as Redis;
    const app = Fastify();
    let calls = 0;
    await registerIdempotency(app, makeCtx(redis), { redis });
    app.post('/v1/download', async (_req, reply) => {
      calls += 1;
      reply.type('application/octet-stream');
      return Readable.from([Buffer.from('hello '), Buffer.from('world')]);
    });

    const first = await app.inject({
      method: 'POST',
      url: '/v1/download',
      headers: { 'idempotency-key': KEY_F },
      payload: {},
    });
    const second = await app.inject({
      method: 'POST',
      url: '/v1/download',
      headers: { 'idempotency-key': KEY_F },
      payload: {},
    });

    expect(first.statusCode).toBe(200);
    expect(first.body).toBe('hello world');
    // Stream skipped caching, so the second call re-runs the handler.
    expect(second.statusCode).toBe(200);
    expect(second.headers['idempotent-replay']).toBe('false');
    expect(calls).toBe(2);
  });

  it('rejects unkeyed POST with 400 IDEMPOTENCY_KEY_REQUIRED when requireKey is on', async () => {
    const redis = new MemoryRedis() as unknown as Redis;
    const app = Fastify();
    await registerIdempotency(app, makeCtx(redis), { redis, requireKey: true });
    app.post('/v1/projects', async (_req, reply) => {
      reply.status(201);
      return { ok: true };
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/projects',
      payload: { slug: 'x' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: { code: 'IDEMPOTENCY_KEY_REQUIRED' },
    });
  });

  it('lets unkeyed POST through when the route is on the allow-unkeyed list', async () => {
    const redis = new MemoryRedis() as unknown as Redis;
    const app = Fastify();
    await registerIdempotency(app, makeCtx(redis), {
      redis,
      requireKey: true,
      allowUnkeyed: ['/v1/billing/webhook'],
    });
    app.post('/v1/billing/webhook', async () => ({ ok: true }));

    const res = await app.inject({
      method: 'POST',
      url: '/v1/billing/webhook',
      payload: { type: 'x' },
    });

    expect(res.statusCode).toBe(200);
  });

  it('leaves GET requests untouched', async () => {
    const redis = new MemoryRedis() as unknown as Redis;
    const app = Fastify();
    await registerIdempotency(app, makeCtx(redis), { redis });
    app.get('/v1/thing', async () => ({ ok: true }));

    const response = await app.inject({
      method: 'GET',
      url: '/v1/thing',
      headers: { 'idempotency-key': KEY_G },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['idempotent-replay']).toBeUndefined();
  });
});
