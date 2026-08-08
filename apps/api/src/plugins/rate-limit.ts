import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from './api-key.js';
import type { SessionAuthenticatedRequest } from './session-auth.js';
import type { PlanTier } from '../services/billing.js';
import { resolvePlan } from '../services/billing.js';

export interface RateLimitOptions {
  readonly redis: Redis;
  /** Fallback ceiling when no org / no resolver — a flat rpm. */
  readonly max: number;
  readonly windowMs: number;
  readonly keyPrefix?: string;
  /**
   * Paths that never consume budget. Defaults to the probe endpoints; the
   * server passes its full public-path list so a Prometheus scrape cannot be
   * throttled off exactly when an incident makes it most useful.
   */
  readonly exemptPaths?: Iterable<string>;
  /**
   * Per-plan resolver — when wired, the limit is chosen based on the
   * requester's org plan tier. Absent → the flat `max` applies to everyone.
   */
  readonly resolvePlan?: (orgId: string) => Promise<PlanTier>;
}

/** Per-plan rate ceilings (requests per window). */
export const PLAN_RATE_LIMITS: Record<PlanTier, number> = {
  developer: 60,
  team: 600,
  enterprise: 6000,
};

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
  const fallbackMax = Math.max(1, Math.floor(opts.max));
  const exempt = new Set(opts.exemptPaths ?? DEFAULT_EXEMPT);

  // Plan tier is resolved once per (orgId, process-lifetime) — a plan change is
  // rare and the cost of an extra DB round-trip on every request adds up on
  // a hot path. TTL keeps a demotion visible within a minute.
  const planCache = new Map<string, { plan: PlanTier; expiresAt: number }>();
  const PLAN_CACHE_TTL_MS = 60_000;

  // Fall back to the ctx-backed resolver so the buildServer wiring doesn't
  // need to know about plan tiers — the plugin can find one via ctx.db.
  const resolver =
    opts.resolvePlan ??
    (ctx.db
      ? async (orgId: string) => (await resolvePlan(orgId, ctx.db)).plan
      : undefined);

  async function resolveMaxForRequest(req: FastifyRequest): Promise<number> {
    if (!resolver) return fallbackMax;
    const orgId =
      (req as AuthenticatedRequest).apiKey?.orgId ??
      (req as SessionAuthenticatedRequest).sessionUser?.orgId ??
      null;
    if (!orgId) return fallbackMax;
    const now = Date.now();
    const cached = planCache.get(orgId);
    let plan: PlanTier;
    if (cached && cached.expiresAt > now) {
      plan = cached.plan;
    } else {
      try {
        plan = await resolver(orgId);
        planCache.set(orgId, { plan, expiresAt: now + PLAN_CACHE_TTL_MS });
      } catch {
        return fallbackMax;
      }
    }
    return PLAN_RATE_LIMITS[plan] ?? fallbackMax;
  }

  app.addHook('onRequest', async (req, reply) => {
    // Probes and scrapes are always allowed — they need to work under load
    // for the LB and for humans debugging incidents.
    const path = req.url.split('?')[0] ?? req.url;
    if (exempt.has(path)) return;

    const id = identify(req);
    const key = `${prefix}:${id}`;
    const max = await resolveMaxForRequest(req);
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
