import { describe, expect, it, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { isCarbonError, NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import { _resetSampleSpecCache, registerSampleRoutes, SAMPLES } from './samples.js';

interface ProjectRow {
  id: string;
  orgId: string;
  slug: string;
  name: string;
}

interface Store {
  projects: ProjectRow[];
}

function makeDb(store: Store): AppContext['db'] {
  return {
    insert: (table: unknown) => ({
      values: async (v: ProjectRow) => {
        if (table === schema.projects) {
          if (store.projects.some((p) => p.orgId === v.orgId && p.slug === v.slug)) {
            throw new Error('duplicate key value violates unique constraint');
          }
          store.projects.push({ id: v.id, orgId: v.orgId, slug: v.slug, name: v.name });
        }
        // events / usage inserts are best-effort and simply ignored here.
      },
    }),
    // Nothing in the samples route path calls .select() — no chain needed.
  } as unknown as AppContext['db'];
}

function makeCtx(store: Store, ingest = vi.fn()): AppContext {
  ingest.mockImplementation(async () => ({
    irId: 'ir_sample',
    graphId: 'g_sample',
    ir: { api: { title: 'Sample' }, endpoints: new Array(17).fill({}), resources: new Array(4).fill({}) },
    warnings: [],
  }));
  return {
    logger: NoopLogger,
    db: makeDb(store),
    storage: new MemoryStorage(),
    ingestion: { ingest } as unknown as AppContext['ingestion'],
    emulators: {} as AppContext['emulators'],
  };
}

async function build(
  store: Store,
  {
    scopes = ['admin', 'write', 'read'],
    orgId = 'org_1',
    ingest,
  }: { scopes?: readonly string[]; orgId?: string | null; ingest?: ReturnType<typeof vi.fn> } = {},
): Promise<{ app: FastifyInstance; ingest: ReturnType<typeof vi.fn> }> {
  const ing = ingest ?? vi.fn();
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      reply.status(400).send({ error: { code: 'CARBON_INVALID_INPUT', message: err.message } });
      return;
    }
    if (isCarbonError(err)) {
      const status =
        err.code === 'CARBON_FORBIDDEN' ? 403
          : err.code === 'CARBON_NOT_FOUND' ? 404
          : err.code === 'CARBON_CONFLICT' ? 409
          : err.code === 'CARBON_INVALID_INPUT' ? 400
          : 500;
      reply.status(status).send({ error: { code: err.code, message: err.message } });
      return;
    }
    reply.status(500).send({ error: { code: 'CARBON_INTERNAL', message: String(err) } });
  });
  app.addHook('onRequest', async (req) => {
    if (orgId === null) return;
    (req as AuthenticatedRequest).apiKey = {
      id: 'key_test',
      orgId,
      prefix: 'aa11bb22cc33',
      scopes: [...scopes],
      projectIds: null,
      expiresAt: null,
    };
  });
  await registerSampleRoutes(app, makeCtx(store, ing));
  await app.ready();
  return { app, ingest: ing };
}

beforeEach(() => {
  _resetSampleSpecCache();
});

describe('POST /v1/samples/instantiate', () => {
  it('creates a project, runs the ingest, and returns the sample summary + ingest result', async () => {
    const store: Store = { projects: [] };
    const { app, ingest } = await build(store);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/samples/instantiate',
      payload: { sampleId: 'petstore' },
    });
    expect(res.statusCode).toBe(201);
    const json = res.json() as {
      projectSlug: string;
      projectId: string;
      orgId: string;
      sample: { id: string; name: string; tag: string };
      sampleAnnotations: { tryThis: string[] };
      ingestResult: { irId: string; endpoints: number; resources: number };
    };
    expect(json.orgId).toBe('org_1');
    expect(json.sample.id).toBe('petstore');
    expect(json.sampleAnnotations.tryThis.length).toBeGreaterThan(0);
    expect(json.projectSlug).toMatch(/^sample-petstore-[a-z0-9]+$/);
    expect(json.ingestResult).toMatchObject({ irId: 'ir_sample', endpoints: 17, resources: 4 });

    // Project row landed with the org id from the API key.
    expect(store.projects).toHaveLength(1);
    expect(store.projects[0]).toMatchObject({ orgId: 'org_1', slug: json.projectSlug });

    // Ingestion was invoked with the storage-scoped slug and openapi hint.
    expect(ingest).toHaveBeenCalledTimes(1);
    const arg = ingest.mock.calls[0]![0] as {
      projectSlug: string;
      input: { kind: string; hint: string; content: unknown };
      origin: string;
      context: { orgId: string };
    };
    expect(arg.projectSlug).toBe(`org_1/${json.projectSlug}`);
    expect(arg.input.kind).toBe('json');
    expect(arg.input.hint).toBe('openapi');
    expect(arg.origin).toBe('sample:petstore');
    expect(arg.context).toEqual({ orgId: 'org_1' });
    // Spec really was loaded from the fixture file.
    expect(arg.input.content).toMatchObject({ openapi: expect.any(String), paths: expect.any(Object) });
  });

  it('returns 404 for an unknown sampleId (and does not create a project)', async () => {
    const store: Store = { projects: [] };
    const { app, ingest } = await build(store);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/samples/instantiate',
      payload: { sampleId: 'nope-does-not-exist' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('CARBON_NOT_FOUND');
    expect(store.projects).toHaveLength(0);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('requires admin scope — a write-only key is rejected before touching the DB', async () => {
    const store: Store = { projects: [] };
    const { app, ingest } = await build(store, { scopes: ['read', 'write'] });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/samples/instantiate',
      payload: { sampleId: 'stripe' },
    });
    expect(res.statusCode).toBe(403);
    expect(store.projects).toHaveLength(0);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('refuses to instantiate when no caller org can be resolved', async () => {
    const store: Store = { projects: [] };
    // orgId: null → no apiKey attached at all → resolveCallerOrg throws
    const { app, ingest } = await build(store, { orgId: null });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/samples/instantiate',
      payload: { sampleId: 'petstore' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('CARBON_INVALID_INPUT');
    expect(store.projects).toHaveLength(0);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('pins the created project to the caller org — no cross-org write path', async () => {
    const store: Store = {
      projects: [{ id: 'prj_pre', orgId: 'org_other', slug: 'existing', name: 'other-org' }],
    };
    const { app } = await build(store, { orgId: 'org_1' });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/samples/instantiate',
      payload: { sampleId: 'github' },
    });
    expect(res.statusCode).toBe(201);
    const created = store.projects.find((p) => p.slug !== 'existing');
    expect(created).toBeDefined();
    expect(created!.orgId).toBe('org_1');
    // The pre-existing other-org row is untouched.
    expect(store.projects.find((p) => p.orgId === 'org_other')?.id).toBe('prj_pre');
  });
});

describe('GET /v1/samples', () => {
  it('lists every registered sample with its annotations', async () => {
    const { app } = await build({ projects: [] }, { scopes: ['read'] });
    const res = await app.inject({ method: 'GET', url: '/v1/samples' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ id: string; annotations: { tryThis: string[] } }> };
    expect(body.data.map((s) => s.id)).toEqual(SAMPLES.map((s) => s.id));
    for (const entry of body.data) {
      expect(entry.annotations.tryThis.length).toBeGreaterThan(0);
    }
  });
});
