import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { NoopLogger } from '@carbon/core';
import type { Redis } from 'ioredis';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from './api-key.js';
import { registerControlPlaneRateLimit } from './rate-limit.js';

class MemoryRateLimitRedis {
  readonly counts = new Map<string, number>();

  async eval(_script: string, _numKeys: number, key: string, windowMs: string): Promise<number[]> {
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return [count, Number(windowMs)];
  }
}

function makeCtx(redis: Redis): AppContext {
  return {
    logger: NoopLogger,
    redis,
  } as unknown as AppContext;
}

describe('control-plane rate limit', () => {
  it('limits by authenticated API key prefix and exempts health probes with query strings', async () => {
    const redis = new MemoryRateLimitRedis() as unknown as Redis;
    const app = Fastify();
    app.addHook('onRequest', async (req) => {
      (req as AuthenticatedRequest).apiKey = {
        id: 'key_1',
        orgId: 'org_1',
        prefix: 'aa11bb22cc33',
        scopes: ['admin'],
        projectIds: null,
        expiresAt: null,
      };
    });
    await registerControlPlaneRateLimit(app, makeCtx(redis), {
      redis,
      max: 2,
      windowMs: 60_000,
    });
    app.get('/v1/things', async () => ({ ok: true }));
    app.get('/health', async () => ({ ok: true }));

    expect((await app.inject('/v1/things')).statusCode).toBe(200);
    expect((await app.inject('/v1/things')).statusCode).toBe(200);
    const limited = await app.inject('/v1/things');
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBe('60');

    expect((await app.inject('/health?full=1')).statusCode).toBe(200);
  });

  it('fails open when Redis rejects the rate-limit command', async () => {
    const redis = {
      eval: async () => {
        throw new Error('redis unavailable');
      },
    } as unknown as Redis;
    const app = Fastify();
    await registerControlPlaneRateLimit(app, { logger: NoopLogger } as AppContext, {
      redis,
      max: 1,
      windowMs: 60_000,
    });
    app.get('/v1/things', async () => ({ ok: true }));

    expect((await app.inject('/v1/things')).statusCode).toBe(200);
  });
});
