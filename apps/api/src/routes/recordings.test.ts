import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { isCarbonError, NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import type { AppContext } from '../context.js';
import { registerRecordingRoutes } from './recordings.js';

/**
 * End-to-end replay against a locally-bound stub upstream. We assert on the
 * per-exchange diff surface rather than any DB persistence — the route's
 * DB-write path is exercised via the maybeInsertReplay branch that no-ops
 * when the caller has no orgId, which is exactly the unauth harness below.
 */

function makeCtx(storage: MemoryStorage): AppContext {
  return {
    logger: NoopLogger,
    db: {} as unknown as AppContext['db'],
    storage,
    ingestion: { ingest: async () => ({}) } as unknown as AppContext['ingestion'],
    emulators: {} as AppContext['emulators'],
  };
}

async function build(storage: MemoryStorage) {
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
    reply.status(500).send({
      error: { code: 'CARBON_INTERNAL', message: err instanceof Error ? err.message : 'error' },
    });
  });
  await registerRecordingRoutes(app, makeCtx(storage));
  await app.ready();
  return app;
}

describe('recording replay routes', () => {
  let upstream: Server;
  let upstreamUrl: string;

  beforeAll(async () => {
    // The stub returns a 200 for GET /ok and a 500 for GET /broken so we can
    // observe both the "match" and "drift" branches in one recording.
    upstream = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/ok') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
        return;
      }
      if (req.method === 'GET' && req.url === '/broken') {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end('{"error":"boom"}');
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const addr = upstream.address() as AddressInfo;
    upstreamUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  it('returns per-exchange diff results and marks drift when a status differs', async () => {
    const storage = new MemoryStorage();
    const recording = {
      id: 'rec_e2e',
      source: 'proxy',
      startedAt: 0,
      endedAt: 0,
      exchanges: [
        {
          id: 'xch_ok',
          request: {
            method: 'GET',
            url: 'https://recorded.example.com/ok',
            headers: {},
            body: null,
            receivedAt: 1,
          },
          response: { status: 200, headers: {}, body: '{"ok":true}', sentAt: 2 },
          latencyMs: 1,
          redactions: [],
        },
        {
          id: 'xch_drift',
          request: {
            method: 'GET',
            url: 'https://recorded.example.com/broken',
            headers: {},
            body: null,
            receivedAt: 3,
          },
          // Recording says 200 but the stub returns 500 → drift.
          response: { status: 200, headers: {}, body: '{"ok":true}', sentAt: 4 },
          latencyMs: 1,
          redactions: [],
        },
      ],
    };
    await storage.put('projects/acme/recordings/rec_e2e.jsonl', JSON.stringify(recording));

    const app = await build(storage);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/projects/acme/recordings/rec_e2e/replay',
      payload: { targetUrl: upstreamUrl },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      status: string;
      results: Array<{ exchangeId: string; status: number | null; diff: string[] }>;
    };
    expect(body.status).toBe('drift');
    expect(body.results).toHaveLength(2);
    const okRow = body.results.find((r) => r.exchangeId === 'xch_ok');
    const driftRow = body.results.find((r) => r.exchangeId === 'xch_drift');
    expect(okRow?.status).toBe(200);
    expect(okRow?.diff).toEqual([]);
    expect(driftRow?.status).toBe(500);
    expect(driftRow?.diff.length).toBeGreaterThan(0);
  });

  it('lists exchanges for a recording', async () => {
    const storage = new MemoryStorage();
    await storage.put(
      'projects/acme/recordings/rec_list.jsonl',
      JSON.stringify({
        id: 'rec_list',
        source: 'proxy',
        startedAt: 0,
        endedAt: 0,
        exchanges: [
          {
            id: 'xch_1',
            request: {
              method: 'GET',
              url: 'https://api.example.com/a',
              headers: {},
              body: null,
              receivedAt: 10,
            },
            response: { status: 200, headers: {}, body: 'ok', sentAt: 12 },
            latencyMs: 2,
            redactions: [],
          },
        ],
      }),
    );
    const app = await build(storage);
    const res = await app.inject('/v1/projects/acme/recordings/rec_list/exchanges');
    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; exchanges: Array<{ method: string; status: number }> };
    expect(body.id).toBe('rec_list');
    expect(body.exchanges).toHaveLength(1);
    expect(body.exchanges[0]!.method).toBe('GET');
    expect(body.exchanges[0]!.status).toBe(200);
  });

  it('404s when the recording does not exist', async () => {
    const storage = new MemoryStorage();
    const app = await build(storage);
    const res = await app.inject('/v1/projects/acme/recordings/nope/exchanges');
    expect(res.statusCode).toBe(404);
  });
});
