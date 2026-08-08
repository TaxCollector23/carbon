import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from './api-key.js';

export interface RateLimitOptions {
  readonly redis: Redis;
  readonly max: number;
  readonly windowMs: number;
  readonly keyPrefix?: string;
  /**
   * Paths that never consume budget. Defaults to the probe endpoints; the
   * server passes its full public-path list so a Prometheus scrape cannot be
   * throttled off exactly when an incident makes it most useful.
   */
  readonly exemptPaths?: Iterable<string>;
}

const DEFAULT_EXEMPT = ['/health', '/ready'];

const RATE_LIMIT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
return { count, ttl }
`;

/**
 * Control-plane rate limiter.
 *
 * The identity used per-request is (in order): the API key prefix set by the
 * auth middleware, then the client IP as a fallback. This means anonymous
 * clients on the same corporate NAT don't cannibalize each other's budget
 * once they've authenticated — each API key gets its own bucket.
 *
 * Redis-backed fixed window (INCR + PEXPIRE-on-first-hit): the counter resets
 * `windowMs` after the first request in a window, so a caller can burst up to
 * `2 * max` across a window boundary. That is an accepted trade — the
 * alternative costs a sorted set per identity — but it is a fixed window, not
 * a sliding one. Fails open on Redis errors so a Redis outage doesn't take
 * down the API.
 */
export async function registerControlPlaneRateLimit(
  app: FastifyInstance,
  ctx: AppContext,
  opts: RateLimitOptions,
): Promise<void> {
  const prefix = opts.keyPrefix ?? 'carbon:cp:rl';
  const windowMs = Math.max(1000, Math.floor(opts.windowMs));
  const max = Math.max(1, Math.floor(opts.max));
  const exempt = new Set(opts.exemptPaths ?? DEFAULT_EXEMPT);

  app.addHook('onRequest', async (req, reply) => {
    // Probes and scrapes are always allowed — they need to work under load
    // for the LB and for humans debugging incidents.
    const path = req.url.split('?')[0] ?? req.url;
    if (exempt.has(path)) return;

    const id = identify(req);
    const key = `${prefix}:${id}`;
    try {
      const { count, ttlMs } = parseRateLimitResult(
        await opts.redis.eval(RATE_LIMIT_SCRIPT, 1, key, String(windowMs)),
      );
      reply.header('x-ratelimit-limit', String(max));
      reply.header('x-ratelimit-remaining', String(Math.max(0, max - count)));
      if (count > max) {
        reply.header('retry-after', String(Math.max(1, Math.ceil(ttlMs / 1000))));
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

function parseRateLimitResult(value: unknown): { count: number; ttlMs: number } {
  if (!Array.isArray(value)) return { count: 0, ttlMs: 0 };
  return { count: Number(value[0] ?? 0), ttlMs: Number(value[1] ?? 0) };
}
