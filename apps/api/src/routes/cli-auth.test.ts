import { describe, expect, it, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { isCarbonError, NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import type { SessionAuthenticatedRequest } from '../plugins/session-auth.js';
import { registerCliAuthRoutes, __resetCliAuthState } from './cli-auth.js';
import { createSecretStore, type SecretStore } from '../services/cli-auth-secret-store.js';

/**
 * Exercises the full device-authorization loop against an in-memory shim
 * for the two tables the routes touch (`cli_auth_sessions`, `api_keys`).
 * The shim inspects the drizzle SQL AST via table+column identity rather
 * than replaying WHERE clauses in JS — same pattern used by
 * routes/events.test.ts and routes/api-keys.test.ts.
 */

interface CliAuthRow {
  id: string;
  verifier: string;
  orgId: string | null;
  userId: string | null;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  approvedApiKeyId: string | null;
  createdAt: Date;
  expiresAt: Date;
  approvedAt: Date | null;
  revealedAt: Date | null;
}

interface ApiKeyRow {
  id: string;
  orgId: string;
  name: string;
  hash: string;
  prefix: string;
  scopes: string[];
  projectIds: string[] | null;
  revokedAt: Date | null;
  createdAt: Date;
  expiresAt: Date | null;
  rotatedFromId: string | null;
}

interface Store {
  cliRows: CliAuthRow[];
  keyRows: ApiKeyRow[];
  memberships: Array<{ userId: string; orgId: string; role: 'owner' | 'admin' | 'member' }>;
  orgs: Array<{ id: string; name: string; slug: string }>;
  events: Array<{ orgId: string; action: string; metadata: unknown }>;
}

function makeDb(store: Store): AppContext['db'] {
  // Filter-by-table dispatcher. We tag each select() with the last table
  // referenced via `from(...)` so the resolver knows which array to read.
  let lastTable: unknown = null;
  let lastFilter: ((row: any) => boolean) | null = null;

  const selectChain = () => {
    const chain: any = {
      from: (t: unknown) => {
        lastTable = t;
        return chain;
      },
      innerJoin: (_t: unknown, _cond: unknown) => chain,
      where: (predicate: any) => {
        void predicate;
        lastFilter = () => true;
        return chain;
      },
      limit: async (n: number) => resolveSelect(n),
      // Make the chain itself awaitable for queries that don't call .limit().
      then: (onFulfilled: any, onRejected: any) =>
        resolveSelect(Number.POSITIVE_INFINITY).then(onFulfilled, onRejected),
    };
    return chain;
  };

  const resolveSelect = async (n: number): Promise<any[]> => {
    let rows: any[] = [];
    if (lastTable === schema.cliAuthSessions) rows = store.cliRows;
    else if (lastTable === schema.apiKeys) rows = store.keyRows;
    else if (lastTable === schema.memberships) {
      rows = store.memberships.map((m) => ({
        ...m,
        name: store.orgs.find((o) => o.id === m.orgId)?.name,
        slug: store.orgs.find((o) => o.id === m.orgId)?.slug,
      }));
    } else if (lastTable === schema.organizations) rows = store.orgs;
    if (lastFilter) rows = rows.filter(lastFilter);
    return rows.slice(0, n);
  };

  return {
    select: (_cols?: unknown) => selectChain(),
    insert: (table: unknown) => ({
      values: async (v: any) => {
        if (table === schema.cliAuthSessions) {
          store.cliRows.push({
            id: v.id,
            verifier: v.verifier,
            orgId: v.orgId ?? null,
            userId: v.userId ?? null,
            status: v.status ?? 'pending',
            approvedApiKeyId: v.approvedApiKeyId ?? null,
            createdAt: new Date(),
            expiresAt: v.expiresAt,
            approvedAt: v.approvedAt ?? null,
            revealedAt: v.revealedAt ?? null,
          });
        } else if (table === schema.apiKeys) {
          store.keyRows.push({
            id: v.id,
            orgId: v.orgId,
            name: v.name,
            hash: v.hash,
            prefix: v.prefix,
            scopes: v.scopes,
            projectIds: v.projectIds ?? null,
            revokedAt: null,
            createdAt: new Date(),
            expiresAt: v.expiresAt ?? null,
            rotatedFromId: v.rotatedFromId ?? null,
          });
        } else if (table === schema.events) {
          store.events.push({
            orgId: v.orgId,
            action: v.action,
            metadata: v.metadata,
          });
        }
      },
    }),
    update: (table: unknown) => ({
      set: (patch: any) => ({
        where: (_p: unknown) => {
          const rows = table === schema.cliAuthSessions ? store.cliRows : [];
          // Apply the patch to every row — for the tests below we always
          // qualify updates with the id we just looked up, so mutating all
          // (single-row) matches is safe.
          const chain = {
            returning: async (_cols?: unknown) => {
              rows.forEach((r) => Object.assign(r, patch));
              return rows;
            },
          };
          // The routes never await the raw update; they either await the
          // promise directly (fire-and-forget in cli-auth.ts) or use .returning.
          // Make the update itself thenable so `await ctx.db.update(...).set(...).where(...)` works.
          const p: any = (async () => {
            rows.forEach((r) => Object.assign(r, patch));
          })();
          p.returning = chain.returning;
          return p;
        },
      }),
    }),
  } as unknown as AppContext['db'];
}

function makeCtx(store: Store): AppContext {
  return {
    logger: NoopLogger,
    db: makeDb(store),
    storage: new MemoryStorage(),
    ingestion: { ingest: async () => ({}) } as unknown as AppContext['ingestion'],
    emulators: {} as AppContext['emulators'],
  };
}

async function build(
  store: Store,
  sessionUser?: { id: string; email: string },
  secretStore?: SecretStore,
): Promise<FastifyInstance> {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      reply.status(400).send({ error: { code: 'CARBON_INVALID_INPUT', message: err.message } });
      return;
    }
    if (isCarbonError(err)) {
      const status =
        err.code === 'CARBON_UNAUTHENTICATED'
          ? 401
          : err.code === 'CARBON_FORBIDDEN'
            ? 403
            : err.code === 'CARBON_INVALID_INPUT'
              ? 400
              : err.code === 'CARBON_NOT_FOUND'
                ? 404
                : err.code === 'CARBON_CONFLICT'
                  ? 409
                  : err.code === 'CARBON_RATE_LIMITED'
                    ? 429
                    : 500;
      reply.status(status).send({
        error: { code: err.code, message: err.message, details: err.details },
      });
      return;
    }
    reply.status(500).send({ error: { code: 'CARBON_INTERNAL', message: String(err) } });
  });
  if (sessionUser) {
    app.addHook('onRequest', async (req) => {
      (req as SessionAuthenticatedRequest).sessionUser = sessionUser;
    });
  }
  await registerCliAuthRoutes(app, makeCtx(store), {
    dashboardUrl: 'http://localhost:3001',
    ...(secretStore ? { secretStore } : {}),
  });
  await app.ready();
  return app;
}

