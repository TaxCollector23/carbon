import { describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { isCarbonError, NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import { registerAiQualityRoutes } from './ai-quality.js';

interface ReportRow {
  id: string;
  projectId: string;
  irKey: string | null;
  resourcesScore: string | null;
  relationshipsScore: string | null;
  minScore: string | null;
  issues: unknown[];
  needsReview: boolean;
  model: string | null;
  createdAt: Date;
}

interface ProjectRow {
  id: string;
  orgId: string;
  slug: string;
}

interface Store {
  reports: ReportRow[];
  projects: ProjectRow[];
  /**
   * Optional cursor value the fake will apply as `lt(createdAt, cursor)`.
   * Set by tests that exercise the paging query.
   */
  cursor?: Date;
}

function makeDb(store: Store): AppContext['db'] {
  let lastTable: unknown = null;
  const chain = (): any => {
    const c: any = {
      from: (t: unknown) => {
        lastTable = t;
        return c;
      },
      where: () => c,
      orderBy: () => c,
      limit: async (n: number) => {
        if (lastTable === schema.aiQualityReports) {
          const rows = [...store.reports].sort(
            (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
          );
          const filtered = store.cursor
            ? rows.filter((r) => r.createdAt.getTime() < store.cursor!.getTime())
            : rows;
          return filtered.slice(0, n);
        }
        if (lastTable === schema.projects) return [...store.projects];
        if (lastTable === schema.projectMembers) return [];
        return [];
      },
    };
    return c;
  };
  return {
    select: (_cols?: unknown) => chain(),
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

async function build(store: Store): Promise<FastifyInstance> {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      reply.status(400).send({ error: { code: 'CARBON_INVALID_INPUT', message: err.message } });
      return;
    }
    if (isCarbonError(err)) {
      const status =
        err.code === 'CARBON_NOT_FOUND'
          ? 404
          : err.code === 'CARBON_FORBIDDEN'
            ? 403
            : err.code === 'CARBON_INVALID_INPUT'
              ? 400
              : 500;
      reply.status(status).send({ error: { code: err.code, message: err.message } });
      return;
    }
    reply.status(500).send({ error: { code: 'CARBON_INTERNAL', message: String(err) } });
  });
  app.addHook('onRequest', async (req) => {
    (req as AuthenticatedRequest).apiKey = {
      id: 'k',
      orgId: 'org_1',
      prefix: 'aa11bb22cc33',
      scopes: ['admin'],
      projectIds: null,
      expiresAt: null,
    };
  });
  await registerAiQualityRoutes(app, makeCtx(store));
  await app.ready();
  return app;
}

function makeReport(overrides: Partial<ReportRow> & { id: string; createdAt: Date }): ReportRow {
  return {
    projectId: 'proj_1',
    irKey: null,
    resourcesScore: '0.9000',
    relationshipsScore: '0.9000',
    minScore: '0.9000',
    issues: [],
    needsReview: false,
    model: 'test-model',
    ...overrides,
  };
}

describe('ai-quality routes', () => {
  it('GET /v1/projects/:id/ai-quality lists reports newest-first', async () => {
    const store: Store = {
      projects: [{ id: 'proj_1', orgId: 'org_1', slug: 'acme' }],
      reports: [
        makeReport({ id: 'aiq_a', createdAt: new Date(1_000) }),
        makeReport({ id: 'aiq_b', createdAt: new Date(2_000) }),
      ],
    };
    const app = await build(store);
    const res = await app.inject({ method: 'GET', url: '/v1/projects/proj_1/ai-quality' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: ReportRow[]; hasMore: boolean };
    expect(body.data.map((r) => r.id)).toEqual(['aiq_b', 'aiq_a']);
    expect(body.hasMore).toBe(false);
  });

  it('GET /v1/projects/:id/ai-quality/latest returns the newest report', async () => {
    const store: Store = {
      projects: [{ id: 'proj_1', orgId: 'org_1', slug: 'acme' }],
      reports: [
        makeReport({ id: 'aiq_a', createdAt: new Date(1_000) }),
        makeReport({ id: 'aiq_b', createdAt: new Date(2_000) }),
      ],
    };
    const app = await build(store);
    const res = await app.inject({ method: 'GET', url: '/v1/projects/proj_1/ai-quality/latest' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as ReportRow).id).toBe('aiq_b');
  });

  it('GET /v1/projects/:id/ai-quality/latest returns 404 when the project has no reports', async () => {
    const store: Store = {
      projects: [{ id: 'proj_1', orgId: 'org_1', slug: 'acme' }],
      reports: [],
    };
    const app = await build(store);
    const res = await app.inject({ method: 'GET', url: '/v1/projects/proj_1/ai-quality/latest' });
    expect(res.statusCode).toBe(404);
  });

  it('cursor paginates by createdAt', async () => {
    const store: Store = {
      projects: [{ id: 'proj_1', orgId: 'org_1', slug: 'acme' }],
      reports: [
        makeReport({ id: 'aiq_a', createdAt: new Date(1_000) }),
        makeReport({ id: 'aiq_b', createdAt: new Date(2_000) }),
      ],
    };
    const app = await build(store);
    // Serve the newest and ask for one — hasMore should be true.
    const first = await app.inject({
      method: 'GET',
      url: '/v1/projects/proj_1/ai-quality?limit=1',
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as {
      data: ReportRow[];
      hasMore: boolean;
      nextCursor: string | null;
    };
    expect(firstBody.data).toHaveLength(1);
    expect(firstBody.data[0]?.id).toBe('aiq_b');
    expect(firstBody.hasMore).toBe(true);
    expect(firstBody.nextCursor).toBeTruthy();

    store.cursor = new Date(firstBody.nextCursor!);
    const next = await app.inject({
      method: 'GET',
      url: `/v1/projects/proj_1/ai-quality?limit=1&cursor=${encodeURIComponent(firstBody.nextCursor!)}`,
    });
    expect(next.statusCode).toBe(200);
    const nextBody = next.json() as { data: ReportRow[]; hasMore: boolean };
    expect(nextBody.data.map((r) => r.id)).toEqual(['aiq_a']);
    expect(nextBody.hasMore).toBe(false);
  });

  it('cross-org project id returns 404', async () => {
    const store: Store = {
      projects: [{ id: 'proj_2', orgId: 'org_other', slug: 'acme' }],
      reports: [],
    };
    const app = await build(store);
    const res = await app.inject({ method: 'GET', url: '/v1/projects/proj_2/ai-quality' });
    expect(res.statusCode).toBe(404);
  });
});
