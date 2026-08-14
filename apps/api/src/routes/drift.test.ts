import { describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { isCarbonError, NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import { registerDriftRoutes } from './drift.js';

interface DriftRow {
  id: string;
  projectId: string;
  status: 'pending' | 'running' | 'ok' | 'drift' | 'error';
  ranAt: Date | null;
  result: Record<string, unknown>;
  createdAt: Date;
}
interface ArtifactRow {
  id: string;
  projectId: string;
  kind: 'ir' | 'graph' | 'snapshot' | 'recording';
  meta: Record<string, unknown> | null;
  createdAt: Date;
}
interface ProjectRow {
  id: string;
  orgId: string;
  slug: string;
}

interface Store {
  projects: ProjectRow[];
  drifts: DriftRow[];
  artifacts: ArtifactRow[];
  events: Array<{ orgId: string; action: string; metadata: unknown }>;
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
        if (lastTable === schema.driftChecks) {
          const rows = [...store.drifts].sort(
            (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
          );
          const filtered = store.cursor
            ? rows.filter((r) => r.createdAt.getTime() < store.cursor!.getTime())
            : rows;
          return filtered.slice(0, n);
        }
        if (lastTable === schema.artifacts) {
          return [...store.artifacts]
            .filter((a) => a.kind === 'recording')
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .slice(0, n);
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
    insert: (table: unknown) => ({
      values: async (v: any) => {
        if (table === schema.driftChecks) {
          store.drifts.push({
            id: v.id,
            projectId: v.projectId,
            status: v.status ?? 'pending',
            ranAt: v.ranAt ?? null,
            result: v.result ?? {},
            createdAt: new Date(),
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
      set: (patch: Record<string, unknown>) => ({
        where: async () => {
          if (table === schema.artifacts) {
            // We only ever target the newest recording in this route; apply the
            // patch to whichever recording has the largest createdAt.
            const target = [...store.artifacts]
              .filter((a) => a.kind === 'recording')
              .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
            if (target) target.meta = (patch.meta as Record<string, unknown>) ?? target.meta;
          }
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
  await registerDriftRoutes(app, makeCtx(store));
  await app.ready();
  return app;
}

function seed(overrides: Partial<Store> = {}): Store {
  return {
    projects: [{ id: 'proj_1', orgId: 'org_1', slug: 'acme' }],
    drifts: [],
    artifacts: [],
    events: [],
    ...overrides,
  };
}

describe('drift routes', () => {
  it('GET /v1/projects/:id/drift lists checks newest-first', async () => {
    const store = seed({
      drifts: [
        {
          id: 'drift_a',
          projectId: 'proj_1',
          status: 'ok',
          ranAt: new Date(1_000),
          result: { sampled: 3, mismatches: 0 },
          createdAt: new Date(1_000),
        },
        {
          id: 'drift_b',
          projectId: 'proj_1',
          status: 'drift',
          ranAt: new Date(2_000),
          result: { sampled: 3, mismatches: 1 },
          createdAt: new Date(2_000),
        },
      ],
    });
    const app = await build(store);
    const res = await app.inject({ method: 'GET', url: '/v1/projects/proj_1/drift' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: DriftRow[]; hasMore: boolean };
    expect(body.data.map((r) => r.id)).toEqual(['drift_b', 'drift_a']);
    expect(body.hasMore).toBe(false);
  });

  it('POST /v1/projects/:id/drift/run inserts a pending row and records an event', async () => {
    const store = seed();
    const app = await build(store);
    const res = await app.inject({ method: 'POST', url: '/v1/projects/proj_1/drift/run' });
    expect(res.statusCode).toBe(202);
    const body = res.json() as { id: string; status: string };
    expect(body.status).toBe('pending');
    expect(store.drifts).toHaveLength(1);
    expect(store.drifts[0]?.status).toBe('pending');
    expect(store.events.some((e) => e.action === 'drift.run_requested')).toBe(true);
  });

  it('GET /v1/projects/:id/drift/config returns nulls when no recording exists', async () => {
    const store = seed();
    const app = await build(store);
    const res = await app.inject({ method: 'GET', url: '/v1/projects/proj_1/drift/config' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { upstreamUrl: null; enabled: boolean; configuredAt: null };
    expect(body.upstreamUrl).toBeNull();
    expect(body.enabled).toBe(false);
    expect(body.configuredAt).toBeNull();
  });

  it('GET /v1/projects/:id/drift/config reads meta from the latest recording', async () => {
    const store = seed({
      artifacts: [
        {
          id: 'rec_a',
          projectId: 'proj_1',
          kind: 'recording',
          meta: { upstreamUrl: 'https://old.example.com', driftIntervalMinutes: 30 },
          createdAt: new Date(1_000),
        },
        {
          id: 'rec_b',
          projectId: 'proj_1',
          kind: 'recording',
          meta: {
            upstreamUrl: 'https://api.example.com',
            driftIntervalMinutes: 60,
            driftEnabled: true,
          },
          createdAt: new Date(2_000),
        },
      ],
    });
    const app = await build(store);
    const res = await app.inject({ method: 'GET', url: '/v1/projects/proj_1/drift/config' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { upstreamUrl: string; intervalMinutes: number; enabled: boolean };
    expect(body.upstreamUrl).toBe('https://api.example.com');
    expect(body.intervalMinutes).toBe(60);
    expect(body.enabled).toBe(true);
  });

  it('PATCH /v1/projects/:id/drift/config merges into the latest recording meta', async () => {
    const store = seed({
      artifacts: [
        {
          id: 'rec_a',
          projectId: 'proj_1',
          kind: 'recording',
          meta: { unrelated: 'keep-me' },
          createdAt: new Date(2_000),
        },
      ],
    });
    const app = await build(store);
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/projects/proj_1/drift/config',
      payload: { upstreamUrl: 'https://new.example.com', intervalMinutes: 45, enabled: true },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { upstreamUrl: string; intervalMinutes: number; enabled: boolean };
    expect(body.upstreamUrl).toBe('https://new.example.com');
    expect(body.intervalMinutes).toBe(45);
    expect(body.enabled).toBe(true);
    // Existing meta keys should still be present.
    expect(store.artifacts[0]?.meta?.unrelated).toBe('keep-me');
    expect(store.events.some((e) => e.action === 'drift.config_updated')).toBe(true);
  });

  it('PATCH /v1/projects/:id/drift/config returns 404 when there is no recording', async () => {
    const store = seed();
    const app = await build(store);
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/projects/proj_1/drift/config',
      payload: { upstreamUrl: 'https://x.example.com' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('cross-org project id returns 404', async () => {
    const store = seed({ projects: [{ id: 'proj_2', orgId: 'org_other', slug: 'acme' }] });
    const app = await build(store);
    const res = await app.inject({ method: 'GET', url: '/v1/projects/proj_2/drift' });
    expect(res.statusCode).toBe(404);
  });
});
