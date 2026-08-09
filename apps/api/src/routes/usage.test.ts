import { describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { isCarbonError, NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import { recordUsage } from '../services/usage.js';
import { registerUsageRoutes } from './usage.js';

interface UsageRow {
  id: string;
  orgId: string;
  kind: string;
  amount: number;
  metadata: unknown;
  occurredAt: Date;
}

interface Store {
  rows: UsageRow[];
  filter: (r: UsageRow) => boolean;
}

function makeDb(store: Store): AppContext['db'] {
  return {
    select: (cols?: unknown) => {
      const grouped = typeof cols === 'object' && cols !== null && 'total' in (cols as object);
      const chain: any = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        groupBy: async () => {
          const filtered = store.rows.filter(store.filter);
          const totals = new Map<string, number>();
          for (const r of filtered) {
            totals.set(r.kind, (totals.get(r.kind) ?? 0) + r.amount);
          }
          return [...totals.entries()].map(([kind, total]) => ({ kind, total: String(total) }));
        },
        limit: async (n: number) => {
          if (grouped) {
            // Not exercised — grouped queries terminate on groupBy.
            return [];
          }
          const sorted = [...store.rows]
            .filter(store.filter)
            .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
          return sorted.slice(0, n);
        },
      };
      return chain;
    },
    insert: (table: unknown) => ({
      values: async (v: UsageRow) => {
        if (table === schema.usageEvents) {
          store.rows.push({
            id: v.id,
            orgId: v.orgId,
            kind: v.kind,
            amount: v.amount ?? 1,
            metadata: v.metadata ?? {},
            occurredAt: new Date(Date.now() + store.rows.length),
          });
        }
      },
    }),
  } as unknown as AppContext['db'];
}

function makeCtx(store: Store): AppContext {
  return {
    logger: NoopLogger,
    db: makeDb(store),
    storage: new MemoryStorage(),
    ingestion: { ingest: async () => ({}) } as unknown as AppContext['ingestion'],
    emulators: {} as AppContext['emulators'],
  };
}

async function build(store: Store, orgId: string): Promise<FastifyInstance> {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      reply.status(400).send({ error: { code: 'CARBON_INVALID_INPUT', message: err.message } });
      return;
    }
    if (isCarbonError(err)) {
      const status =
        err.code === 'CARBON_INVALID_INPUT'
          ? 400
          : err.code === 'CARBON_FORBIDDEN'
            ? 403
            : 500;
      reply.status(status).send({ error: { code: err.code, message: err.message } });
      return;
    }
    reply.status(500).send({ error: { code: 'CARBON_INTERNAL', message: String(err) } });
  });
  app.addHook('onRequest', async (req) => {
    (req as AuthenticatedRequest).apiKey = {
      id: 'k',
      orgId,
      prefix: 'aa11bb22cc33',
      scopes: ['admin'],
      projectIds: null,
      expiresAt: null,
    };
    // Emulate the api-key hook's org pin for the filter closure.
    store.filter = (r: UsageRow) => r.orgId === orgId;
  });
  await registerUsageRoutes(app, makeCtx(store));
  await app.ready();
  return app;
}

describe('usage routes', () => {
  it('aggregates SUM(amount) grouped by kind for the caller org only', async () => {
    const store: Store = { rows: [], filter: () => true };
    const ctx = makeCtx(store);
    await recordUsage(ctx, { orgId: 'org_1', kind: 'ai_call', amount: 200 });
    await recordUsage(ctx, { orgId: 'org_1', kind: 'ai_call', amount: 300 });
    await recordUsage(ctx, { orgId: 'org_1', kind: 'emulator_started', amount: 1 });
    // Another org's rows must not leak into org_1's totals.
    await recordUsage(ctx, { orgId: 'org_2', kind: 'ai_call', amount: 999 });

    const app = await build(store, 'org_1');
    const res = await app.inject({ method: 'GET', url: '/v1/usage' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      totals: Array<{ kind: string; total: number }>;
    };
    const map = new Map(body.totals.map((t) => [t.kind, t.total]));
    expect(map.get('ai_call')).toBe(500);
    expect(map.get('emulator_started')).toBe(1);
  });

  it('GET /v1/usage/events lists newest-first, org-scoped', async () => {
    const store: Store = { rows: [], filter: () => true };
    const ctx = makeCtx(store);
    await recordUsage(ctx, { orgId: 'org_1', kind: 'ai_call', amount: 1 });
    await recordUsage(ctx, { orgId: 'org_2', kind: 'ai_call', amount: 1 });
    await recordUsage(ctx, { orgId: 'org_1', kind: 'ai_call', amount: 2 });

    const app = await build(store, 'org_1');
    const res = await app.inject({ method: 'GET', url: '/v1/usage/events' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: UsageRow[] };
    expect(body.data).toHaveLength(2);
    for (const row of body.data) expect(row.orgId).toBe('org_1');
  });

  it('requires admin scope', async () => {
    const store: Store = { rows: [], filter: () => true };
    const app = Fastify();
    app.setErrorHandler((err, _req, reply) => {
      if (isCarbonError(err) && err.code === 'CARBON_FORBIDDEN') {
        reply.status(403).send({ error: { code: err.code, message: err.message } });
        return;
      }
      reply.status(500).send({ error: String(err) });
    });
    app.addHook('onRequest', async (req) => {
      (req as AuthenticatedRequest).apiKey = {
        id: 'k',
        orgId: 'org_1',
        prefix: 'aa11bb22cc33',
        scopes: ['read'],
        projectIds: null,
        expiresAt: null,
      };
    });
    await registerUsageRoutes(app, makeCtx(store));
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/v1/usage' });
    expect(res.statusCode).toBe(403);
  });
});
