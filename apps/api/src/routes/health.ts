import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { CarbonError } from '@carbon/core';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import { zodResponse } from '../plugins/schema-helpers.js';
import { AlwaysReady, type Lifecycle } from '../lifecycle.js';

const LivenessResponse = z.object({
  ok: z.boolean(),
  service: z.string(),
  version: z.string(),
});
const VersionResponse = z.object({
  version: z.string(),
  release: z.string(),
  node: z.string(),
  startedAt: z.string().datetime(),
  uptimeSec: z.number().int(),
  gitSha: z.string().nullable(),
  buildTime: z.string().nullable(),
  plans: z.array(z.string()),
  features: z.object({
    billing: z.boolean(),
    sso: z.boolean(),
    scim: z.boolean(),
  }),
});

/**
 * `/health` is a lightweight liveness probe — the process is up.
 * `/ready` is a readiness probe — dependencies are reachable. Failure of
 *   /ready should cause a load balancer to drain traffic; failure of /health
 *   should cause the orchestrator to restart the pod.
 *
 * Two things make `/ready` cheap enough to poll at 1Hz:
 *
 *   1. Results are cached for `cacheMs`. A LB with three replicas probing
 *      every second was otherwise issuing 259k dependency checks a day per
 *      process, most of them redundant.
 *   2. The storage probe is a read (`head`) on all but the occasional pass.
 *      The original probe wrote and deleted an object on every request, which
 *      on S3/R2 is two billable mutations per probe and leaves debris behind
 *      whenever the process dies between the put and the delete.
 */
export interface HealthOptions {
  readonly release?: string;
  readonly timeoutMs?: number;
  /** How long a readiness result stays fresh. Default 2000ms. */
  readonly cacheMs?: number;
  /** How often to escalate the storage probe to a real write. Default 5min. */
  readonly writeProbeIntervalMs?: number;
  readonly lifecycle?: Lifecycle;
}

type CheckResult = {
  ok: boolean;
  error?: string;
  /** Wall-clock ms spent inside the check. */
  latencyMs?: number;
  /** Present when a dependency answered but was slower than the SLA. */
  slow?: boolean;
  /** Present when the dependency did not answer at all. */
  unreachable?: boolean;
};
type Checks = Record<string, CheckResult>;

/**
 * The SLA a dependency has to hit for /ready to report `ok`. Anything above
 * this but still under {@link UNREACHABLE_MS} shows up as `degraded` (200) so
 * the LB keeps routing but an operator sees the smell.
 */
export const SLOW_SLA_MS = 250;
/**
 * How long we're willing to wait before treating a dependency as unreachable.
 * A slow-but-answering DB is very different from one behind a broken NAT —
 * this line separates them.
 */
export const UNREACHABLE_MS = 2000;

