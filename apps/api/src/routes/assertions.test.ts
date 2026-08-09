import { describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { isCarbonError, NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import { registerAssertionRoutes } from './assertions.js';

interface Row {
  id: string;
  projectId: string;
  name: string;
  endpoint: string | null;
  kind: 'latency' | 'field' | 'status';
  config: Record<string, unknown>;
  enabled: boolean;
}

interface Store {
  rows: Row[];
  events: Array<{ action: string }>;
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
      orderBy: () => chain,
      $dynamic: () => chain,
      limit: async () => (lastTable === schema.assertionRules ? [...store.rows] : []),
      then: (onFulfilled: any, onRejected: any) => {
        const rows = lastTable === schema.assertionRules ? [...store.rows] : [];
        return Promise.resolve(rows).then(onFulfilled, onRejected);
      },
    };
    return chain;
  };
  return {
    select: () => selectChain(),
    insert: (table: unknown) => ({
      values: async (v: Row) => {
        if (table === schema.assertionRules) store.rows.push({ ...v });
        else if (table === schema.events)
          store.events.push({ action: (v as unknown as { action: string }).action });
      },
    }),
    update: (_table: unknown) => {
      let patch: Partial<Row> = {};
      const chain: any = {
        set: (p: Partial<Row>) => {
          patch = p;
          return chain;
        },
        where: () => chain,
        returning: async () => {
          const updated: Row[] = [];
          for (const r of store.rows) {
            Object.assign(r, patch);
            updated.push(r);
          }
          return updated;
        },
      };
      return chain;
    },
    delete: (_table: unknown) => ({
      where: () => ({
        returning: async () => {
          const removed = store.rows.map((r) => ({ id: r.id }));
          store.rows = [];
          return removed;
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

async function build(store: Store): Promise<FastifyInstance> {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      reply.status(400).send({ error: { code: 'CARBON_INVALID_INPUT', message: err.message } });
      return;
    }
    if (isCarbonError(err)) {
      const status =
        err.code === 'CARBON_NOT_FOUND' ? 404 : err.code === 'CARBON_FORBIDDEN' ? 403 : 500;
      reply.status(status).send({ error: { code: err.code, message: err.message } });
      return;
    }
    reply.status(500).send({ error: { code: 'CARBON_INTERNAL', message: String(err) } });
  });
  app.addHook('onRequest', async (req) => {
    (req as AuthenticatedRequest).apiKey = {
      id: 'k', orgId: 'org_1', prefix: 'aa', scopes: ['write'], projectIds: null, expiresAt: null,
    };
  });
  await registerAssertionRoutes(app, makeCtx(store));
  await app.ready();
  return app;
}

describe('assertion routes', () => {
  it('POST creates → GET lists → PATCH disables → DELETE removes', async () => {
    const store: Store = { rows: [], events: [] };
    const app = await build(store);
    const create = await app.inject({
      method: 'POST',
      url: '/v1/assertions',
      payload: { projectId: 'proj_1', name: 'p95-lt-200', kind: 'latency', config: { budgetMs: 200 } },
    });
    expect(create.statusCode).toBe(201);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]!.enabled).toBe(true);

    const list = await app.inject({ method: 'GET', url: '/v1/assertions?projectId=proj_1' });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { data: unknown[] }).data).toHaveLength(1);

    const id = store.rows[0]!.id;
    const patch = await app.inject({
      method: 'PATCH', url: `/v1/assertions/${id}`, payload: { enabled: false },
    });
    expect(patch.statusCode).toBe(200);
    expect(store.rows[0]!.enabled).toBe(false);

    const del = await app.inject({ method: 'DELETE', url: `/v1/assertions/${id}` });
    expect(del.statusCode).toBe(204);
    expect(store.rows).toHaveLength(0);
  });

  it('rejects invalid kind enum with 400', async () => {
    const store: Store = { rows: [], events: [] };
    const app = await build(store);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/assertions',
      payload: { projectId: 'proj_1', name: 'bad', kind: 'not-a-kind', config: {} },
    });
    expect(res.statusCode).toBe(400);
    expect(store.rows).toHaveLength(0);
  });

  it('DELETE of a missing rule returns 404', async () => {
    const store: Store = { rows: [], events: [] };
    const app = await build(store);
    const res = await app.inject({ method: 'DELETE', url: '/v1/assertions/nope' });
    expect(res.statusCode).toBe(404);
  });
});
