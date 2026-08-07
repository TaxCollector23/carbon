import { describe, expect, it, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import Fastify from 'fastify';
import { NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import { registerApiKeyAuth } from './api-key.js';
import type { AppContext } from '../context.js';

/**
 * We build a minimal AppContext that stubs the Drizzle query builder — the
 * plugin only reaches into it via `.select().from().where().limit()`, so we
 * mock that fluent chain here rather than pulling in a real Postgres.
 */
function makeCtx(row: { id: string; hash: string; prefix: string; orgId: string } | null): AppContext {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: async () => (row ? [row] : []),
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

async function buildApp(row: Parameters<typeof makeCtx>[0]) {
  const app = Fastify();
  const ctx = makeCtx(row);
  await registerApiKeyAuth(app, ctx, { mode: 'enforced' });
  app.get('/v1/protected', async () => ({ ok: true }));
  app.get('/health', async () => ({ ok: true }));
  return app;
}

describe('api key auth', () => {
  const validSecret = 'secret-fixture-value';
  const validPrefix = 'aa11bb22cc33';
  const validHash = createHash('sha256').update(validSecret).digest('hex');

  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeEach(async () => {
    app = await buildApp({ id: 'key_1', hash: validHash, prefix: validPrefix, orgId: 'org_1' });
  });

  it('allows /health without a key', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('rejects missing keys on /v1/*', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/protected' });
    expect(res.statusCode).toBe(500);
    // Fastify default handler serializes the CarbonError — until we plug the
    // shared error handler in this test, the important assertion is: not 200.
  });

  it('accepts a matching key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/protected',
      headers: { 'x-carbon-key': `ck_live_${validPrefix}.${validSecret}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a wrong secret with the correct prefix', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/protected',
      headers: { 'x-carbon-key': `ck_live_${validPrefix}.wrong-secret` },
    });
    expect(res.statusCode).not.toBe(200);
  });

  it('rejects a malformed key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/protected',
      headers: { 'x-carbon-key': 'just-a-string' },
    });
    expect(res.statusCode).not.toBe(200);
  });
});
