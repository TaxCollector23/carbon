import { describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { isCarbonError, NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import { registerSearchRoutes } from './search.js';

/**
 * Unit test with a fake `db.execute`. The real endpoint composes three raw
 * SQL branches (events, projects, artifacts). Rather than parse the SQL we
 * dispatch by inspecting the built query strings, then hand back synthetic
 * rows so the test verifies the response *shape* + org-scoping / merge /
 * limit behavior — not the SQL builder itself.
 */

interface Canned {
  events?: Array<Record<string, unknown>>;
  projects?: Array<Record<string, unknown>>;
  artifacts?: Array<Record<string, unknown>>;
}

function makeDb(canned: Canned): AppContext['db'] {
  return {
    execute: async (query: unknown) => {
      // drizzle's `sql` template compiles to an object with a `queryChunks`
      // array of literal SQL fragments; picking the first table name out of
      // it is enough to route the fake.
      const chunks = (query as { queryChunks?: Array<{ value?: string[] } | { value?: string }> })
        .queryChunks;
      const flat = (chunks ?? [])
        .map((c) => {
          const v = (c as { value?: unknown }).value;
          if (Array.isArray(v)) return v.join(' ');
          if (typeof v === 'string') return v;
          return '';
        })
        .join(' ');
      if (/FROM\s+events/i.test(flat)) return canned.events ?? [];
      if (/FROM\s+projects/i.test(flat)) return canned.projects ?? [];
      if (/FROM\s+artifacts/i.test(flat)) return canned.artifacts ?? [];
      return [];
    },
  } as unknown as AppContext['db'];
}

function makeCtx(canned: Canned): AppContext {
  return {
    logger: NoopLogger,
    db: makeDb(canned),
    storage: new MemoryStorage(),
    ingestion: { ingest: async () => ({}) } as unknown as AppContext['ingestion'],
    emulators: {} as AppContext['emulators'],
  };
}

async function build(canned: Canned, orgId: string | null): Promise<FastifyInstance> {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      reply.status(400).send({ error: { code: 'CARBON_INVALID_INPUT', message: err.message } });
      return;
    }
    if (isCarbonError(err)) {
      reply.status(400).send({ error: { code: err.code, message: err.message } });
      return;
    }
    const anyErr = err as { validation?: unknown; statusCode?: number };
    if (anyErr.validation) {
      const msg = err instanceof Error ? err.message : String(err);
      reply.status(400).send({ error: { code: 'CARBON_INVALID_INPUT', message: msg } });
      return;
    }
    reply.status(anyErr.statusCode ?? 500).send({
      error: { code: 'CARBON_INTERNAL', message: String(err) },
    });
  });
  if (orgId) {
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
  }
  await registerSearchRoutes(app, makeCtx(canned));
  await app.ready();
  return app;
}

describe('search routes', () => {
  it('returns a merged, score-sorted list across kinds', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const canned: Canned = {
      events: [
        { id: 'evt_1', action: 'project.created', actor_id: 'usr_a', created_at: now, score: 0.4 },
      ],
      projects: [
        { id: 'prj_1', slug: 'checkout', name: 'Checkout', created_at: now, score: 0.9 },
      ],
      artifacts: [
        { id: 'art_1', kind: 'ir', storage_key: 'projects/x/ir/y.json', created_at: now, score: 0.2 },
      ],
    };
    const app = await build(canned, 'org_a');
    const res = await app.inject({ method: 'GET', url: '/v1/search?q=checkout&scope=all' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      results: Array<{ kind: string; id: string; snippet: string; score: number; createdAt: string }>;
    };
    expect(body.results.map((r) => r.kind)).toEqual(['project', 'event', 'artifact']);
    expect(body.results[0]?.id).toBe('prj_1');
    expect(body.results[0]?.snippet).toContain('checkout');
    // Every result carries a snippet + score + createdAt.
    for (const r of body.results) {
      expect(typeof r.snippet).toBe('string');
      expect(typeof r.score).toBe('number');
      expect(typeof r.createdAt).toBe('string');
    }
  });

  it('respects scope=events (single kind, no others fetched)', async () => {
    const now = new Date('2026-01-02T00:00:00Z');
    const canned: Canned = {
      events: [{ id: 'evt_9', action: 'snapshot.saved', actor_id: null, created_at: now, score: 0.5 }],
      projects: [{ id: 'prj_9', slug: 's', name: 'S', created_at: now, score: 0.5 }],
    };
    const app = await build(canned, 'org_a');
    const res = await app.inject({ method: 'GET', url: '/v1/search?q=snap&scope=events' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { results: Array<{ kind: string; id: string }> };
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({ kind: 'event', id: 'evt_9' });
  });

  it('returns empty when no org is resolvable (auth-disabled dev mode)', async () => {
    const app = await build({}, null);
    const res = await app.inject({ method: 'GET', url: '/v1/search?q=anything' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ results: [] });
  });

  it('rejects an empty q with 400', async () => {
    const app = await build({}, 'org_a');
    const res = await app.inject({ method: 'GET', url: '/v1/search?q=' });
    expect(res.statusCode).toBe(400);
  });
});
