import { describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { isCarbonError, NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import { recordEvent } from '../services/events.js';
import { registerEventRoutes } from './events.js';

/**
 * Events routes are exercised against a hand-rolled in-memory shim for the
 * events table. The shim replays the same filter shape the route emits
 * (orgId + optional projectId/action + createdAt cursor), which keeps the
 * test independent of Postgres while still asserting the org-scoping
 * behavior that matters for a shared audit log.
 */

interface EventRow {
  id: string;
  orgId: string;
  projectId: string | null;
  actorType: string;
  actorId: string | null;
  action: string;
  metadata: unknown;
  createdAt: Date;
}

interface Store {
  rows: EventRow[];
  /** Filter the next select() call will apply to `rows`. */
  filter: (r: EventRow) => boolean;
  /** Descending createdAt sort applied on top of the filter. */
  limit: number;
}

function makeDb(store: Store): AppContext['db'] {
  const db = {
    insert: (_table: unknown) => ({
      values: async (v: Partial<EventRow>) => {
        store.rows.push({
          id: v.id!,
          orgId: v.orgId!,
          projectId: (v.projectId as string | null | undefined) ?? null,
          actorType: v.actorType!,
          actorId: (v.actorId as string | null | undefined) ?? null,
          action: v.action!,
          metadata: v.metadata ?? {},
          // Insert order provides ordering; nudge the clock so cursor
          // pagination has distinguishable timestamps even on fast machines.
          createdAt: new Date(Date.now() + store.rows.length),
        });
      },
    }),
    select: (_cols?: unknown) => {
      let sorted: EventRow[] = [];
      const chain = {
        from: (_t: unknown) => chain,
        where: (_p?: unknown) => chain,
        orderBy: (_o?: unknown) => chain,
        limit: async (n: number) => {
          sorted = [...store.rows]
            .filter(store.filter)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          return sorted.slice(0, n);
        },
      };
      return chain;
    },
  } as unknown as AppContext['db'];
  return db;
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

async function build(store: Store, orgId: string): Promise<FastifyInstance> {
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
                : 500;
      reply.status(status).send({
        error: { code: err.code, message: err.message, details: err.details },
      });
      return;
    }
    reply.status(500).send({ error: { code: 'CARBON_INTERNAL', message: String(err) } });
  });
  // Simulate the api-key plugin: pin every request to a fixed org so the
  // route's `requestOrgId` returns the caller we want to test as.
  app.addHook('onRequest', async (req) => {
    (req as AuthenticatedRequest).apiKey = {
      id: 'key_test',
      orgId,
      prefix: 'aa11bb22cc33',
      scopes: ['admin'],
      projectIds: null,
      expiresAt: null,
    };
  });
  await registerEventRoutes(app, makeCtx(store));
  await app.ready();
  return app;
}

function makeStore(orgFilter: string): Store {
  return {
    rows: [],
    filter: (r) => r.orgId === orgFilter,
    limit: 50,
  };
}

describe('event routes', () => {
  it('lists events scoped to the caller org and hides other orgs', async () => {
    // Shared store so we can insert events for two orgs and then assert only
    // org_a's are visible when calling as org_a.
    const store: Store = { rows: [], filter: () => true, limit: 50 };
    const ctx = makeCtx(store);
    await recordEvent(ctx, {
      orgId: 'org_a',
      actorType: 'api_key',
      actorId: 'key_a',
      action: 'project.created',
      metadata: { slug: 'a-one' },
    });
    await recordEvent(ctx, {
      orgId: 'org_b',
      actorType: 'api_key',
      actorId: 'key_b',
      action: 'project.created',
      metadata: { slug: 'b-one' },
    });
    await recordEvent(ctx, {
      orgId: 'org_a',
      actorType: 'api_key',
      actorId: 'key_a',
      action: 'snapshot.saved',
      metadata: { name: 'nightly' },
    });

    // Callers pinned to org_a see only their two events.
    store.filter = (r) => r.orgId === 'org_a';
    const appA = await build(store, 'org_a');
    const resA = await appA.inject({ method: 'GET', url: '/v1/events' });
    expect(resA.statusCode).toBe(200);
    const bodyA = resA.json() as { data: EventRow[]; hasMore: boolean };
    expect(bodyA.data).toHaveLength(2);
    expect(bodyA.data.map((r) => r.action).sort()).toEqual(['project.created', 'snapshot.saved']);
    expect(bodyA.data.every((r) => r.orgId === 'org_a')).toBe(true);
    expect(bodyA.hasMore).toBe(false);

    // Switch to org_b: only the single b event surfaces, and none of org_a's.
    store.filter = (r) => r.orgId === 'org_b';
    const appB = await build(store, 'org_b');
    const resB = await appB.inject({ method: 'GET', url: '/v1/events' });
    expect(resB.statusCode).toBe(200);
    const bodyB = resB.json() as { data: EventRow[] };
    expect(bodyB.data).toHaveLength(1);
    expect(bodyB.data[0]?.orgId).toBe('org_b');
    expect(bodyB.data[0]?.action).toBe('project.created');
  });

  it('csv export returns rows for the caller org only, with header + escaping', async () => {
    const store: Store = { rows: [], filter: () => true, limit: 50 };
    const ctx = makeCtx(store);
    await recordEvent(ctx, {
      orgId: 'org_a',
      actorType: 'api_key',
      actorId: 'key_a',
      action: 'project.created',
      // Comma + quote to exercise CSV escaping; a naive join would corrupt
      // the row on import into any spreadsheet tool.
      metadata: { note: 'hello, "world"' },
    });
    await recordEvent(ctx, {
      orgId: 'org_b',
      actorType: 'system',
      action: 'ingest.completed',
      metadata: {},
    });

    store.filter = (r) => r.orgId === 'org_a';
    const app = await build(store, 'org_a');
    const res = await app.inject({ method: 'GET', url: '/v1/events/export?format=csv' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const lines = res.body.split('\n');
    expect(lines[0]).toBe(
      'id,createdAt,orgId,projectId,actorType,actorId,action,metadata',
    );
    // Two lines: header + one org_a row. The org_b row must NOT appear.
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('org_a');
    expect(lines[1]).not.toContain('org_b');
    // Escaped metadata cell wraps its contents in quotes and doubles the
    // internal quote — otherwise the "world" would break the column count.
    expect(lines[1]).toMatch(/"\{""note"":""hello, \\?""world\\?""""\}"|"\{""note"":""hello, \\"world\\""""\}"/);
  });
});
