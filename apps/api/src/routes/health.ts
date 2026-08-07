import type { FastifyInstance } from 'fastify';
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
}

export async function registerHealthRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  options: HealthOptions = {},
): Promise<void> {
  const release = options.release ?? process.env.CARBON_RELEASE ?? 'dev';

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

    try {
      await ctx.db.execute(sql`select 1`);
      checks.database = { ok: true };
    } catch (err) {
      checks.database = { ok: false, error: (err as Error).message };
    }

    if (ctx.redis) {
      try {
        await ctx.redis.ping();
        checks.redis = { ok: true };
      } catch (err) {
        checks.redis = { ok: false, error: (err as Error).message };
      }
    }

    try {
      const key = `__health__/ready-${process.pid}.txt`;
      await ctx.storage.put(key, 'ok', { contentType: 'text/plain' });
      await ctx.storage.delete(key);
      checks.storage = { ok: true };
    } catch (err) {
      checks.storage = { ok: false, error: (err as Error).message };
    }

    const ok = Object.values(checks).every((c) => c.ok);
    reply.status(ok ? 200 : 503);
    return { ok, checks };
  });
}
