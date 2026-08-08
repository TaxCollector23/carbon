import { describe, expect, it, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { isCarbonError, NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import { registerApiKeyAuth } from './api-key.js';
import type { AppContext } from '../context.js';

interface KeyRow {
  id: string;
  hash: string;
  prefix: string;
  orgId: string;
  lastUsedAt?: Date | null;
  scopes?: string[];
  projectIds?: string[] | null;
}

/**
 * Builds a minimal AppContext by stubbing the Drizzle query builder. The
 * plugin only calls `.select().from().where().limit()` (and `.update().set().where()`
 * for the last-used timestamp), so we mock the fluent chain here rather than
 * pulling in a real Postgres.
 *
 * The update chain is thenable because the plugin awaits it via
 * `Promise.resolve(...)` — a plain object would silently no-op and hide a
 * regression in the touch path.
 */
function makeCtx(rows: KeyRow[] | null, onTouch?: () => void): AppContext {
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: async () => rows ?? [],
  };
  const updateChain = {
    set: () => updateChain,
    where: () => Promise.resolve().then(() => void onTouch?.()),
  };
  const db = {
    select: () => selectChain,
    update: () => updateChain,
  } as unknown as AppContext['db'];
  return {
    logger: NoopLogger,
    db,
    storage: new MemoryStorage(),
    ingestion: { ingest: async () => ({}) } as unknown as AppContext['ingestion'],
    emulators: {} as AppContext['emulators'],
  };
}

async function buildApp(
  rows: KeyRow[] | null,
  opts: { onTouch?: () => void; publicPaths?: string[] } = {},
): Promise<FastifyInstance> {
  const app = Fastify();
  // Mirror the real error handler so 401s surface as 401 instead of 500.
  app.setErrorHandler((err, _req, reply) => {
    if (isCarbonError(err) && err.code === 'CARBON_UNAUTHENTICATED') {
      reply.status(401).send({ error: { code: err.code, message: err.message } });
      return;
    }
    reply.status(500).send({
      error: { code: 'CARBON_INTERNAL', message: err instanceof Error ? err.message : String(err) },
    });
  });
  const ctx = makeCtx(rows, opts.onTouch);
  await registerApiKeyAuth(app, ctx, { mode: 'enforced', publicPaths: opts.publicPaths });
  app.get('/v1/protected', async () => ({ ok: true }));
  app.get('/health', async () => ({ ok: true }));
  app.get('/metrics', async () => 'carbon_up 1');
  return app;
}

describe('api key auth', () => {
  const validSecret = 'secret-fixture-value-32-chars-ok';
  const validPrefix = 'aa11bb22cc33';
  const validHash = createHash('sha256').update(validSecret).digest('hex');

  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildApp([{ id: 'key_1', hash: validHash, prefix: validPrefix, orgId: 'org_1' }]);
  });

  it('allows /health without a key', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('rejects missing keys on /v1/* with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/protected' });
    expect(res.statusCode).toBe(401);
  });

  it('accepts a matching key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/protected',
      headers: { 'x-carbon-key': `ck_live_${validPrefix}.${validSecret}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a wrong secret with the correct prefix — 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/protected',
      headers: { 'x-carbon-key': `ck_live_${validPrefix}.${'x'.repeat(32)}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a malformed key — 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/protected',
      headers: { 'x-carbon-key': 'just-a-string' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an unknown prefix — 401', async () => {
    const noRowApp = await buildApp(null);
    const res = await noRowApp.inject({
      method: 'GET',
      url: '/v1/protected',
      headers: { 'x-carbon-key': `ck_live_001122334455.${validSecret}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('exposes the authenticated prefix on the response', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/protected',
      headers: { 'x-carbon-key': `ck_live_${validPrefix}.${validSecret}` },
    });
    expect(res.headers['x-carbon-key-prefix']).toBe(validPrefix);
  });

  it('rejects duplicate key headers — 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/protected',
      headers: {
        'x-carbon-key': [
          `ck_live_${validPrefix}.${validSecret}`,
          `ck_live_${validPrefix}.${validSecret}`,
        ],
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it('serves configured public paths without a key', async () => {
    const openApp = await buildApp(
      [{ id: 'key_1', hash: validHash, prefix: validPrefix, orgId: 'org_1' }],
      { publicPaths: ['/health', '/metrics'] },
    );
    expect((await openApp.inject({ method: 'GET', url: '/metrics' })).statusCode).toBe(200);
    // Anything not listed is still closed.
    expect((await openApp.inject({ method: 'GET', url: '/v1/protected' })).statusCode).toBe(401);
  });

  it('touches lastUsedAt on first use, then throttles', async () => {
    let touches = 0;
    // A distinct id — the throttle window is tracked in a module-level map, so
    // reusing `key_1` here would inherit a touch from another test.
    const touchPrefix = 'dd44ee55ff66';
    const rows: KeyRow[] = [
      { id: 'key_touch', hash: validHash, prefix: touchPrefix, orgId: 'org_1', lastUsedAt: null },
    ];
    const touchApp = await buildApp(rows, { onTouch: () => void touches++ });
    const headers = { 'x-carbon-key': `ck_live_${touchPrefix}.${validSecret}` };
    for (let i = 0; i < 3; i++) {
      const res = await touchApp.inject({ method: 'GET', url: '/v1/protected', headers });
      expect(res.statusCode).toBe(200);
    }
    // Let the fire-and-forget write settle before asserting.
    await new Promise((r) => setImmediate(r));
    expect(touches).toBe(1);
  });
});
