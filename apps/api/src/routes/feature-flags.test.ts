import { beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { isCarbonError, NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import { registerFeatureFlagRoutes } from './feature-flags.js';
import { _resetFeatureFlagCache, _resetSeededLatch } from '../services/feature-flags.js';

interface FlagDefRow {
  id: string;
  key: string;
  description: string | null;
  defaultValue: boolean;
}
interface OverrideRow {
  id: string;
  flagKey: string;
  scope: 'org' | 'user' | 'plan';
  scopeId: string;
  value: boolean;
}

interface Store {
  defs: FlagDefRow[];
  overrides: OverrideRow[];
  subs: Array<{
    orgId: string;
    plan: 'developer' | 'team' | 'enterprise';
    status: string;
    seats: number;
    currentPeriodEnd: Date | null;
  }>;
}

function collectStrings(
  x: unknown,
  out: Set<string> = new Set(),
  seen = new WeakSet(),
): Set<string> {
  if (x == null) return out;
  if (typeof x === 'string') {
    out.add(x);
    return out;
  }
  if (typeof x !== 'object') return out;
  if (seen.has(x as object)) return out;
  seen.add(x as object);
  if (Array.isArray(x)) {
    for (const v of x) collectStrings(v, out, seen);
    return out;
  }
  for (const k of Object.keys(x as Record<string, unknown>)) {
    collectStrings((x as Record<string, unknown>)[k], out, seen);
  }
  return out;
}

function makeDb(store: Store): AppContext['db'] {
  return {
    select: () => {
      let table: unknown = null;
      let whereStrings: Set<string> | null = null;
      const chain: any = {
        from: (t: unknown) => {
          table = t;
          return chain;
        },
        where: (expr: unknown) => {
          whereStrings = collectStrings(expr);
          return chain;
        },
        limit: async () => {
          const strs = whereStrings ?? new Set<string>();
          if (table === schema.featureFlagOverrides) {
            return store.overrides
              .filter((o) => strs.has(o.flagKey) && strs.has(o.scope) && strs.has(o.scopeId))
              .map((o) => ({ value: o.value }));
          }
          if (table === schema.featureFlags) {
            return store.defs
              .filter((d) => strs.has(d.key))
              .map((d) => ({ defaultValue: d.defaultValue }));
          }
          if (table === schema.subscriptions) {
            return store.subs
              .filter((s) => strs.has(s.orgId))
              .map((s) => ({
                plan: s.plan,
                status: s.status,
                seats: s.seats,
                currentPeriodEnd: s.currentPeriodEnd,
              }));
          }
          return [];
        },
        then: (onF: any, onR: any) => {
          if (table === schema.featureFlags) {
            return Promise.resolve(store.defs.map((d) => ({ ...d }))).then(onF, onR);
          }
          if (table === schema.featureFlagOverrides) {
            const strs = whereStrings;
            const rows = strs
              ? store.overrides.filter((o) => strs.has(o.flagKey))
              : store.overrides.slice();
            return Promise.resolve(rows.map((o) => ({ ...o }))).then(onF, onR);
          }
          return Promise.resolve([]).then(onF, onR);
        },
      };
      return chain;
    },
    insert: (table: unknown) => ({
      values: async (v: any) => {
        if (table === schema.featureFlags) {
          const rows = Array.isArray(v) ? v : [v];
          for (const r of rows) {
            store.defs.push({
              id: r.id,
              key: r.key,
              description: r.description ?? null,
              defaultValue: !!r.defaultValue,
            });
          }
        } else if (table === schema.featureFlagOverrides) {
          store.overrides.push({
            id: v.id,
            flagKey: v.flagKey,
            scope: v.scope,
            scopeId: v.scopeId,
            value: !!v.value,
          });
        }
      },
    }),
    delete: (table: unknown) => ({
      where: async (expr?: unknown) => {
        if (table === schema.featureFlagOverrides && expr) {
          const strs = collectStrings(expr);
          store.overrides = store.overrides.filter(
            (o) => !(strs.has(o.flagKey) && strs.has(o.scope) && strs.has(o.scopeId)),
          );
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

async function build(
  store: Store,
  auth: { orgId: string; scopes: string[] } | null,
): Promise<FastifyInstance> {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      reply.status(400).send({ error: { code: 'CARBON_INVALID_INPUT', message: err.message } });
      return;
    }
    if (isCarbonError(err)) {
      const status =
        err.code === 'CARBON_FORBIDDEN'
          ? 403
          : err.code === 'CARBON_NOT_FOUND'
            ? 404
            : err.code === 'CARBON_INVALID_INPUT'
              ? 400
              : 500;
      reply.status(status).send({ error: { code: err.code, message: err.message } });
      return;
    }
    reply.status(500).send({ error: { code: 'CARBON_INTERNAL', message: String(err) } });
  });
  if (auth) {
    app.addHook('onRequest', async (req) => {
      (req as AuthenticatedRequest).apiKey = {
        id: 'k',
        orgId: auth.orgId,
        prefix: 'aa11bb22cc33',
        scopes: auth.scopes,
        projectIds: null,
        expiresAt: null,
      };
    });
  }
  await registerFeatureFlagRoutes(app, makeCtx(store));
  await app.ready();
  return app;
}

function fresh(): Store {
  _resetFeatureFlagCache();
  _resetSeededLatch();
  return { defs: [], overrides: [], subs: [] };
}

describe('routes: /v1/feature-flags', () => {
  beforeEach(() => {
    _resetFeatureFlagCache();
    _resetSeededLatch();
  });

  it('GET lists the seeded built-in flags', async () => {
    const store = fresh();
    const app = await build(store, { orgId: 'orgA', scopes: ['read'] });
    const res = await app.inject({ method: 'GET', url: '/v1/feature-flags' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ key: string; effective: boolean }> };
    const keys = body.data.map((f) => f.key).sort();
    expect(keys).toContain('dashboard.ai_quality_v2');
    expect(keys).toContain('search.enabled');
    await app.close();
  });

  it('PATCH sets an org override and it appears in the next list', async () => {
    const store = fresh();
    const app = await build(store, { orgId: 'orgA', scopes: ['admin'] });
    const patch = await app.inject({
      method: 'PATCH',
      url: '/v1/feature-flags/dashboard.ai_quality_v2',
      payload: { scope: 'org', scopeId: 'orgA', value: true },
    });
    expect(patch.statusCode).toBe(200);
    _resetFeatureFlagCache();
    const list = await app.inject({ method: 'GET', url: '/v1/feature-flags' });
    const body = list.json() as { data: Array<{ key: string; effective: boolean }> };
    const flag = body.data.find((f) => f.key === 'dashboard.ai_quality_v2')!;
    expect(flag.effective).toBe(true);
    await app.close();
  });

  it('PATCH refuses to write for another org', async () => {
    const store = fresh();
    const app = await build(store, { orgId: 'orgA', scopes: ['admin'] });
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/feature-flags/search.enabled',
      payload: { scope: 'org', scopeId: 'orgB', value: false },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('PATCH requires admin scope', async () => {
    const store = fresh();
    const app = await build(store, { orgId: 'orgA', scopes: ['write'] });
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/feature-flags/search.enabled',
      payload: { scope: 'org', scopeId: 'orgA', value: false },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
