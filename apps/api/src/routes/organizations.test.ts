import { describe, expect, it, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { isCarbonError, NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import type { SessionAuthenticatedRequest } from '../plugins/session-auth.js';
import { registerOrganizationRoutes } from './organizations.js';

/**
 * Route-level tests for /v1/organizations/*.
 *
 * The DB is a hand-rolled fake driven by a per-test queue: each route makes
 * a predictable sequence of drizzle calls, and the test seeds the results
 * for that sequence. Inserts/updates/deletes are captured into `ops` so the
 * assertions can inspect side effects without interpreting SQL.
 */

interface FakeDb {
  results: unknown[];
  ops: Array<{ kind: 'insert' | 'update' | 'delete'; table: unknown; value?: unknown; patch?: unknown }>;
  db: AppContext['db'];
}

function makeFake(): FakeDb {
  const results: unknown[] = [];
  const ops: FakeDb['ops'] = [];
  // Peel one result off the queue. Missing results mean the test seed is
  // wrong — throw loudly rather than silently returning undefined.
  const take = <T,>(): T => {
    if (results.length === 0) throw new Error('fake db: no queued result for this call');
    return results.shift() as T;
  };

  const selectChain = () => {
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.leftJoin = () => chain;
    chain.where = () => chain;
    chain.limit = async () => take<unknown[]>();
    chain.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(take<unknown[]>()).then(onFulfilled, onRejected);
    return chain;
  };

  const insert = (table: unknown) => ({
    values: async (value: unknown) => {
      ops.push({ kind: 'insert', table, value });
    },
  });

  const update = (table: unknown) => {
    let patch: unknown;
    const chain: Record<string, unknown> = {};
    chain.set = (p: unknown) => {
      patch = p;
      return chain;
    };
    chain.where = () => {
      ops.push({ kind: 'update', table, patch });
      return chain;
    };
    chain.returning = async () => take<unknown[]>();
    // Awaiting `.where()` directly (no returning) still needs to resolve.
    (chain as { then?: unknown }).then = undefined;
    return chain;
  };

  const del = (table: unknown) => ({
    where: async () => {
      ops.push({ kind: 'delete', table });
    },
  });

  const db = {
    select: (_cols?: unknown) => selectChain(),
    insert,
    update,
    delete: del,
  } as unknown as AppContext['db'];

  return { results, ops, db };
}

function makeCtx(fake: FakeDb): AppContext {
  return {
    logger: NoopLogger,
    db: fake.db,
    storage: new MemoryStorage(),
    ingestion: { ingest: async () => ({}) } as unknown as AppContext['ingestion'],
    emulators: {} as AppContext['emulators'],
  };
}

/**
 * Build a Fastify instance with the org routes mounted and an auth-shim
 * hook that stamps `req.apiKey` and/or `req.firebaseUser` from custom
 * headers so each test can pick the calling identity per-request.
 */
async function buildApp(fake: FakeDb): Promise<FastifyInstance> {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    if (isCarbonError(err)) {
      const status =
        err.code === 'CARBON_UNAUTHENTICATED'
          ? 401
          : err.code === 'CARBON_FORBIDDEN'
            ? 403
            : err.code === 'CARBON_NOT_FOUND'
              ? 404
              : err.code === 'CARBON_CONFLICT'
                ? 409
                : err.code === 'CARBON_INVALID_INPUT'
                  ? 400
                  : 500;
      reply.status(status).send({ error: { code: err.code, message: err.message, details: err.details } });
      return;
    }
    reply.status(500).send({ error: { code: 'CARBON_INTERNAL', message: String(err) } });
  });
  app.addHook('onRequest', async (req) => {
    const apiKeyHeader = req.headers['x-test-apikey'];
    if (typeof apiKeyHeader === 'string') {
      const [orgId, ...scopes] = apiKeyHeader.split(',');
      (req as AuthenticatedRequest).apiKey = {
        id: 'key_test',
        orgId: orgId ?? '',
        prefix: 'aa11bb22cc33',
        scopes: scopes.length > 0 ? scopes : ['admin'],
        projectIds: null,
        expiresAt: null,
      };
    }
    const sessionHeader = req.headers['x-test-user'];
    if (typeof sessionHeader === 'string') {
      const [userId, email, orgId, role] = sessionHeader.split(',');
      // Only include `role` when the header explicitly names one. Leaving it
      // undefined makes `requireScope`'s session-role check a no-op so the
      // route's own membership lookup (callerContext) is the source of truth
      // for these tests — matching the pre-session-role behaviour.
      const roleValue =
        role === 'owner' || role === 'admin' || role === 'member'
          ? (role as 'owner' | 'admin' | 'member')
          : undefined;
      (req as SessionAuthenticatedRequest).sessionUser = {
        id: userId ?? '',
        email: email ?? '',
        ...(orgId ? { orgId } : {}),
        ...(roleValue ? { role: roleValue } : {}),
      };
    }
  });
  await registerOrganizationRoutes(app, makeCtx(fake));
  return app;
}

