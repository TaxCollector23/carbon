import { describe, expect, it, vi, afterEach } from 'vitest';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { isCarbonError, NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import { registerContractRoutes } from './contract.js';

const project = { id: 'proj_1', name: 'demo' };

function makeCtx(): AppContext {
  const db = {
    select: () => ({
      from: (t: unknown) => ({
        where: () => ({
          limit: async () => (t === schema.projects ? [project] : []),
        }),
      }),
    }),
  } as unknown as AppContext['db'];
  return {
    logger: NoopLogger,
    db,
    storage: new MemoryStorage(),
    ingestion: { ingest: async () => ({}) } as unknown as AppContext['ingestion'],
    emulators: {} as AppContext['emulators'],
  };
}

async function build() {
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
  await registerContractRoutes(app, makeCtx());
  await app.ready();
  return app;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('contract-check route', () => {
  it('reports ok=true for a passing sample against a matching expectedSchema', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ id: '1', name: 'Alice' }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const app = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/projects/proj_1/contract-check',
      payload: {
        url: 'https://api.example.com',
        sampleRequests: [{
          method: 'GET', path: '/users/1',
          expectedSchema: {
            type: 'object',
            properties: { id: { type: 'string' }, name: { type: 'string' } },
            required: ['id', 'name'],
          },
        }],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      summary: { total: number; passed: number; failed: number };
      results: Array<{ ok: boolean; status: number | null; mismatches?: unknown[] }>;
    };
    expect(body.summary).toEqual({ total: 1, passed: 1, failed: 0 });
    expect(body.results[0]?.ok).toBe(true);
    expect(body.results[0]?.status).toBe(200);
  });

  it('reports mismatches when the response body diverges from expectedSchema', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ id: 42 }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const app = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/projects/proj_1/contract-check',
      payload: {
        url: 'https://api.example.com/',
        sampleRequests: [{
          method: 'GET', path: '/users/1',
          expectedSchema: {
            type: 'object',
            properties: { id: { type: 'string' }, name: { type: 'string' } },
            required: ['id', 'name'],
          },
        }],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      summary: { total: number; passed: number; failed: number };
      results: Array<{ ok: boolean; mismatches?: Array<{ path: string }> }>;
    };
    expect(body.summary.passed).toBe(0);
    expect(body.summary.failed).toBe(1);
    expect(body.results[0]?.ok).toBe(false);
    expect(body.results[0]?.mismatches?.length).toBeGreaterThan(0);
  });

  it('404 when the project does not exist', async () => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    const app = Fastify();
    const ctx = {
      logger: NoopLogger,
      db: {
        select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
      } as unknown as AppContext['db'],
      storage: new MemoryStorage(),
      ingestion: { ingest: async () => ({}) } as unknown as AppContext['ingestion'],
      emulators: {} as AppContext['emulators'],
    };
    app.setErrorHandler((err, _req, reply) => {
      if (isCarbonError(err) && err.code === 'CARBON_NOT_FOUND') {
        reply.status(404).send({ error: { code: err.code, message: err.message } });
        return;
      }
      reply.status(500).send({ error: String(err) });
    });
    app.addHook('onRequest', async (req) => {
      (req as AuthenticatedRequest).apiKey = {
        id: 'k', orgId: 'org_1', prefix: 'aa', scopes: ['write'], projectIds: null, expiresAt: null,
      };
    });
    await registerContractRoutes(app, ctx);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/projects/missing/contract-check',
      payload: { url: 'https://api.example.com', sampleRequests: [{ method: 'GET', path: '/' }] },
    });
    expect(res.statusCode).toBe(404);
  });
});
