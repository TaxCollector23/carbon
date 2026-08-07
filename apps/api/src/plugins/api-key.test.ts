import { describe, expect, it, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { isCarbonError, NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import { registerApiKeyAuth } from './api-key.js';
import type { AppContext } from '../context.js';

/**
 * Builds a minimal AppContext by stubbing the Drizzle query builder. The
 * plugin only calls `.select().from().where().limit()` (and `.update().set().where()`
 * for the last-used timestamp), so we mock the fluent chain here rather than
 * pulling in a real Postgres.
 */
function makeCtx(
  rows: { id: string; hash: string; prefix: string; orgId: string }[] | null,
): AppContext {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: async () => rows ?? [],
    set: () => chain,
  };
  const db = {
    select: () => chain,
    update: () => chain,
  } as unknown as AppContext['db'];
  return {
    logger: NoopLogger,
    db,
    storage: new MemoryStorage(),
    ingestion: { ingest: async () => ({}) } as unknown as AppContext['ingestion'],
    emulators: {} as AppContext['emulators'],
  };
}

async function buildApp(rows: Parameters<typeof makeCtx>[0]): Promise<FastifyInstance> {
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
  const ctx = makeCtx(rows);
  await registerApiKeyAuth(app, ctx, { mode: 'enforced' });
  app.get('/v1/protected', async () => ({ ok: true }));
  app.get('/health', async () => ({ ok: true }));
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

  it('accepts a valid key when multiple rows share a prefix', async () => {
    const collisionApp = await buildApp([
      {
        id: 'key_wrong',
        hash: createHash('sha256').update('wrong-secret-value-32-chars-ok').digest('hex'),
        prefix: validPrefix,
        orgId: 'org_1',
      },
      { id: 'key_1', hash: validHash, prefix: validPrefix, orgId: 'org_1' },
    ]);
    const res = await collisionApp.inject({
      method: 'GET',
      url: '/v1/protected',
      headers: { 'x-carbon-key': `ck_live_${validPrefix}.${validSecret}` },
    });
    expect(res.statusCode).toBe(200);
  });
});
