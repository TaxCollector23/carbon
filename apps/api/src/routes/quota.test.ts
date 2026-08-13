import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { isCarbonError, NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import type { EmulatorRegistry } from '../services/emulator-registry.js';
import { registerQuotaRoutes } from './quota.js';

interface UsageRow {
  id: string;
  orgId: string;
  kind: string;
  amount: number;
  metadata: unknown;
  occurredAt: Date;
}

interface Store {
  rows: UsageRow[];
  plan: 'developer' | 'team' | 'enterprise';
  emulators: number;
}

function makeDb(store: Store): AppContext['db'] {
  return {
    select: (cols?: unknown) => {
      const grouped = typeof cols === 'object' && cols !== null && 'total' in (cols as object);
      let lastTable: unknown = null;
      const from = (t: unknown) => {
        lastTable = t;
        return { where };
      };
      const where = () => {
        // The aggregate-shape select terminates at .where(); the row-fetch
        // shape terminates at .limit(). We return a value that supports both
        // by being thenable *and* having a .limit method.
        const aggregate =
          grouped && lastTable === schema.usageEvents
            ? [
                {
                  total: String(
                    store.rows.filter((r) => r.kind === 'ai_call').reduce((s, r) => s + r.amount, 0),
                  ),
                },
              ]
            : [];
        const limit = async () => {
          if (lastTable === schema.subscriptions) {
            return [{ plan: store.plan, status: 'active', seats: 1, currentPeriodEnd: null }];
          }
          return [];
        };
        // Thenable that also exposes .limit for the non-grouped path.
        return {
          then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(aggregate).then(resolve, reject),
          limit,
        };
      };
      return { from };
    },
  } as unknown as AppContext['db'];
}

function makeCtx(store: Store): AppContext {
  const emulators = {
    getCountForOrg: () => store.emulators,
  } as unknown as EmulatorRegistry;
  return {
    logger: NoopLogger,
    db: makeDb(store),
    storage: new MemoryStorage(),
    ingestion: { ingest: async () => ({}) } as unknown as AppContext['ingestion'],
    emulators,
  };
}

async function build(store: Store, opts: { scopes?: string[]; orgId?: string } = {}): Promise<FastifyInstance> {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      reply.status(400).send({ error: { code: 'CARBON_INVALID_INPUT', message: err.message } });
      return;
    }
    if (isCarbonError(err)) {
      const status =
        err.code === 'CARBON_INVALID_INPUT' ? 400
          : err.code === 'CARBON_FORBIDDEN' ? 403
          : err.code === 'CARBON_UNAUTHENTICATED' ? 401
          : 500;
      reply.status(status).send({ error: { code: err.code, message: err.message } });
      return;
    }
    reply.status(500).send({ error: { code: 'CARBON_INTERNAL', message: String(err) } });
  });
  app.addHook('onRequest', async (req) => {
    (req as AuthenticatedRequest).apiKey = {
      id: 'k',
      orgId: opts.orgId ?? 'org_1',
      prefix: 'aa11bb22cc33',
      scopes: (opts.scopes ?? ['read']) as ('read' | 'write' | 'admin')[],
      projectIds: null,
      expiresAt: null,
    };
  });
  await registerQuotaRoutes(app, makeCtx(store));
  await app.ready();
  return app;
}

describe('quota route', () => {
  const savedEnv = process.env.CARBON_MAX_EMULATORS_PER_ORG;
  beforeEach(() => {
    delete process.env.CARBON_MAX_EMULATORS_PER_ORG;
  });
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.CARBON_MAX_EMULATORS_PER_ORG;
    else process.env.CARBON_MAX_EMULATORS_PER_ORG = savedEnv;
  });

  it('returns plan limits + current usage for a developer org', async () => {
    const store: Store = {
      rows: [
        { id: 'u1', orgId: 'org_1', kind: 'ai_call', amount: 2, metadata: {}, occurredAt: new Date() },
        { id: 'u2', orgId: 'org_1', kind: 'ai_call', amount: 3, metadata: {}, occurredAt: new Date() },
      ],
      plan: 'developer',
      emulators: 1,
    };
    const app = await build(store);
    const res = await app.inject({ method: 'GET', url: '/v1/quota' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      orgId: string;
      plan: string;
      limits: { emulatorsMax: number | null; requestsPerMinute: number | null; aiIngestsPerMonth: number | null };
      current: { emulators: number; requestsLast1m: number | null; aiIngestsThisMonth: number };
    };
    expect(body.orgId).toBe('org_1');
    expect(body.plan).toBe('developer');
    expect(body.limits.emulatorsMax).toBe(1);
    expect(body.limits.requestsPerMinute).toBe(60);
    expect(body.limits.aiIngestsPerMonth).toBe(10);
    expect(body.current.emulators).toBe(1);
    expect(body.current.aiIngestsThisMonth).toBe(5);
    expect(body.current.requestsLast1m).toBeNull();
  });

  it('reports null (unlimited) emulator ceiling for enterprise', async () => {
    const store: Store = { rows: [], plan: 'enterprise', emulators: 42 };
    const app = await build(store);
    const res = await app.inject({ method: 'GET', url: '/v1/quota' });
    const body = res.json() as { plan: string; limits: { emulatorsMax: number | null; aiIngestsPerMonth: number | null } };
    expect(body.plan).toBe('enterprise');
    expect(body.limits.emulatorsMax).toBeNull();
    expect(body.limits.aiIngestsPerMonth).toBeNull();
  });

  it('honors CARBON_MAX_EMULATORS_PER_ORG override', async () => {
    process.env.CARBON_MAX_EMULATORS_PER_ORG = '3';
    const store: Store = { rows: [], plan: 'enterprise', emulators: 0 };
    const app = await build(store);
    const res = await app.inject({ method: 'GET', url: '/v1/quota' });
    const body = res.json() as { limits: { emulatorsMax: number | null } };
    expect(body.limits.emulatorsMax).toBe(3);
  });

  it('requires read scope', async () => {
    const store: Store = { rows: [], plan: 'developer', emulators: 0 };
    const app = await build(store, { scopes: [] });
    const res = await app.inject({ method: 'GET', url: '/v1/quota' });
    expect(res.statusCode).toBe(403);
  });
});
