import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { isCarbonError, NoopLogger } from '@carbon/core';
import { MemoryStorage, type Storage, type StorageStream } from '@carbon/storage';
import type { AppContext } from '../context.js';
import { registerArtifactRoutes } from './artifacts.js';
import { registerRecordingRoutes } from './recordings.js';

function makeCtx(storage: Storage): AppContext {
  return {
    logger: NoopLogger,
    // No project-lookup needed: the unauth path in resolveProjectAccess
    // returns immediately without touching the DB.
    db: {} as unknown as AppContext['db'],
    storage,
    ingestion: { ingest: async () => ({}) } as unknown as AppContext['ingestion'],
    emulators: {} as AppContext['emulators'],
  };
}

async function build(storage: Storage) {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      reply.status(400).send({ error: { code: 'CARBON_INVALID_INPUT', message: err.message } });
      return;
    }
    if (isCarbonError(err)) {
      const status =
        err.code === 'CARBON_NOT_FOUND' ? 404 : err.code === 'CARBON_INVALID_INPUT' ? 400 : 500;
      reply.status(status).send({ error: { code: err.code, message: err.message } });
      return;
    }
    reply.status(500).send({
      error: { code: 'CARBON_INTERNAL', message: err instanceof Error ? err.message : 'error' },
    });
  });
  // Unauthenticated route: resolveProjectAccess short-circuits when there
  // is no apiKey on the request, so we skip the api-key hook entirely.
  await registerArtifactRoutes(app, makeCtx(storage));
  await registerRecordingRoutes(app, makeCtx(storage));
  await app.ready();
  return app;
}

/**
 * MemoryStorage wrapper that also implements getStream. Lets us exercise the
 * streaming branch without spinning up a filesystem backend in-test.
 */
class StreamingMemoryStorage extends MemoryStorage {
  async getStream(key: string): Promise<StorageStream | null> {
    const bytes = await this.get(key);
    if (!bytes) return null;
    const id =
      key
        .split('/')
        .pop()
        ?.replace(/\.[^.]+$/, '') ?? key;
    return {
      stream: Readable.from(Buffer.from(bytes)),
      size: bytes.byteLength,
      etag: `W/"${id}"`,
    };
  }
}

describe('artifact routes', () => {
  it('streams the artifact with content-hash etag and immutable cache-control', async () => {
    const storage = new StreamingMemoryStorage();
    const payload = JSON.stringify({ hello: 'ir' });
    await storage.put('projects/acme/ir/abc123.json', payload);

    const app = await build(storage);
    const res = await app.inject('/v1/projects/acme/ir/abc123');

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(payload);
    expect(res.headers['content-type']).toBe('application/json');
    expect(res.headers['etag']).toBe('W/"abc123"');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(res.headers['content-length']).toBe(String(Buffer.byteLength(payload)));
  });

  it('returns 304 when If-None-Match matches the artifact id', async () => {
    const storage = new StreamingMemoryStorage();
    await storage.put('projects/acme/graphs/g1.json', '{"g":1}');

    const app = await build(storage);
    const res = await app.inject({
      url: '/v1/projects/acme/graphs/g1',
      headers: { 'if-none-match': 'W/"g1"' },
    });

    expect(res.statusCode).toBe(304);
    expect(res.body).toBe('');
    expect(res.headers['etag']).toBe('W/"g1"');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('falls back to buffered get when the backend lacks getStream', async () => {
    // Plain MemoryStorage has no getStream — the route must still serve bytes
    // via the legacy `get` path, keeping older backends functional.
    const storage = new MemoryStorage();
    expect(typeof (storage as Storage).getStream).toBe('undefined');
    const payload = JSON.stringify({ from: 'buffered' });
    await storage.put('projects/acme/ir/xyz.json', payload);

    const app = await build(storage);
    const res = await app.inject('/v1/projects/acme/ir/xyz');

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(payload);
    expect(res.headers['etag']).toBe('W/"xyz"');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('404s when the artifact is missing', async () => {
    const storage = new StreamingMemoryStorage();
    const app = await build(storage);
    const res = await app.inject('/v1/projects/acme/ir/missing');
    expect(res.statusCode).toBe(404);
  });

  it('lists recordings with per-recording metadata pulled from the body', async () => {
    const storage = new StreamingMemoryStorage();
    const recording = {
      id: 'rec_test1',
      source: 'proxy',
      startedAt: 1_700_000_000_000,
      endedAt: 1_700_000_000_500,
      exchanges: [
        {
          id: 'xch_a',
          request: {
            method: 'GET',
            url: 'https://api.example.com/things/1',
            headers: {},
            body: null,
            receivedAt: 1_700_000_000_100,
          },
          response: { status: 200, headers: {}, body: '{"ok":true}', sentAt: 1_700_000_000_150 },
          latencyMs: 50,
          redactions: [],
        },
        {
          id: 'xch_b',
          request: {
            method: 'POST',
            url: 'https://api.example.com/things',
            headers: {},
            body: '{}',
            receivedAt: 1_700_000_000_400,
          },
          response: { status: 201, headers: {}, body: '{"id":"x"}', sentAt: 1_700_000_000_450 },
          latencyMs: 50,
          redactions: [],
        },
      ],
    };
    await storage.put('projects/acme/recordings/rec_test1.jsonl', JSON.stringify(recording));

    const app = await build(storage);
    const res = await app.inject('/v1/projects/acme/recordings');
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: Array<{
        id: string;
        requestCount: number;
        firstAt: number;
        lastAt: number;
        upstreamUrl: string;
      }>;
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.id).toBe('rec_test1');
    expect(body.data[0]!.requestCount).toBe(2);
    expect(body.data[0]!.firstAt).toBe(1_700_000_000_100);
    expect(body.data[0]!.lastAt).toBe(1_700_000_000_400);
    expect(body.data[0]!.upstreamUrl).toBe('https://api.example.com');
  });
});
