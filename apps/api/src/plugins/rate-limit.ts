import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from './api-key.js';

export interface RateLimitOptions {
  readonly redis: Redis;
  readonly max: number;
  readonly windowMs: number;
  readonly keyPrefix?: string;
}

/**
 * Control-plane rate limiter.
 *
 * The identity used per-request is (in order): the API key prefix set by the
 * auth middleware, then the client IP as a fallback. This means anonymous
 * clients on the same corporate NAT don't cannibalize each other's budget
 * once they've authenticated — each API key gets its own bucket.
 *
 * Redis-backed sliding window (INCR + EXPIRE-on-first-hit). Fails open on
 * Redis errors so a Redis outage doesn't take down the API.
 */
export async function registerControlPlaneRateLimit(
  app: FastifyInstance,
  ctx: AppContext,
  opts: RateLimitOptions,
): Promise<void> {
  const prefix = opts.keyPrefix ?? 'carbon:cp:rl';
  const ttlSec = Math.max(1, Math.ceil(opts.windowMs / 1000));

  app.addHook('onRequest', async (req, reply) => {
    // /health and /ready are always allowed — they need to work under load
    // for the LB and for humans debugging incidents.
    if (req.url === '/health' || req.url === '/ready') return;

    const id = identify(req);
    const key = `${prefix}:${id}`;
    try {
      const count = await opts.redis.incr(key);
      if (count === 1) await opts.redis.expire(key, ttlSec);
      reply.header('x-ratelimit-limit', String(opts.max));
      reply.header('x-ratelimit-remaining', String(Math.max(0, opts.max - count)));
      if (count > opts.max) {
        const ttl = await opts.redis.ttl(key);
        reply.header('retry-after', String(Math.max(1, ttl)));
        reply
          .status(429)
          .send({ error: { code: 'CARBON_RATE_LIMITED', message: 'Rate limit exceeded' } });
        return reply;
      }
    } catch (err) {
      ctx.logger.warn('rate_limit.redis_error', { message: (err as Error).message });
      // Fail open — do not reject legitimate traffic on infra hiccups.
    }
  });
}

function identify(req: FastifyRequest): string {
  const apiKey = (req as AuthenticatedRequest).apiKey;
  if (apiKey?.prefix) return `k:${apiKey.prefix}`;
  return `ip:${req.ip}`;
}
