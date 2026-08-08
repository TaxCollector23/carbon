import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { AlwaysReady, type Lifecycle } from '../lifecycle.js';

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

type CheckResult = { ok: boolean; error?: string };
type Checks = Record<string, CheckResult>;

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

  let cached: { at: number; ok: boolean; checks: Checks } | null = null;
  // Concurrent probes share one evaluation instead of stampeding the database
  // the instant the cache expires.
  let inFlight: Promise<{ ok: boolean; checks: Checks }> | null = null;
  let lastWriteProbeAt = 0;

  app.get('/health', async () => ({ ok: true, service: 'carbon-api', version: '0.1.0' }));

  app.get('/v1/version', async () => ({
    version: '0.1.0',
    release,
    node: process.version,
    startedAt: new Date(Date.now() - Math.floor(process.uptime() * 1000)).toISOString(),
    uptimeSec: Math.floor(process.uptime()),
  }));

  app.get('/ready', async (_req, reply) => {
    // Draining short-circuits everything below. During a rolling deploy the
    // dependencies are still perfectly healthy — the point is to tell the load
    // balancer to stop sending work here before the listener closes.
    if (lifecycle.draining) {
      reply.status(503);
      reply.header('cache-control', 'no-store');
      return { ok: false, draining: true, checks: {} };
    }

    const now = Date.now();
    if (cached && now - cached.at < cacheMs) {
      reply.status(cached.ok ? 200 : 503);
      reply.header('cache-control', 'no-store');
      return { ok: cached.ok, checks: cached.checks, cached: true };
    }

    inFlight ??= evaluate().finally(() => {
      inFlight = null;
    });
    const result = await inFlight;
    cached = { at: Date.now(), ...result };

    reply.status(result.ok ? 200 : 503);
    reply.header('cache-control', 'no-store');
    return { ok: result.ok, checks: result.checks, cached: false };
  });

  async function evaluate(): Promise<{ ok: boolean; checks: Checks }> {
    const checks: Checks = {};
    const writeProbe = Date.now() - lastWriteProbeAt >= writeProbeIntervalMs;
    if (writeProbe) lastWriteProbeAt = Date.now();

    // Run the probes concurrently: three 1s timeouts in series means a
    // readiness check can take 3s, longer than most LB probe timeouts.
    await Promise.all([
      runCheck(checks, 'database', timeoutMs, () => ctx.db.execute(sql`select 1`)),
      ctx.redis
        ? runCheck(checks, 'redis', timeoutMs, () => ctx.redis?.ping() ?? Promise.resolve())
        : Promise.resolve(),
      runCheck(checks, 'storage', timeoutMs, () => probeStorage(writeProbe)),
    ]);

    return { ok: Object.values(checks).every((c) => c.ok), checks };
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

async function runCheck(
  checks: Checks,
  name: string,
  timeoutMs: number,
  check: () => Promise<unknown>,
): Promise<void> {
  try {
    await withTimeout(check(), timeoutMs, name);
    checks[name] = { ok: true };
  } catch (err) {
    checks[name] = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
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
