import { describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { isCarbonError, NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import { registerTrackRoutes } from './track.js';

interface TrackRow {
  id: string;
  action: string;
  ipHash: string | null;
  path: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown>;
}

function makeDb(sink: TrackRow[]): AppContext['db'] {
  return {
    insert: (table: unknown) => ({
      values: async (v: TrackRow) => {
        if (table === schema.anonymousEvents) sink.push({ ...v });
      },
    }),
  } as unknown as AppContext['db'];
}

function makeCtx(sink: TrackRow[]): AppContext {
  return {
    logger: NoopLogger,
    db: makeDb(sink),
    storage: new MemoryStorage(),
    ingestion: { ingest: async () => ({}) } as unknown as AppContext['ingestion'],
    emulators: {} as AppContext['emulators'],
  };
}

async function buildApp(limiter?: (ip: string) => { ok: boolean }): Promise<{
  app: FastifyInstance;
  sink: TrackRow[];
}> {
  const sink: TrackRow[] = [];
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      reply.status(400).send({ error: { code: 'CARBON_INVALID_INPUT', issues: err.issues } });
      return;
    }
    if (isCarbonError(err)) {
      const status = err.code === 'CARBON_RATE_LIMITED' ? 429 : 400;
      reply.status(status).send({ error: { code: err.code, message: err.message } });
      return;
    }
    // Fastify tags its own validation / body-limit / malformed-JSON errors
    // with a 4xx `statusCode` — surface those as-is instead of a generic 500.
    const s = (err as { statusCode?: number }).statusCode;
    if (typeof s === 'number' && s >= 400 && s < 500) {
      const msg = err instanceof Error ? err.message : String(err);
      reply.status(s).send({ error: { code: 'CARBON_INVALID_INPUT', message: msg } });
      return;
    }
    reply.status(500).send({ error: { code: 'CARBON_INTERNAL', message: String(err) } });
  });
  await registerTrackRoutes(app, makeCtx(sink), { limiter });
  return { app, sink };
}

describe('POST /v1/track', () => {
  it('stores a funnel event with a hashed IP, not the raw IP', async () => {
    const { app, sink } = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/track',
      payload: { action: 'try.view', path: '/try', metadata: { sample: 'petstore' } },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toMatch(/^evt_/);
    expect(sink).toHaveLength(1);
    const row = sink[0]!;
    expect(row.action).toBe('try.view');
    expect(row.path).toBe('/try');
    expect(row.metadata).toEqual({ sample: 'petstore' });
    // 127.0.0.1 hashed — a 64-char hex digest, and never the literal IP.
    expect(row.ipHash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.ipHash).not.toContain('127.0.0.1');
  });

  it('rejects actions that do not match the strict token pattern', async () => {
    const { app, sink } = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/track',
      payload: { action: 'User Clicked CTA!!' },
    });
    expect(res.statusCode).toBe(400);
    expect(sink).toHaveLength(0);
  });

  it('sanitizes metadata: scalars kept, nested objects dropped, keys capped', async () => {
    const { app, sink } = await buildApp();
    const metadata: Record<string, unknown> = {};
    for (let i = 0; i < 20; i += 1) metadata[`key_${i}`] = `value ${i}`;
    metadata.nested = { deep: { pii: 'x' } };
    metadata.list = [1, 2, 3];
    metadata.nullish = null;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/track',
      payload: { action: 'test.start', metadata },
    });
    expect(res.statusCode).toBe(201);
    const row = sink[0]!;
    expect(Object.keys(row.metadata)).toHaveLength(8); // capped
    expect(row.metadata.nested).toBeUndefined();
    expect(row.metadata.list).toBeUndefined();
    expect(row.metadata.nullish).toBeUndefined();
  });

  it('rate-limits per IP', async () => {
    let calls = 0;
    const limiter = () => {
      calls += 1;
      return { ok: calls < 2 };
    };
    const { app } = await buildApp(limiter);
    const ok = await app.inject({
      method: 'POST',
      url: '/v1/track',
      payload: { action: 'try.view' },
    });
    expect(ok.statusCode).toBe(201);
    const blocked = await app.inject({
      method: 'POST',
      url: '/v1/track',
      payload: { action: 'try.view' },
    });
    expect(blocked.statusCode).toBe(429);
  });
});