function makeStore(): Store {
  return {
    cliRows: [],
    keyRows: [],
    memberships: [{ userId: 'user_1', orgId: 'org_1', role: 'owner' }],
    orgs: [{ id: 'org_1', name: 'Acme', slug: 'acme' }],
    events: [],
  };
}

describe('cli-auth routes', () => {
  beforeEach(() => __resetCliAuthState());

  it('runs the full start → approve → reveal-once → status-only flow', async () => {
    const store = makeStore();
    // Shared secret store — with the Redis-optional store, each register()
    // call otherwise gets its own in-memory Map, and the approve/poll would
    // land on different stores.
    const secretStore = createSecretStore({ logger: NoopLogger });

    // Unauthenticated start.
    const publicApp = await build(store, undefined, secretStore);
    const start = await publicApp.inject({ method: 'POST', url: '/v1/cli-auth/start' });
    expect(start.statusCode).toBe(201);
    const startBody = start.json() as {
      sessionId: string;
      verifier: string;
      verificationUrl: string;
      expiresAt: string;
    };
    expect(startBody.sessionId).toMatch(/^[A-Z2-9]{8}$/);
    expect(startBody.verifier).toHaveLength(32);
    expect(startBody.verificationUrl).toContain(startBody.sessionId);
    expect(store.cliRows).toHaveLength(1);
    expect(store.cliRows[0]!.status).toBe('pending');

    // Approve as the signed-in user — same secret store as the poll side.
    const approveApp = await build(store, { id: 'user_1', email: 'a@example.com' }, secretStore);
    const approve = await approveApp.inject({
      method: 'POST',
      url: `/v1/cli-auth/${startBody.sessionId}/approve`,
      payload: {},
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json()).toMatchObject({ status: 'approved', orgId: 'org_1' });
    expect(store.cliRows[0]!.status).toBe('approved');
    expect(store.cliRows[0]!.approvedApiKeyId).toBeTruthy();
    expect(store.keyRows).toHaveLength(1);
    expect(store.events.some((e) => e.action === 'cli_auth.approved')).toBe(true);

    // Poll #1 — returns key, stamps revealedAt.
    const poll1 = await publicApp.inject({
      method: 'GET',
      url: `/v1/cli-auth/${startBody.sessionId}?verifier=${encodeURIComponent(startBody.verifier)}`,
    });
    expect(poll1.statusCode).toBe(200);
    const body1 = poll1.json() as { status: string; key?: string };
    expect(body1.status).toBe('approved');
    expect(body1.key).toMatch(/^ck_live_[a-f0-9]{12}\./);
    expect(store.cliRows[0]!.revealedAt).not.toBeNull();

    // Poll #2 — approved but no key (single-use reveal).
    const poll2 = await publicApp.inject({
      method: 'GET',
      url: `/v1/cli-auth/${startBody.sessionId}?verifier=${encodeURIComponent(startBody.verifier)}`,
    });
    expect(poll2.statusCode).toBe(200);
    const body2 = poll2.json() as { status: string; key?: string };
    expect(body2.status).toBe('approved');
    expect(body2.key).toBeUndefined();
  });

  it('rejects poll with wrong verifier as 404', async () => {
    const store = makeStore();
    const app = await build(store);
    const start = await app.inject({ method: 'POST', url: '/v1/cli-auth/start' });
    const body = start.json() as { sessionId: string };
    const res = await app.inject({
      method: 'GET',
      url: `/v1/cli-auth/${body.sessionId}?verifier=wrongwrongwrongwrongwrongwrongwr`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('flips status to expired and returns 410 when past expiresAt', async () => {
    const store = makeStore();
    const app = await build(store);
    const start = await app.inject({ method: 'POST', url: '/v1/cli-auth/start' });
    const body = start.json() as { sessionId: string; verifier: string };
    // Force-expire the row.
    store.cliRows[0]!.expiresAt = new Date(Date.now() - 1000);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/cli-auth/${body.sessionId}?verifier=${encodeURIComponent(body.verifier)}`,
    });
    expect(res.statusCode).toBe(410);
    expect((res.json() as { status: string }).status).toBe('expired');
    expect(store.cliRows[0]!.status).toBe('expired');
  });

  it('approve without a session returns 401', async () => {
    const store = makeStore();
    const app = await build(store); // no sessionUser
    const start = await app.inject({ method: 'POST', url: '/v1/cli-auth/start' });
    const body = start.json() as { sessionId: string };
    const res = await app.inject({
      method: 'POST',
      url: `/v1/cli-auth/${body.sessionId}/approve`,
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('when the user has multiple orgs, approve without orgId returns available orgs', async () => {
    const store = makeStore();
    store.orgs.push({ id: 'org_2', name: 'Beta', slug: 'beta' });
    store.memberships.push({ userId: 'user_1', orgId: 'org_2', role: 'admin' });
    const app = await build(store, { id: 'user_1', email: 'a@example.com' });
    const start = await app.inject({ method: 'POST', url: '/v1/cli-auth/start' });
    const body = start.json() as { sessionId: string };
    const res = await app.inject({
      method: 'POST',
      url: `/v1/cli-auth/${body.sessionId}/approve`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    const err = res.json() as { error: { code: string; availableOrgs: Array<{ id: string }> } };
    expect(err.error.code).toBe('CARBON_ORG_REQUIRED');
    expect(err.error.availableOrgs.map((o) => o.id).sort()).toEqual(['org_1', 'org_2']);
  });
});
