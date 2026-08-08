import { describe, expect, it, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { isCarbonError, NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import type { AppContext } from '../context.js';
import type { FirebaseAuthenticatedRequest } from './firebase-auth.js';

/**
 * `verifyIdToken` is the one Firebase surface we care about — mocking the
 * entire module keeps the tests fast and offline. The mock is per-test
 * mutable so a case can flip between valid and invalid without redefining
 * the module.
 */
const verifyIdToken = vi.fn();

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(() => ({})),
  getApps: vi.fn(() => []),
  cert: vi.fn(() => ({})),
}));

vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken }),
}));

/**
 * A read-only user + membership fixture. `insert` returns an awaitable so
 * the plugin's fire-and-forget upsert path completes without spinning up a
 * real Postgres.
 */
interface Fixture {
  readonly users: Array<{ id: string; email: string }>;
  readonly memberships: Array<{ userId: string; orgId: string }>;
  readonly organizations: Array<{ id: string; slug: string }>;
}

function makeCtx(fixture: Fixture): { ctx: AppContext; fixture: Fixture } {
  const selectChain = (rows: unknown[]) => ({
    from: () => selectChain(rows),
    where: () => selectChain(rows),
    limit: async () => rows,
  });
  const insertChain = (target: unknown[]) => ({
    values: async (row: Record<string, unknown>) => {
      target.push(row as never);
      return { insertId: 'x' };
    },
  });

  const db = {
    select: (shape?: Record<string, unknown>) => {
      // The plugin issues three different selects; we tell them apart by the
      // requested column shape.
      if (shape && 'orgId' in shape) return selectChain(fixture.memberships);
      return selectChain(fixture.users);
    },
    insert: (table: unknown) => {
      const name = (table as { _?: { name?: string } })._?.name ?? '';
      if (name.includes('org') || name.includes('rganization')) {
        return insertChain(fixture.organizations);
      }
      if (name.includes('membership')) return insertChain(fixture.memberships);
      return insertChain(fixture.users);
    },
  } as unknown as AppContext['db'];

  const ctx: AppContext = {
    logger: NoopLogger,
    db,
    storage: new MemoryStorage(),
    ingestion: { ingest: async () => ({}) } as unknown as AppContext['ingestion'],
    emulators: {} as AppContext['emulators'],
  };
  return { ctx, fixture };
}

async function buildApp(
  fixture: Fixture,
  opts: { register: boolean } = { register: true },
): Promise<FastifyInstance> {
  const { ctx } = makeCtx(fixture);
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    if (isCarbonError(err) && err.code === 'CARBON_UNAUTHENTICATED') {
      reply.status(401).send({ error: { code: err.code, message: err.message } });
      return;
    }
    reply
      .status(500)
      .send({ error: { code: 'CARBON_INTERNAL', message: (err as Error).message } });
  });
  const { registerFirebaseAuth } = await import('./firebase-auth.js');
  await registerFirebaseAuth(
    app,
    ctx,
    opts.register
      ? {
          projectId: 'test-proj',
          clientEmail: 'sa@test.iam.gserviceaccount.com',
          privateKey: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n',
        }
      : undefined,
  );
  app.get('/whoami', async (req) => {
    return { user: (req as FirebaseAuthenticatedRequest).firebaseUser ?? null };
  });
  return app;
}

describe('firebase auth plugin', () => {
  beforeEach(() => {
    verifyIdToken.mockReset();
  });

  it('attaches the resolved user + org on a valid Bearer token', async () => {
    verifyIdToken.mockResolvedValueOnce({ uid: 'fb_uid_1', email: 'Alice@example.com' });
    const app = await buildApp({
      users: [{ id: 'user_1', email: 'alice@example.com' }],
      memberships: [{ userId: 'user_1', orgId: 'org_1' }],
      organizations: [],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { authorization: 'Bearer good-token' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { user: { orgId: string; email: string } | null };
    expect(body.user).toMatchObject({
      email: 'alice@example.com',
      orgId: 'org_1',
      uid: 'fb_uid_1',
    });
  });

  it('returns 401 when verifyIdToken rejects', async () => {
    verifyIdToken.mockRejectedValueOnce(new Error('token expired'));
    const app = await buildApp({
      users: [],
      memberships: [],
      organizations: [],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { authorization: 'Bearer bad-token' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: { code: 'CARBON_UNAUTHENTICATED', message: 'Invalid Firebase token' },
    });
  });

  it('is a no-op when no Authorization header is present', async () => {
    const app = await buildApp({ users: [], memberships: [], organizations: [] });

    const res = await app.inject({ method: 'GET', url: '/whoami' });

    // No auth header → hook skipped, no verifyIdToken call, request passes
    // through with firebaseUser undefined.
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ user: null });
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it('is a no-op when the Bearer token looks like a Carbon API key', async () => {
    const app = await buildApp({ users: [], memberships: [], organizations: [] });

    const res = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { authorization: 'Bearer ck_live_aaaaaaaaaaaa.some-secret-value' },
    });

    expect(res.statusCode).toBe(200);
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it('does not register anything when FIREBASE_PROJECT_ID is not configured', async () => {
    // `opts` undefined mirrors what index.ts passes when the env is unset.
    const app = await buildApp(
      { users: [], memberships: [], organizations: [] },
      { register: false },
    );

    const res = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { authorization: 'Bearer would-be-token' },
    });

    // No hook attached, no verify call, request lands with no firebaseUser.
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ user: null });
    expect(verifyIdToken).not.toHaveBeenCalled();
  });
});
