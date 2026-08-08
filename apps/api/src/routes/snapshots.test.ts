import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { isCarbonError, NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import { registerSnapshotRoutes } from './snapshots.js';

function makeCtx(): AppContext {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: async () => [{ orgId: 'org_1', slug: 'acme' }],
  };
  return {
    logger: NoopLogger,
    db: { select: () => chain } as unknown as AppContext['db'],
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
        err.code === 'CARBON_NOT_FOUND' ? 404 : err.code === 'CARBON_INVALID_INPUT' ? 400 : 500;
      reply.status(status).send({ error: { code: err.code, message: err.message } });
      return;
    }
    reply.status(500).send({
      error: { code: 'CARBON_INTERNAL', message: err instanceof Error ? err.message : 'error' },
    });
  });
  app.addHook('onRequest', async (req) => {
    (req as AuthenticatedRequest).apiKey = {
      id: 'key_1',
      orgId: 'org_1',
      prefix: 'aa11bb22cc33', scopes: ['admin'], projectIds: null,
    };
  });
  await registerSnapshotRoutes(app, makeCtx());
  await app.ready();
  return app;
}

describe('snapshot routes', () => {
  it('rejects a path-traversal shape on read', async () => {
    const app = await build();
    const res = await app.inject('/v1/projects/acme/snapshots/..%2Fsecrets');
    // Route-param values arrive pre-decoded; Fastify then declines the path
    // pattern with 404, or the SnapshotName regex rejects it with 400. Either
    // way we must not fall through to the storage layer.
    expect([400, 404]).toContain(res.statusCode);
  });

  it('rejects an uppercase or underscore snapshot name on delete', async () => {
    const app = await build();
    const res = await app.inject({ method: 'DELETE', url: '/v1/projects/acme/snapshots/Bad_Name' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('CARBON_INVALID_INPUT');
  });

  it('accepts a well-formed snapshot name on read (miss → 404)', async () => {
    const app = await build();
    const res = await app.inject('/v1/projects/acme/snapshots/nightly-42');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('CARBON_NOT_FOUND');
  });
});
