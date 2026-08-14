import type { Redis } from 'ioredis';
import type { RuntimePlugin } from '../runtime.js';

export interface RedisRateLimitOptions {
  readonly redis: Redis;
  /** Requests allowed per window. */
  readonly max: number;
  /** Window length in ms. */
  readonly windowMs: number;
  /** Namespace prefix for keys — defaults to `carbon:rl`. */
  readonly keyPrefix?: string;
  readonly identify?: (
    headers: Record<string, string | string[] | undefined>,
    ip: string,
  ) => string;
}

/**
 * Redis-backed sliding-window rate limiter. Uses INCR + EXPIRE-on-first-hit
 * so the window is per-caller and self-clearing. Suitable for horizontally
 * scaled deployments where multiple runtimes must share limits.
 *
 * Fails open: if Redis is unavailable, requests are allowed through. A
 * production deployment should pair this with health checks that quarantine
 * runtimes whose Redis is down.
 */
export function redisRateLimitPlugin(opts: RedisRateLimitOptions): RuntimePlugin {
  const prefix = opts.keyPrefix ?? 'carbon:rl';
  const identify = opts.identify ?? ((_h, ip) => ip);
  const ttlSec = Math.max(1, Math.ceil(opts.windowMs / 1000));

  return {
    name: 'rate-limit-redis',
    register(app, ctx) {
      app.addHook('onRequest', async (req, reply) => {
        try {
          const ip = req.ip;
          const id = identify(req.headers as Record<string, string | string[] | undefined>, ip);
          const key = `${prefix}:${id}`;
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
          ctx.logger.warn('runtime.rate_limit_redis_error', {
            message: (err as Error).message,
          });
        }
      });
    },
  };
}
