import { describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import { registerIdempotency } from './idempotency.js';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from './api-key.js';
import type { Redis } from 'ioredis';

class MemoryRedis {
  private readonly hashes = new Map<string, Record<string, string>>();

  async hgetall(key: string): Promise<Record<string, string>> {
    return { ...(this.hashes.get(key) ?? {}) };
  }

  async eval(
    _script: string,
    _numKeys: number,
    key: string,
    bodyHash: string,
    _ttl: string,
  ): Promise<number> {
    if (this.hashes.has(key)) return 0;
    this.hashes.set(key, { hash: bodyHash });
    return 1;
  }

  async del(key: string): Promise<number> {
    return this.hashes.delete(key) ? 1 : 0;
  }

  multi() {
    const redis = this;
    const ops: Array<() => void> = [];
    const chain = {
      hset(key: string, value: Record<string, string>) {
        ops.push(() => redis.hashes.set(key, { ...(redis.hashes.get(key) ?? {}), ...value }));
        return chain;
      },
      expire() {
        return chain;
      },
      async exec() {
        ops.forEach((op) => op());
        return [];
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

async function buildApp(): Promise<FastifyInstance> {
  const redis = new MemoryRedis() as unknown as Redis;
  const app = Fastify();
  let counter = 0;

  app.addHook('onRequest', async (req) => {
    const prefix = String(req.headers['x-test-key'] ?? 'anonymous');
    (req as AuthenticatedRequest).apiKey = { id: `key-${prefix}`, orgId: 'org_1', prefix };
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

  app.post('/v1/other', async (req, reply) => {
    counter += 1;
    reply.status(201);
    return {
      counter,
      prefix: (req as AuthenticatedRequest).apiKey?.prefix,
      route: 'other',
    };
  });

  return app;
}

describe('idempotency', () => {
  it('replays a successful write for the same caller and route', async () => {
    const app = await buildApp();
    const first = await app.inject({
      method: 'POST',
      url: '/v1/widgets',
      headers: { 'idempotency-key': 'same-request', 'x-test-key': 'aa11' },
      payload: { name: 'Fixture' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/v1/widgets',
      headers: { 'idempotency-key': 'same-request', 'x-test-key': 'aa11' },
      payload: { name: 'Fixture' },
    });

    expect(first.headers['idempotent-replay']).toBe('false');
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(second.json()).toEqual(first.json());
  });

  it('does not replay across different API keys', async () => {
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/v1/widgets',
      headers: { 'idempotency-key': 'caller-scoped', 'x-test-key': 'aa11' },
      payload: { name: 'Fixture' },
    });
    const secondCaller = await app.inject({
      method: 'POST',
      url: '/v1/widgets',
      headers: { 'idempotency-key': 'caller-scoped', 'x-test-key': 'bb22' },
      payload: { name: 'Fixture' },
    });

    expect(secondCaller.headers['idempotent-replay']).toBe('false');
    expect(secondCaller.json()).toMatchObject({ prefix: 'bb22' });
  });

  it('does not replay across different routes', async () => {
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/v1/widgets',
      headers: { 'idempotency-key': 'route-scoped', 'x-test-key': 'aa11' },
      payload: { name: 'Fixture' },
    });
    const otherRoute = await app.inject({
      method: 'POST',
      url: '/v1/other',
      headers: { 'idempotency-key': 'route-scoped', 'x-test-key': 'aa11' },
      payload: { name: 'Fixture' },
    });

    expect(otherRoute.headers['idempotent-replay']).toBe('false');
    expect(otherRoute.json()).toMatchObject({ route: 'other' });
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
      headers: { 'idempotency-key': 'concurrent-key' },
      payload: { name: 'Fixture' },
    });
    await entered;
    const second = await app.inject({
      method: 'POST',
      url: '/v1/slow',
      headers: { 'idempotency-key': 'concurrent-key' },
      payload: { name: 'Fixture' },
    });
    release();
    await first;

    expect(second.statusCode).toBe(409);
    expect(second.headers['retry-after']).toBe('1');
    expect(calls).toBe(1);
  });

  it('does not cache failed responses', async () => {
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
      headers: { 'idempotency-key': 'flaky-key' },
      payload: { name: 'Fixture' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/v1/flaky',
      headers: { 'idempotency-key': 'flaky-key' },
      payload: { name: 'Fixture' },
    });

    expect(first.statusCode).toBe(500);
    expect(second.statusCode).toBe(201);
    expect(calls).toBe(2);
  });
});
