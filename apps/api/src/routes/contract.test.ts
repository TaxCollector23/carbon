import { afterAll, beforeAll, describe, expect, it, vi, afterEach } from 'vitest';
import Fastify from 'fastify';
import { WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';
import { ZodError } from 'zod';
import { isCarbonError, NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import { registerContractRoutes } from './contract.js';

const project = { id: 'proj_1', name: 'demo', orgId: 'org_1', slug: 'demo' };

function makeCtx(): AppContext {
  const db = {
    select: () => ({
      from: (t: unknown) => {
        const chain: any = {
          where: () => chain,
          limit: async () => (t === schema.projects ? [project] : []),
        };
        return chain;
      },
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

describe('contract-check wsChecks', () => {
  let wss: WebSocketServer;
  let wsUrl: string;

  beforeAll(async () => {
    // Tiny in-process WS echo-with-greeting server: on connect, immediately
    // sends `{"kind":"welcome"}`; on every message received, echoes it back.
    wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => wss.once('listening', resolve));
    const port = (wss.address() as AddressInfo).port;
    wsUrl = `ws://127.0.0.1:${port}`;
    wss.on('connection', (ws) => {
      ws.send(JSON.stringify({ kind: 'welcome' }));
      ws.on('message', (raw) => ws.send(raw.toString()));
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });

  it('opens the socket, sends the first frame, collects the expected count, and reports ok=true', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/projects/demo/contract-check',
      payload: {
        url: 'https://api.example.com', // required by the schema; sampleRequests defaults to a single GET /
        sampleRequests: [{ method: 'GET', path: '/health' }],
        wsChecks: [
          {
            url: wsUrl,
            sendMessage: { hello: true },
            expectFrames: 2,
            timeoutMs: 2000,
            expectSchema: { type: 'object' },
          },
        ],
      },
    });
    // The REST arm hits a fake URL and will error out — we only care about
    // the ws arm shape here.
    const body = res.json() as {
      ws?: Array<{ url: string; framesReceived: number; ok?: boolean; frames: unknown[] }>;
    };
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(body.ws)).toBe(true);
    const [check] = body.ws!;
    expect(check).toBeDefined();
    expect(check!.url).toBe(wsUrl);
    // welcome frame + echoed sendMessage frame
    expect(check!.framesReceived).toBeGreaterThanOrEqual(2);
    expect(check!.frames.length).toBeGreaterThanOrEqual(2);
  });

  it('reports an error string when the socket cannot connect', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/projects/demo/contract-check',
      payload: {
        url: 'https://api.example.com',
        sampleRequests: [{ method: 'GET', path: '/' }],
        wsChecks: [
          {
            url: 'ws://127.0.0.1:1', // nothing listens on port 1
            expectFrames: 1,
            timeoutMs: 300,
          },
        ],
      },
    });
    const body = res.json() as { ws?: Array<{ error?: string }> };
    expect(res.statusCode).toBe(200);
    expect(body.ws?.[0]?.error).toBeTruthy();
  });
});