export async function registerHealthRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  options: HealthOptions = {},
): Promise<void> {
  const release = options.release ?? process.env.CARBON_RELEASE ?? 'dev';
  const timeoutMs = options.timeoutMs ?? 1000;
  const cacheMs = options.cacheMs ?? 2000;
  const writeProbeIntervalMs = options.writeProbeIntervalMs ?? 5 * 60 * 1000;
  const lifecycle = options.lifecycle ?? AlwaysReady;

  type EvalOutcome = {
    checks: Checks;
    status: 'ok' | 'degraded' | 'down';
  };
  let cached: { at: number } & EvalOutcome | null = null;
  // Concurrent probes share one evaluation instead of stampeding the database
  // the instant the cache expires.
  let inFlight: Promise<EvalOutcome> | null = null;
  let lastWriteProbeAt = 0;

  const livenessBody = () => ({ ok: true, service: 'carbon-api', version: '0.1.0' });
  // `/health` is the historical liveness path; `/v1/health/live` is the
  // versioned alias for symmetry with `/v1/health/deep`. Both are the same
  // handler — dependency checks live on `/ready` (and `/v1/health/deep`).
  app.get('/health', {
    schema: {
      summary: 'Liveness probe',
      description: 'Cheap liveness check — returns 200 as long as the process is up. Use as a Kubernetes liveness probe.',
      response: { 200: zodResponse(LivenessResponse) },
    },
  }, async () => livenessBody());
  app.get('/v1/health/live', {
    schema: {
      summary: 'Liveness probe (versioned)',
      description: 'Versioned alias for `/health`. Identical response shape and cost.',
      response: { 200: zodResponse(LivenessResponse) },
    },
  }, async () => livenessBody());

  app.get('/v1/version', {
    schema: {
      summary: 'Server version and feature flags',
      description: 'Return the running server version, git SHA (if stamped by CI), uptime, and per-deployment feature toggles.',
      response: { 200: zodResponse(VersionResponse) },
    },
  }, async () => ({
    version: '0.1.0',
    release,
    node: process.version,
    startedAt: new Date(Date.now() - Math.floor(process.uptime() * 1000)).toISOString(),
    uptimeSec: Math.floor(process.uptime()),
    // Build metadata is populated by CI when it stamps the container image;
    // absent in local dev, which is why both keys default to null instead of
    // omitted — a stable shape is easier to consume than a shifting one.
    gitSha: process.env.CARBON_GIT_SHA ?? null,
    buildTime: process.env.CARBON_BUILD_TIME ?? null,
    // Plan tiers the control plane currently understands. Kept literal here
    // (not env-driven) because plan gating is code, not config — new tiers
    // arrive as a code change and this list should follow it.
    plans: ['developer', 'team', 'enterprise'] as const,
    // Feature toggles reflect whether the *deployment* has the moving parts
    // wired up. SSO/SCIM are always-on in code but only useful once the
    // respective env is configured; billing is dark until Stripe is set.
    features: {
      billing: Boolean(process.env.STRIPE_SECRET_KEY),
      sso: Boolean(process.env.BETTER_AUTH_SSO),
      scim: true,
    },
  }));

  app.get('/ready', async (_req, reply) => {
    // Draining short-circuits everything below. During a rolling deploy the
    // dependencies are still perfectly healthy — the point is to tell the load
    // balancer to stop sending work here before the listener closes.
    if (lifecycle.draining) {
      reply.status(503);
      reply.header('cache-control', 'no-store');
      return { ok: false, status: 'down', draining: true, checks: {} };
    }

    const now = Date.now();
    if (cached && now - cached.at < cacheMs) {
      reply.status(cached.status === 'down' ? 503 : 200);
      reply.header('cache-control', 'no-store');
      const slow = Object.entries(cached.checks)
        .filter(([, v]) => v.slow)
        .map(([k]) => k);
      const errors = Object.entries(cached.checks)
        .filter(([, v]) => v.unreachable)
        .map(([k, v]) => ({ name: k, error: v.error }));
      return {
        ok: cached.status === 'ok',
        status: cached.status,
        checks: cached.checks,
        slow,
        errors,
        cached: true,
      };
    }

    inFlight ??= evaluate().finally(() => {
      inFlight = null;
    });
    const result = await inFlight;
    cached = { at: Date.now(), ...result };

    reply.status(result.status === 'down' ? 503 : 200);
    reply.header('cache-control', 'no-store');
    const slow = Object.entries(result.checks)
      .filter(([, v]) => v.slow)
      .map(([k]) => k);
    const errors = Object.entries(result.checks)
      .filter(([, v]) => v.unreachable)
      .map(([k, v]) => ({ name: k, error: v.error }));
    return {
      ok: result.status === 'ok',
      status: result.status,
      checks: result.checks,
      slow,
      errors,
      cached: false,
    };
  });

  // ------------------------------------------------------------------
  // GET /v1/health/deep — admin-only, per-dependency detail. Same shape
  // as /ready but every dependency answers independently with a status
  // ({ ok | slow | down }), latency, and — when it failed — a message.
  //
  // Not in the public paths list on purpose: individual dep timings can
  // help an attacker fingerprint the deployment (Postgres version, S3
  // vs R2 latency, redis distance). Requires an admin-scoped API key.
  // ------------------------------------------------------------------
  app.get('/v1/health/deep', async (req, reply) => {
    const apiKey = (req as AuthenticatedRequest).apiKey;
    if (apiKey && !apiKey.scopes.includes('admin')) {
      throw new CarbonError({
        code: 'CARBON_FORBIDDEN',
        message: 'admin scope required for /v1/health/deep',
        expose: true,
      });
    }
    const dependencies: Record<
      string,
      { status: 'ok' | 'slow' | 'down'; latencyMs: number; message?: string }
    > = {};
    await Promise.all([
      probeDeep(dependencies, 'db', 500, () => ctx.db.execute(sql`select 1`)),
      ctx.redis
        ? probeDeep(dependencies, 'redis', 500, () => ctx.redis?.ping() ?? Promise.resolve())
        : Promise.resolve(),
      probeDeep(dependencies, 'storage', 500, async () => {
        // A tiny list() exercises credentials, networking, and the backend's
        // existence — the same guarantees head() gives us plus the enumerate
        // path callers rely on when browsing artifacts.
        const iter = ctx.storage.list('__health__/');
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _ of iter) break;
      }),
    ]);

    reply.header('cache-control', 'no-store');
    const anyDown = Object.values(dependencies).some((d) => d.status === 'down');
    reply.status(anyDown ? 503 : 200);
    return { ok: !anyDown, dependencies };
  });

  async function evaluate(): Promise<EvalOutcome> {
    const checks: Checks = {};
    const writeProbe = Date.now() - lastWriteProbeAt >= writeProbeIntervalMs;
    if (writeProbe) lastWriteProbeAt = Date.now();

    // Every check runs on the caller's timeout (default 1s) capped at the
    // unreachable ceiling — a stuck dependency cannot hold the probe past a
    // load-balancer's own timeout.
    const deadline = Math.min(timeoutMs, UNREACHABLE_MS);
    await Promise.all([
      runCheck(checks, 'database', deadline, () => ctx.db.execute(sql`select 1`)),
      ctx.redis
        ? runCheck(checks, 'redis', deadline, () => ctx.redis?.ping() ?? Promise.resolve())
        : Promise.resolve(),
      runCheck(checks, 'storage', deadline, () => probeStorage(writeProbe)),
      // The ingest queue's health is not just Redis reachability: BullMQ's
      // internal client can be disconnected even when a plain PING would
      // succeed. `getJobCounts` exercises the same commands the worker uses.
      ctx.ingestionQueue
        ? runCheck(checks, 'queue', deadline, async () => {
            await ctx.ingestionQueue!.getJobCounts('waiting', 'active');
          })
        : Promise.resolve(),
    ]);

    let status: EvalOutcome['status'] = 'ok';
    for (const c of Object.values(checks)) {
      if (c.unreachable) status = 'down';
      else if (c.slow && status === 'ok') status = 'degraded';
    }
    return { status, checks };
  }

  async function probeStorage(includeWrite: boolean): Promise<void> {
    if (!includeWrite) {
      // `head` on a key that does not exist still exercises credentials,
      // networking, and (for S3) the bucket's existence — it returns null
      // rather than throwing only when the backend actually answered.
      await ctx.storage.head('__health__/probe');
      return;
    }
    const key = `__health__/ready-${process.pid}-${randomUUID()}.txt`;
    try {
      await ctx.storage.put(key, 'ok', { contentType: 'text/plain' });
    } finally {
      // Always attempt cleanup, even if the write half-succeeded, so a failed
      // probe cannot leave an object behind.
      await ctx.storage.delete(key).catch(() => {
        /* the write result is what the probe reports on */
      });
    }
  }
}

