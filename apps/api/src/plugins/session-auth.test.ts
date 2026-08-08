import { describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import type { AppContext } from '../context.js';
import {
  registerSessionAuth,
  type SessionAuthenticatedRequest,
} from './session-auth.js';

/**
 * Minimal in-memory Drizzle stand-in. The plugin issues two selects:
 *   1. sessions ⋈ users where token=? AND expiresAt > now()
 *   2. memberships where userId=?
 *
 * The chain distinguishes them by whether `innerJoin` is called (only the
 * session lookup joins). Rows are returned as-is; the plugin picks the first
 * membership or a matching one when X-Carbon-Org is present.
 */
interface Fixture {
  session: { userId: string; email: string } | null;
  memberships: Array<{ orgId: string; role: 'owner' | 'admin' | 'member' }>;
}

function makeCtx(fixture: Fixture): AppContext {
  const sessionChain = {
    from: () => sessionChain,
    innerJoin: () => sessionChain,
    where: () => sessionChain,
    limit: async () => (fixture.session ? [fixture.session] : []),
  };
  const membershipChain = {
    from: () => membershipChain,
    where: async () => fixture.memberships,
    // Provide `then` so callers that don't `.limit()` still resolve.
    then: (resolve: (rows: Fixture['memberships']) => unknown) =>
      Promise.resolve(fixture.memberships).then(resolve),
  };
  const db = {
    select: (shape?: Record<string, unknown>) => {
      // Membership select requests `orgId` + `role`; the session select asks
      // for `userId` + `email`. Distinguish by the shape's keys.
      if (shape && 'orgId' in shape && 'role' in shape) return membershipChain;
      return sessionChain;
    },
  } as unknown as AppContext['db'];

  return {
    logger: NoopLogger,
    db,
    storage: new MemoryStorage(),
    ingestion: { ingest: async () => ({}) } as unknown as AppContext['ingestion'],
    emulators: {} as AppContext['emulators'],
  };
}

async function buildApp(fixture: Fixture): Promise<FastifyInstance> {
  const app = Fastify();
  await registerSessionAuth(app, makeCtx(fixture));
  app.get('/whoami', async (req) => {
    return { user: (req as SessionAuthenticatedRequest).sessionUser ?? null };
  });
  return app;
}

describe('session auth plugin', () => {
  it('attaches sessionUser for a valid Bearer session token', async () => {
    const app = await buildApp({
      session: { userId: 'user_1', email: 'alice@example.com' },
      memberships: [{ orgId: 'org_1', role: 'member' }],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { authorization: 'Bearer valid-session-token' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      user: { id: 'user_1', email: 'alice@example.com', orgId: 'org_1', role: 'member' },
    });
  });

  it('reads the token from the Better Auth session cookie', async () => {
    const app = await buildApp({
      session: { userId: 'user_1', email: 'alice@example.com' },
      memberships: [{ orgId: 'org_1', role: 'owner' }],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { cookie: 'better-auth.session_token=cookie-token.signature; other=x' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { user: { orgId: string; role: string } | null };
    expect(body.user).toMatchObject({ orgId: 'org_1', role: 'owner' });
  });

  it('leaves sessionUser undefined when the session row is missing or expired', async () => {
    // Fixture returns no session row — mimics both "no such token" and
    // "token exists but expiresAt < now()" (the SQL guard filters both).
    const app = await buildApp({ session: null, memberships: [] });

    const res = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { authorization: 'Bearer expired-token' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ user: null });
  });

  it('is a silent no-op when no Authorization header or cookie is present', async () => {
    const app = await buildApp({ session: null, memberships: [] });

    const res = await app.inject({ method: 'GET', url: '/whoami' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ user: null });
  });

  it('skips Bearer tokens that look like Carbon API keys', async () => {
    // Fixture would attach a user if the plugin ran the session lookup, so
    // the assertion here is `user: null` — the api-key hook should handle it.
    const app = await buildApp({
      session: { userId: 'user_1', email: 'alice@example.com' },
      memberships: [{ orgId: 'org_1', role: 'member' }],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { authorization: 'Bearer ck_live_aaaaaaaaaaaa.secret-value-here-32-chars-min' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ user: null });
  });

  it('honours X-Carbon-Org when the user belongs to multiple orgs', async () => {
    const app = await buildApp({
      session: { userId: 'user_1', email: 'alice@example.com' },
      memberships: [
        { orgId: 'org_1', role: 'member' },
        { orgId: 'org_2', role: 'admin' },
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: {
        authorization: 'Bearer valid-session-token',
        'x-carbon-org': 'org_2',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      user: { id: 'user_1', email: 'alice@example.com', orgId: 'org_2', role: 'admin' },
    });
  });

  it('falls back to the first membership when X-Carbon-Org does not match', async () => {
    const app = await buildApp({
      session: { userId: 'user_1', email: 'alice@example.com' },
      memberships: [
        { orgId: 'org_1', role: 'member' },
        { orgId: 'org_2', role: 'admin' },
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: {
        authorization: 'Bearer valid-session-token',
        'x-carbon-org': 'org_does_not_exist',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { user: { orgId: string } | null };
    expect(body.user?.orgId).toBe('org_1');
  });
});
