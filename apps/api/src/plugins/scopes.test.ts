import { describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { isCarbonError, NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from './api-key.js';
import { keyHasScope, requireScope } from './scopes.js';
import { resolveProjectAccess } from '../routes/project-access.js';

/**
 * Guard tests intentionally sidestep the full auth plugin — those interactions
 * are covered in `api-key.test.ts`. Here we stamp `req.apiKey` in an
 * onRequest hook so each case gets exactly the key shape it wants.
 */
function buildApp(
  apiKey: AuthenticatedRequest['apiKey'] | null,
  routes: (app: FastifyInstance) => void,
): FastifyInstance {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    if (isCarbonError(err)) {
      const status = err.code === 'CARBON_FORBIDDEN' ? 403 : 400;
      reply.status(status).send({ error: { code: err.code, message: err.message } });
      return;
    }
    reply
      .status(500)
      .send({ error: { code: 'CARBON_INTERNAL', message: (err as Error).message } });
  });
  app.addHook('onRequest', async (req) => {
    if (apiKey) (req as AuthenticatedRequest).apiKey = apiKey;
  });
  routes(app);
  return app;
}

describe('keyHasScope', () => {
  it('admin implies write and read', () => {
    expect(keyHasScope(['admin'], 'read')).toBe(true);
    expect(keyHasScope(['admin'], 'write')).toBe(true);
    expect(keyHasScope(['admin'], 'admin')).toBe(true);
  });
  it('write implies read but not admin', () => {
    expect(keyHasScope(['write'], 'read')).toBe(true);
    expect(keyHasScope(['write'], 'write')).toBe(true);
    expect(keyHasScope(['write'], 'admin')).toBe(false);
  });
  it('read is only read', () => {
    expect(keyHasScope(['read'], 'read')).toBe(true);
    expect(keyHasScope(['read'], 'write')).toBe(false);
    expect(keyHasScope(['read'], 'admin')).toBe(false);
  });
  it('unknown scope strings are ignored', () => {
    expect(keyHasScope(['bogus'], 'read')).toBe(false);
  });
});

describe('requireScope guard', () => {
  it('read-only key is rejected on a write route', async () => {
    const app = buildApp(
      { id: 'k', orgId: 'o', prefix: 'p', scopes: ['read'], projectIds: null },
      (a) =>
        a.post('/w', { preHandler: requireScope('write') }, async () => ({ ok: true })),
    );
    const res = await app.inject({ method: 'POST', url: '/w' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('CARBON_FORBIDDEN');
  });

  it('write key is accepted on write and read routes', async () => {
    const app = buildApp(
      { id: 'k', orgId: 'o', prefix: 'p', scopes: ['write'], projectIds: null },
      (a) => {
        a.get('/r', { preHandler: requireScope('read') }, async () => ({ ok: true }));
        a.post('/w', { preHandler: requireScope('write') }, async () => ({ ok: true }));
      },
    );
    expect((await app.inject({ method: 'GET', url: '/r' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/w' })).statusCode).toBe(200);
  });

  it('admin key can hit an admin-scoped api-keys route', async () => {
    const app = buildApp(
      { id: 'k', orgId: 'o', prefix: 'p', scopes: ['admin'], projectIds: null },
      (a) =>
        a.post('/a', { preHandler: requireScope('admin') }, async () => ({ ok: true })),
    );
    expect((await app.inject({ method: 'POST', url: '/a' })).statusCode).toBe(200);
  });

  it('write key is rejected on an admin-scoped route', async () => {
    const app = buildApp(
      { id: 'k', orgId: 'o', prefix: 'p', scopes: ['write'], projectIds: null },
      (a) =>
        a.post('/a', { preHandler: requireScope('admin') }, async () => ({ ok: true })),
    );
    const res = await app.inject({ method: 'POST', url: '/a' });
    expect(res.statusCode).toBe(403);
  });

  it('is a no-op when no api key is present (CARBON_AUTH_MODE=disabled)', async () => {
    const app = buildApp(null, (a) =>
      a.post('/w', { preHandler: requireScope('write') }, async () => ({ ok: true })),
    );
    expect((await app.inject({ method: 'POST', url: '/w' })).statusCode).toBe(200);
  });
});

describe('project pinning via resolveProjectAccess', () => {
  function makeCtx(projects: Array<{ id: string; slug: string; orgId: string }>): AppContext {
    const rows = projects;
    const chain = {
      from: () => chain,
      where: () => chain,
      limit: async () => rows,
    };
    const db = { select: () => chain } as unknown as AppContext['db'];
    return {
      logger: NoopLogger,
      db,
      storage: new MemoryStorage(),
      ingestion: {} as AppContext['ingestion'],
      emulators: {} as AppContext['emulators'],
    };
  }

  it('rejects a project the key is not pinned to', async () => {
    const ctx = makeCtx([{ id: 'prj_a', slug: 'a', orgId: 'org_1' }]);
    const req = {
      apiKey: { id: 'k', orgId: 'org_1', prefix: 'p', scopes: ['admin'], projectIds: ['prj_b'] },
    } as unknown as Parameters<typeof resolveProjectAccess>[1];
    await expect(resolveProjectAccess(ctx, req, 'a')).rejects.toMatchObject({
      code: 'CARBON_FORBIDDEN',
    });
  });

  it('accepts a project the key is pinned to', async () => {
    const ctx = makeCtx([{ id: 'prj_a', slug: 'a', orgId: 'org_1' }]);
    const req = {
      apiKey: { id: 'k', orgId: 'org_1', prefix: 'p', scopes: ['admin'], projectIds: ['prj_a'] },
    } as unknown as Parameters<typeof resolveProjectAccess>[1];
    const access = await resolveProjectAccess(ctx, req, 'a');
    expect(access.slug).toBe('a');
    expect(access.storageSlug).toBe('org_1/a');
  });

  it('unpinned key (projectIds: null) has access to any project in its org', async () => {
    const ctx = makeCtx([{ id: 'prj_a', slug: 'a', orgId: 'org_1' }]);
    const req = {
      apiKey: { id: 'k', orgId: 'org_1', prefix: 'p', scopes: ['admin'], projectIds: null },
    } as unknown as Parameters<typeof resolveProjectAccess>[1];
    const access = await resolveProjectAccess(ctx, req, 'a');
    expect(access.slug).toBe('a');
  });
});