async function probeDeep(
  out: Record<string, { status: 'ok' | 'slow' | 'down'; latencyMs: number; message?: string }>,
  name: string,
  timeoutMs: number,
  probe: () => Promise<unknown>,
): Promise<void> {
  const start = process.hrtime.bigint();
  try {
    await withTimeout(probe(), timeoutMs, name);
    const latencyMs = round(Number(process.hrtime.bigint() - start) / 1e6);
    out[name] = { status: latencyMs > SLOW_SLA_MS ? 'slow' : 'ok', latencyMs };
  } catch (err) {
    const latencyMs = round(Number(process.hrtime.bigint() - start) / 1e6);
    out[name] = {
      status: 'down',
      latencyMs,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function runCheck(
  checks: Checks,
  name: string,
  timeoutMs: number,
  check: () => Promise<unknown>,
): Promise<void> {
  const start = process.hrtime.bigint();
  try {
    await withTimeout(check(), timeoutMs, name);
    const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
    if (latencyMs > SLOW_SLA_MS) {
      // Answered, but too slowly. Not a page — a smell. 200 degraded so the
      // LB keeps routing and the operator sees `slow: [<name>]` in the body.
      checks[name] = { ok: true, slow: true, latencyMs: round(latencyMs) };
    } else {
      checks[name] = { ok: true, latencyMs: round(latencyMs) };
    }
  } catch (err) {
    // Distinguish "didn't answer inside the deadline" (unreachable) from
    // "answered with an error" (down but reachable — a query error, for
    // instance). Both are 503s, but the operator wants to know which.
    const message = err instanceof Error ? err.message : String(err);
    const timedOut = /timed out/.test(message);
    const connRefused = /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EPIPE|ETIMEDOUT/.test(message);
    const unreachable = timedOut || connRefused;
    const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
    checks[name] = {
      ok: false,
      error: message,
      unreachable,
      latencyMs: round(latencyMs),
    };
  }
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, name: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${name} check timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
