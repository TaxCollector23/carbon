import type { RuntimePlugin } from '../runtime.js';

export interface RateLimitOptions {
  /** Requests allowed per window. */
  readonly max: number;
  /** Window length in ms. */
  readonly windowMs: number;
  /** How to identify a caller. Defaults to remote IP. */
  readonly identify?: (headers: Record<string, string | string[] | undefined>, ip: string) => string;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * In-memory token-bucket rate limiter. Suitable for local development and
 * single-process deployments. A Redis-backed variant will land alongside the
 * cloud control plane.
 */
export function rateLimitPlugin(opts: RateLimitOptions): RuntimePlugin {
  const buckets = new Map<string, Bucket>();
  const identify = opts.identify ?? ((_h, ip) => ip);

  return {
    name: 'rate-limit',
    register(app) {
      app.addHook('onRequest', async (req, reply) => {
        const ip = req.ip;
        const key = identify(req.headers as Record<string, string | string[] | undefined>, ip);
        const now = Date.now();
        let bucket = buckets.get(key);
        if (!bucket || bucket.resetAt <= now) {
          bucket = { count: 0, resetAt: now + opts.windowMs };
          buckets.set(key, bucket);
        }
        bucket.count += 1;
        reply.header('x-ratelimit-limit', String(opts.max));
        reply.header('x-ratelimit-remaining', String(Math.max(0, opts.max - bucket.count)));
        reply.header('x-ratelimit-reset', String(Math.ceil(bucket.resetAt / 1000)));
        if (bucket.count > opts.max) {
          reply
            .status(429)
            .send({ error: { code: 'CARBON_RATE_LIMITED', message: 'Rate limit exceeded' } });
          return reply;
        }
      });
    },
  };
}