const org = {
  id: 'org_1',
  slug: 'acme',
  name: 'Acme',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  retentionDays: null,
  isEnterprise: false,
  settings: {},
};

describe('organization routes', () => {
  let fake: FakeDb;
  beforeEach(() => {
    fake = makeFake();
  });

  it('PATCH /organizations/:id — owner updates name; result echoes the patch', async () => {
    // callerContext(firebase) reads memberships → returns owner row.
    fake.results.push([{ role: 'owner' }]);
    // loadOrgOr404 → returns the org.
    fake.results.push([org]);
    // final update .returning() → returns updated row.
    fake.results.push([{ ...org, name: 'Acme Corp' }]);

    const app = await buildApp(fake);
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/organizations/org_1',
      headers: { 'x-test-user': 'user_1,alice@acme.io,org_1' },
      payload: { name: 'Acme Corp' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 'org_1', name: 'Acme Corp' });
    const updateOp = fake.ops.find((o) => o.kind === 'update');
    expect(updateOp?.patch).toEqual({ name: 'Acme Corp' });
  });

  it('POST /organizations/:id/members — member role is rejected with 403', async () => {
    // callerContext returns member (no admin/owner privilege).
    fake.results.push([{ role: 'member' }]);

    const app = await buildApp(fake);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/organizations/org_1/members',
      headers: { 'x-test-user': 'user_1,alice@acme.io,org_1' },
      payload: { email: 'bob@acme.io', role: 'member' },
    });
    expect(res.statusCode).toBe(403);
    expect(fake.ops.find((o) => o.kind === 'insert')).toBeUndefined();
  });

  it('POST /organizations/:id/members — admin creates an invitation and returns inviteUrl', async () => {
    // callerContext → admin.
    fake.results.push([{ role: 'admin' }]);
    // loadOrgOr404 → org exists.
    fake.results.push([org]);

    process.env.DASHBOARD_URL = 'https://dash.carbon.dev';
    const app = await buildApp(fake);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/organizations/org_1/members',
      headers: { 'x-test-user': 'user_1,alice@acme.io,org_1' },
      payload: { email: 'BOB@acme.io', role: 'admin' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { inviteUrl: string; email: string };
    expect(body.email).toBe('bob@acme.io');
    expect(body.inviteUrl).toMatch(/^https:\/\/dash\.carbon\.dev\/invitations\/accept\?token=[0-9a-f]{32}$/);
    const insertOp = fake.ops.find((o) => o.kind === 'insert');
    expect(insertOp).toBeDefined();
    delete process.env.DASHBOARD_URL;
  });

  it('PATCH member role — cannot demote the last owner', async () => {
    // Caller is an owner.
    fake.results.push([{ role: 'owner' }]);
    // Target membership is also an owner.
    fake.results.push([{ role: 'owner' }]);
    // countOtherOwners → 0 (no other owners).
    fake.results.push([{ n: 0 }]);

    const app = await buildApp(fake);
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/organizations/org_1/members/user_1',
      headers: { 'x-test-user': 'user_2,carol@acme.io,org_1' },
      payload: { role: 'admin' },
    });
    expect(res.statusCode).toBe(409);
    expect(fake.ops.find((o) => o.kind === 'update')).toBeUndefined();
  });

  it('PATCH member role — demoting an owner succeeds when another owner exists', async () => {
    fake.results.push([{ role: 'owner' }]); // caller
    fake.results.push([{ role: 'owner' }]); // target
    fake.results.push([{ n: 1 }]); // another owner exists
    fake.results.push([{ userId: 'user_1', role: 'admin' }]); // returning()

    const app = await buildApp(fake);
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/organizations/org_1/members/user_1',
      headers: { 'x-test-user': 'user_2,carol@acme.io,org_1' },
      payload: { role: 'admin' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ userId: 'user_1', role: 'admin' });
  });

  it('DELETE member — cannot remove the last owner', async () => {
    fake.results.push([{ role: 'owner' }]); // caller
    fake.results.push([{ role: 'owner' }]); // target owner
    fake.results.push([{ n: 0 }]); // no other owners

    const app = await buildApp(fake);
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/organizations/org_1/members/user_1',
      headers: { 'x-test-user': 'user_2,carol@acme.io,org_1' },
    });
    expect(res.statusCode).toBe(409);
    expect(fake.ops.find((o) => o.kind === 'delete')).toBeUndefined();
  });

  it('POST /invitations/accept — creates membership and marks invite accepted', async () => {
    const invite = {
      id: 'inv_1',
      orgId: 'org_1',
      email: 'bob@acme.io',
      role: 'member',
      token: 'tok_' + 'a'.repeat(30),
      invitedBy: 'user_1',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      acceptedAt: null,
    };
    // 1) look up invitation
    fake.results.push([invite]);
    // 2) check for existing membership → none
    fake.results.push([]);

    const app = await buildApp(fake);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/invitations/accept',
      headers: { 'x-test-user': 'user_new,bob@acme.io,org_x' },
      payload: { token: invite.token },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ orgId: 'org_1', role: 'member', accepted: true });
    const insertOp = fake.ops.find((o) => o.kind === 'insert');
    expect(insertOp?.value).toMatchObject({ userId: 'user_new', orgId: 'org_1', role: 'member' });
    // Invitation was marked accepted.
    const updateOp = fake.ops.find((o) => o.kind === 'update');
    expect(updateOp?.patch).toMatchObject({ acceptedAt: expect.any(Date) });
  });

  it('POST /invitations/accept — expired token is rejected with 409', async () => {
    const invite = {
      id: 'inv_1',
      orgId: 'org_1',
      email: 'bob@acme.io',
      role: 'member',
      token: 'tok_' + 'b'.repeat(30),
      invitedBy: null,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() - 1000),
      acceptedAt: null,
    };
    fake.results.push([invite]);

    const app = await buildApp(fake);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/invitations/accept',
      headers: { 'x-test-user': 'user_new,bob@acme.io,org_x' },
      payload: { token: invite.token },
    });
    expect(res.statusCode).toBe(409);
    expect(fake.ops.find((o) => o.kind === 'insert')).toBeUndefined();
  });

  it('API-key caller from a different org is rejected with 403', async () => {
    const app = await buildApp(fake);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/organizations/org_1',
      headers: { 'x-test-apikey': 'org_other,admin' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('API-key caller with admin scope on the org is treated as owner (can invite)', async () => {
    // No membership lookup needed for api-key path. Just loadOrgOr404 for the
    // invite handler.
    fake.results.push([org]);

    const app = await buildApp(fake);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/organizations/org_1/members',
      headers: { 'x-test-apikey': 'org_1,admin' },
      payload: { email: 'bob@acme.io' },
    });
    expect(res.statusCode).toBe(201);
    expect(fake.ops.find((o) => o.kind === 'insert')).toBeDefined();
  });
});
