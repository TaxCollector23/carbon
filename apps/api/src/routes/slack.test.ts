import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { isCarbonError, NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import { registerSlackRoutes } from './slack.js';
import {
  __resetSlackKeyForTests,
  decryptSlackToken,
  type SlackApiClient,
} from '../services/slack.js';

/**
 * Slack integration routes: OAuth install/callback, installation listing,
 * subscription CRUD, and installation delete. Slack's REST API is stubbed.
 */

interface InstallRow {
  id: string;
  orgId: string;
  teamId: string;
  teamName: string;
  accessToken: string;
  botUserId: string | null;
  appId: string | null;
  installedBy: string | null;
  installedAt: Date;
}
interface SubRow {
  id: string;
  installationId: string;
  channelId: string;
  channelName: string;
  events: string[];
  createdAt: Date;
}
interface Store {
  installs: InstallRow[];
  subs: SubRow[];
  events: Array<{ orgId: string; action: string }>;
}

function makeDb(store: Store): AppContext['db'] {
  // Track the table currently being read so `where().limit()` returns the
  // right slice. This test scaffold is deliberately tiny — it mimics the
  // handful of drizzle chains slack.ts actually uses.
  let currentTable: unknown = null;
  let joined: unknown = null;
  let lastWhere: (row: unknown) => boolean = () => true;

  const chain: any = {
    from: (t: unknown) => {
      currentTable = t;
      return chain;
    },
    innerJoin: (t: unknown) => {
      joined = t;
      return chain;
    },
    where: (pred?: unknown) => {
      // We can't evaluate the drizzle SQL expression here — instead, tests
      // that need row narrowing populate `store` so a full table read is
      // already the "right" answer. `lastWhere` stays a no-op.
      void pred;
      lastWhere = () => true;
      return chain;
    },
    limit: async () => {
      return runSelect();
    },
    orderBy: () => chain,
    then: undefined as unknown,
  };

  // Await support so `.select().from().where()` (no .limit) is thenable.
  const runSelect = async (): Promise<unknown[]> => {
    if (currentTable === schema.slackInstallations) return store.installs.filter(lastWhere as any);
    if (currentTable === schema.slackChannelSubscriptions) {
      if (joined === schema.slackInstallations) {
        // sub × install join used by DELETE subscription
        return store.subs.map((s) => {
          const inst = store.installs.find((i) => i.id === s.installationId);
          return { id: s.id, orgId: inst?.orgId ?? null };
        });
      }
      return store.subs;
    }
    return [];
  };
  chain.then = (resolve: (v: unknown) => unknown) => runSelect().then(resolve);

  return {
    select: (_cols?: unknown) => {
      currentTable = null;
      joined = null;
      lastWhere = () => true;
      // Fresh chain per select to reset joined state
      const c: any = { ...chain };
      c.from = chain.from;
      c.innerJoin = chain.innerJoin;
      c.where = chain.where;
      c.limit = chain.limit;
      c.orderBy = chain.orderBy;
      c.then = chain.then;
      return c;
    },
    insert: (table: unknown) => ({
      values: async (v: any) => {
        if (table === schema.slackInstallations) store.installs.push({ ...v, installedAt: v.installedAt ?? new Date() });
        else if (table === schema.slackChannelSubscriptions) store.subs.push({ ...v });
        else if (table === schema.events) store.events.push({ orgId: v.orgId, action: v.action });
      },
    }),
    update: (table: unknown) => {
      let patch: any = {};
      const u: any = {
        set: (p: any) => {
          patch = p;
          return u;
        },
        where: async () => {
          if (table === schema.slackInstallations) {
            for (const r of store.installs) Object.assign(r, patch);
          }
        },
      };
      return u;
    },
    delete: (table: unknown) => ({
      where: async () => {
        if (table === schema.slackInstallations) store.installs = [];
        else if (table === schema.slackChannelSubscriptions) store.subs = [];
      },
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

function makeStubApi(overrides: Partial<SlackApiClient> = {}): SlackApiClient {
  return {
    exchangeCode: overrides.exchangeCode ?? vi.fn(async () => ({
      ok: true,
      access_token: 'xoxb-real-token',
      bot_user_id: 'U_BOT',
      app_id: 'A123',
      team: { id: 'T_TEAM', name: 'Acme' },
    })),
    postMessage: overrides.postMessage ?? vi.fn(async () => ({ ok: true, ts: '1.0' })),
    revoke: overrides.revoke ?? vi.fn(async () => ({ ok: true, revoked: true })),
  };
}

async function build(
  store: Store,
  orgId: string,
  scopes: readonly string[] = ['admin'],
  slackApi?: SlackApiClient,
): Promise<FastifyInstance> {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      reply.status(400).send({ error: { code: 'CARBON_INVALID_INPUT', message: err.message } });
      return;
    }
    if (isCarbonError(err)) {
      const status =
        err.code === 'CARBON_FORBIDDEN'
          ? 403
          : err.code === 'CARBON_NOT_FOUND'
            ? 404
            : err.code === 'CARBON_INVALID_INPUT'
              ? 400
              : 500;
      reply.status(status).send({ error: { code: err.code, message: err.message } });
      return;
    }
    // Fastify's own schema/ajv errors carry a 4xx statusCode.
    const s = (err as { statusCode?: number }).statusCode;
    if (typeof s === 'number' && s >= 400 && s < 500) {
      reply.status(s).send({
        error: { code: 'CARBON_INVALID_INPUT', message: err instanceof Error ? err.message : String(err) },
      });
      return;
    }
    reply.status(500).send({ error: { code: 'CARBON_INTERNAL', message: String(err) } });
  });
  app.addHook('onRequest', async (req) => {
    (req as AuthenticatedRequest).apiKey = {
      id: 'k',
      orgId,
      prefix: 'aa11bb22cc33',
      scopes: [...scopes],
      projectIds: null,
      expiresAt: null,
    };
  });
  await registerSlackRoutes(app, makeCtx(store), {
    slackApi,
    clientId: 'CID',
    clientSecret: 'CSECRET',
    redirectUri: 'http://localhost:4000/v1/slack/oauth-callback',
    dashboardUrl: 'http://localhost:3001',
  });
  await app.ready();
  return app;
}

describe('slack routes', () => {
  beforeEach(() => {
    __resetSlackKeyForTests();
    process.env.SLACK_TOKEN_ENC_KEY = 'test-only-key';
  });

  it('GET /v1/slack/install redirects to slack.com with the right scopes', async () => {
    const store: Store = { installs: [], subs: [], events: [] };
    const app = await build(store, 'org_1');
    const res = await app.inject({ method: 'GET', url: '/v1/slack/install' });
    expect(res.statusCode).toBe(302);
    const loc = res.headers.location as string;
    expect(loc).toMatch(/^https:\/\/slack\.com\/oauth\/v2\/authorize\?/);
    expect(loc).toContain('client_id=CID');
    expect(loc).toContain('channels%3Aread');
    expect(loc).toContain('chat%3Awrite');
    expect(loc).toContain('incoming-webhook');
  });

  it('GET /v1/slack/oauth-callback exchanges code, stores encrypted token, redirects to dashboard', async () => {
    const store: Store = { installs: [], subs: [], events: [] };
    const api = makeStubApi();
    const app = await build(store, 'org_1', ['admin'], api);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/slack/oauth-callback?code=abc&state=org_1:nonce',
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('/settings?slack=installed');
    expect(api.exchangeCode).toHaveBeenCalledTimes(1);
    expect(store.installs).toHaveLength(1);
    const inst = store.installs[0]!;
    expect(inst.orgId).toBe('org_1');
    expect(inst.teamId).toBe('T_TEAM');
    // Token is encrypted at rest — must decrypt back to plaintext.
    expect(inst.accessToken).not.toContain('xoxb-real-token');
    expect(decryptSlackToken(inst.accessToken)).toBe('xoxb-real-token');
    expect(store.events.some((e) => e.action === 'slack_installation.created')).toBe(true);
  });

  it('oauth-callback with Slack error param returns 400', async () => {
    const store: Store = { installs: [], subs: [], events: [] };
    const app = await build(store, 'org_1');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/slack/oauth-callback?error=access_denied',
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /v1/slack/installations returns caller-org installations', async () => {
    const store: Store = {
      installs: [
        {
          id: 'slkinst_1',
          orgId: 'org_1',
          teamId: 'T_TEAM',
          teamName: 'Acme',
          accessToken: 'ct',
          botUserId: 'U',
          appId: 'A',
          installedBy: null,
          installedAt: new Date(),
        },
      ],
      subs: [],
      events: [],
    };
    const app = await build(store, 'org_1');
    const res = await app.inject({ method: 'GET', url: '/v1/slack/installations' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ id: string; accessToken?: unknown }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.id).toBe('slkinst_1');
    // Encrypted token must never leak to the list response.
    expect((body.data[0] as Record<string, unknown>).accessToken).toBeUndefined();
  });

  it('POST /v1/slack/subscriptions creates a subscription and records an event', async () => {
    const store: Store = {
      installs: [
        {
          id: 'slkinst_1',
          orgId: 'org_1',
          teamId: 'T',
          teamName: 'Acme',
          accessToken: 'ct',
          botUserId: null,
          appId: null,
          installedBy: null,
          installedAt: new Date(),
        },
      ],
      subs: [],
      events: [],
    };
    const app = await build(store, 'org_1');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/slack/subscriptions',
      payload: {
        installationId: 'slkinst_1',
        channelId: 'C123',
        channelName: 'general',
        events: ['snapshot.overwritten', 'drift.detected'],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(store.subs).toHaveLength(1);
    expect(store.subs[0]!.events).toEqual(['snapshot.overwritten', 'drift.detected']);
    expect(store.events.some((e) => e.action === 'slack_subscription.created')).toBe(true);
  });

  it('POST /v1/slack/subscriptions rejects invalid body (empty events)', async () => {
    const store: Store = { installs: [], subs: [], events: [] };
    const app = await build(store, 'org_1');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/slack/subscriptions',
      payload: { installationId: 'x', channelId: 'C', channelName: 'g', events: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /v1/slack/subscriptions with unknown installation → 404', async () => {
    const store: Store = { installs: [], subs: [], events: [] };
    const app = await build(store, 'org_1');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/slack/subscriptions',
      payload: {
        installationId: 'missing',
        channelId: 'C',
        channelName: 'g',
        events: ['x'],
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it('non-admin scope is blocked from the admin routes', async () => {
    const store: Store = { installs: [], subs: [], events: [] };
    const app = await build(store, 'org_1', ['read']);
    const res = await app.inject({ method: 'GET', url: '/v1/slack/installations' });
    expect(res.statusCode).toBe(403);
  });

  it('DELETE /v1/slack/installations/:id revokes and hard-deletes', async () => {
    // Use a real ciphertext so `decryptSlackToken` succeeds.
    __resetSlackKeyForTests();
    process.env.SLACK_TOKEN_ENC_KEY = 'test-only-key';
    const { encryptSlackToken } = await import('../services/slack.js');
    const store: Store = {
      installs: [
        {
          id: 'slkinst_1',
          orgId: 'org_1',
          teamId: 'T',
          teamName: 'Acme',
          accessToken: encryptSlackToken('xoxb-token'),
          botUserId: null,
          appId: null,
          installedBy: null,
          installedAt: new Date(),
        },
      ],
      subs: [],
      events: [],
    };
    const api = makeStubApi();
    const app = await build(store, 'org_1', ['admin'], api);
    const res = await app.inject({ method: 'DELETE', url: '/v1/slack/installations/slkinst_1' });
    expect(res.statusCode).toBe(204);
    expect(store.installs).toHaveLength(0);
    expect(api.revoke).toHaveBeenCalledWith({ token: 'xoxb-token' });
    expect(store.events.some((e) => e.action === 'slack_installation.deleted')).toBe(true);
  });
});
