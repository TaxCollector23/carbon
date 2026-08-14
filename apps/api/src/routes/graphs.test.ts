import { describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { isCarbonError, NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import { registerGraphRoutes } from './graphs.js';

/**
 * The graph route reads the latest IR blob from storage and rebuilds a
 * BehaviorGraph on the fly. We seed a minimal IR that has one resource with
 * read + write endpoints so the builder yields a non-trivial graph, and
 * verify the response shape rather than the graph internals.
 */
function makeCtx(storage = new MemoryStorage()): AppContext {
  const db = {
    // resolveProjectAccess: apiKey.orgId=org_1 → look up project by (orgId, slug)
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ id: 'proj_1', orgId: 'org_1', slug: 'demo' }],
        }),
      }),
    }),
  } as unknown as AppContext['db'];
  return {
    logger: NoopLogger,
    db,
    storage,
    ingestion: { ingest: async () => ({}) } as unknown as AppContext['ingestion'],
    emulators: {} as AppContext['emulators'],
  };
}

async function build(storage: MemoryStorage): Promise<FastifyInstance> {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      reply.status(400).send({ error: { code: 'CARBON_INVALID_INPUT', message: err.message } });
      return;
    }
    if (isCarbonError(err)) {
      const status = err.code === 'CARBON_NOT_FOUND' ? 404 : 500;
      reply.status(status).send({ error: { code: err.code, message: err.message } });
      return;
    }
    reply.status(500).send({ error: { code: 'CARBON_INTERNAL', message: String(err) } });
  });
  app.addHook('onRequest', async (req) => {
    (req as AuthenticatedRequest).apiKey = {
      id: 'k',
      orgId: 'org_1',
      prefix: 'aa',
      scopes: ['read'],
      projectIds: null,
      expiresAt: null,
    };
  });
  await registerGraphRoutes(app, makeCtx(storage));
  await app.ready();
  return app;
}

const irFixture = {
  version: 1,
  api: { name: 't', version: '0', source: { kind: 'openapi', ingestedAt: 0 } },
  servers: [],
  auth: [],
  resources: [{ id: 'customer', name: 'Customer', primaryKey: 'id', schema: { kind: 'unknown' } }],
  endpoints: [
    {
      id: 'GET:/customers',
      method: 'GET',
      path: '/customers',
      operation: 'list',
      resource: 'customer',
      params: [],
      requestBody: null,
      responses: [],
      auth: [],
      meta: {},
    },
    {
      id: 'POST:/customers',
      method: 'POST',
      path: '/customers',
      operation: 'create',
      resource: 'customer',
      params: [],
      requestBody: null,
      responses: [],
      auth: [],
      meta: {},
    },
  ],
  relationships: [],
  examples: [],
  meta: {},
};

describe('graph route', () => {
  it('404 when no IR blob is present for the project', async () => {
    const app = await build(new MemoryStorage());
    const res = await app.inject({ method: 'GET', url: '/v1/projects/demo/graph' });
    expect(res.statusCode).toBe(404);
  });

  it('returns { nodes, edges, transitions, constraints } for an ingested IR', async () => {
    const storage = new MemoryStorage();
    await storage.put('projects/org_1/demo/ir/ir-abc.json', JSON.stringify(irFixture));
    const app = await build(storage);
    const res = await app.inject({ method: 'GET', url: '/v1/projects/demo/graph' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      projectId: string;
      irId?: string;
      nodes: Array<{ id: string; name: string; readers: number; writers: number }>;
      edges: Array<{ from: string; to: string; kind: string }>;
      transitions: number;
      constraints: number;
    };
    expect(body.projectId).toBe('demo');
    expect(body.irId).toBe('ir-abc');
    expect(body.nodes).toHaveLength(1);
    expect(body.nodes[0]!.name).toBe('Customer');
    expect(body.nodes[0]!.readers).toBeGreaterThan(0);
    expect(body.nodes[0]!.writers).toBeGreaterThan(0);
  });
});
