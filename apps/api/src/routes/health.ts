import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { AppContext } from '../context.js';

/**
 * `/health` is a lightweight liveness probe — the process is up.
 * `/ready` is a readiness probe — dependencies are reachable. Failure of
 *   /ready should cause a load balancer to drain traffic; failure of /health
 *   should cause the orchestrator to restart the pod.
 */
export interface HealthOptions {
  readonly release?: string;
  readonly timeoutMs?: number;
}

export async function registerHealthRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  options: HealthOptions = {},
): Promise<void> {
  const release = options.release ?? process.env.CARBON_RELEASE ?? 'dev';
  const timeoutMs = options.timeoutMs ?? 1000;

  app.get('/health', async () => ({ ok: true, service: 'carbon-api', version: '0.1.0' }));

  app.get('/v1/version', async () => ({
    version: '0.1.0',
    release,
    node: process.version,
    startedAt: new Date(Date.now() - Math.floor(process.uptime() * 1000)).toISOString(),
    uptimeSec: Math.floor(process.uptime()),
  }));

  app.get('/ready', async (_req, reply) => {
    const checks: Record<string, { ok: boolean; error?: string }> = {};

    await runCheck(checks, 'database', timeoutMs, () => ctx.db.execute(sql`select 1`));

    if (ctx.redis) {
      await runCheck(checks, 'redis', timeoutMs, () => ctx.redis?.ping() ?? Promise.resolve());
    }

    await runCheck(checks, 'storage', timeoutMs, async () => {
      const key = `__health__/ready-${process.pid}-${randomUUID()}.txt`;
      await ctx.storage.put(key, 'ok', { contentType: 'text/plain' });
      await ctx.storage.delete(key);
    });

    const ok = Object.values(checks).every((c) => c.ok);
    reply.status(ok ? 200 : 503);
    return { ok, checks };
  });
}

async function runCheck(
  checks: Record<string, { ok: boolean; error?: string }>,
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
