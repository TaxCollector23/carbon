import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import type { AppContext } from '../context.js';
import { registerHealthRoutes } from './health.js';

function makeCtx(db: AppContext['db']): AppContext {
  return {
    logger: NoopLogger,
    db,
    storage: new MemoryStorage(),
    ingestion: { ingest: async () => ({}) } as unknown as AppContext['ingestion'],
    emulators: {} as AppContext['emulators'],
  };
}

describe('health routes', () => {
  it('returns 503 when a readiness dependency times out', async () => {
    const app = Fastify();
    const neverReady = {
      execute: async () => new Promise(() => {}),
    } as unknown as AppContext['db'];
    await registerHealthRoutes(app, makeCtx(neverReady), { timeoutMs: 5 });

    const res = await app.inject('/ready');
    expect(res.statusCode).toBe(503);
    expect(res.json().checks.database.ok).toBe(false);
    expect(res.json().checks.database.error).toContain('timed out');
  });
});
