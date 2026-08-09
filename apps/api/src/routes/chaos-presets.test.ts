import { describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { isCarbonError, NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import { registerChaosPresetRoutes } from './chaos-presets.js';

interface PresetRow {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  rules: unknown[];
  builtIn: boolean;
  createdAt: Date;
}

interface Store {
  rows: PresetRow[];
  events: Array<{ orgId: string; action: string; metadata: unknown }>;
}

function makeDb(store: Store): AppContext['db'] {
  let lastTable: unknown = null;
  const selectChain = () => {
    const chain: any = {
      from: (t: unknown) => {
        lastTable = t;
        return chain;
      },
      where: () => chain,
      orderBy: async () =>
        lastTable === schema.chaosPresets ? [...store.rows] : [],
      then: (onFulfilled: any, onRejected: any) =>
        Promise.resolve([] as unknown[]).then(onFulfilled, onRejected),
    };
    return chain;
  };
  return {
    select: () => selectChain(),
    insert: (table: unknown) => ({
      values: async (v: PresetRow) => {
        if (table === schema.chaosPresets) {
          if (store.rows.some((r) => r.orgId === v.orgId && r.name === v.name)) {
            throw new Error('duplicate key value violates unique constraint');
          }
          store.rows.push({
            id: v.id,
            orgId: v.orgId,
            name: v.name,
            description: (v as { description?: string | null }).description ?? null,
            rules: v.rules ?? [],
            builtIn: v.builtIn ?? false,
            createdAt: new Date(),
          });
        } else if (table === schema.events) {
          store.events.push({
            orgId: (v as unknown as { orgId: string }).orgId,
            action: (v as unknown as { action: string }).action,
            metadata: (v as unknown as { metadata: unknown }).metadata,
          });
        }
      },
    }),
    delete: (_table: unknown) => ({
      where: () => ({
        returning: async () => {
          // Route delete: id + orgId + built_in=false. We can't inspect the
          // predicate; instead the test seeds the store with matching rows
          // and inspects deletion outcomes by looking at what's left. Delete
          // every non-built-in row (tests only exercise single-row deletes
          // and manage state carefully).
          const preserved: PresetRow[] = [];
          const deleted: PresetRow[] = [];
          for (const r of store.rows) {
            if (r.builtIn) preserved.push(r);
            else deleted.push(r);
          }
          store.rows = preserved;
          return deleted.map((r) => ({ id: r.id }));
        },
      }),
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
  scopes: readonly string[] = ['admin'],
  orgId = 'org_1',
): Promise<FastifyInstance> {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      reply.status(400).send({ error: { code: 'CARBON_INVALID_INPUT', message: err.message } });
      return;
    }
    if (isCarbonError(err)) {
      const status =
        err.code === 'CARBON_FORBIDDEN' ? 403
          : err.code === 'CARBON_NOT_FOUND' ? 404
          : err.code === 'CARBON_CONFLICT' ? 409
          : err.code === 'CARBON_INVALID_INPUT' ? 400
          : 500;
      reply.status(status).send({ error: { code: err.code, message: err.message } });
      return;
    }
    reply.status(500).send({ error: { code: 'CARBON_INTERNAL', message: String(err) } });
  });
  app.addHook('onRequest', async (req) => {
    (req as AuthenticatedRequest).apiKey = {
      id: 'key_test',
      orgId,
      prefix: 'aa11bb22cc33',
      scopes: [...scopes],
      projectIds: null,
      expiresAt: null,
    };
  });
  await registerChaosPresetRoutes(app, makeCtx(store));
  await app.ready();
  return app;
}

describe('chaos-preset routes', () => {
  it('POST creates a preset; GET lists it; DELETE (admin) removes it', async () => {
    const store: Store = { rows: [], events: [] };
    const app = await build(store);
    const create = await app.inject({
      method: 'POST',
      url: '/v1/chaos-presets',
      payload: { name: 'flaky-payments', rules: [{ kind: 'error', probability: 0.1, status: 503 }] },
    });
    expect(create.statusCode).toBe(201);
    expect(store.rows).toHaveLength(1);
    expect(store.events.some((e) => e.action === 'chaos_preset.created')).toBe(true);

    const list = await app.inject({ method: 'GET', url: '/v1/chaos-presets' });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { data: unknown[] }).data).toHaveLength(1);

    const del = await app.inject({
      method: 'DELETE',
      url: `/v1/chaos-presets/${store.rows[0]!.id}`,
    });
    expect(del.statusCode).toBe(204);
    expect(store.rows).toHaveLength(0);
  });

  it('DELETE requires admin scope', async () => {
    const store: Store = {
      rows: [{
        id: 'chaos_1', orgId: 'org_1', name: 'p', description: null,
        rules: [], builtIn: false, createdAt: new Date(),
      }],
      events: [],
    };
    const app = await build(store, ['write']);
    const res = await app.inject({ method: 'DELETE', url: '/v1/chaos-presets/chaos_1' });
    expect(res.statusCode).toBe(403);
    expect(store.rows).toHaveLength(1);
  });

  it('DELETE of a built_in preset returns 404 (never let the caller remove seeded presets)', async () => {
    const store: Store = {
      rows: [{
        id: 'chaos_builtin', orgId: 'org_1', name: 'errors-only', description: null,
        rules: [], builtIn: true, createdAt: new Date(),
      }],
      events: [],
    };
    const app = await build(store);
    const res = await app.inject({ method: 'DELETE', url: '/v1/chaos-presets/chaos_builtin' });
    expect(res.statusCode).toBe(404);
    expect(store.rows).toHaveLength(1);
  });

  it('POST duplicate name → 409 CARBON_CONFLICT', async () => {
    const store: Store = {
      rows: [{
        id: 'chaos_1', orgId: 'org_1', name: 'dup', description: null,
        rules: [], builtIn: false, createdAt: new Date(),
      }],
      events: [],
    };
    const app = await build(store);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chaos-presets',
      payload: { name: 'dup', rules: [{ kind: 'error' }] },
    });
    expect(res.statusCode).toBe(409);
  });
});
