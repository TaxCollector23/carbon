import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { isCarbonError, NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import type { Queue } from 'bullmq';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import type { JobService } from '../services/jobs.js';
import { registerIngestRoutes } from './ingest.js';

interface Overrides {
  jobs?: JobService;
  ingestionQueue?: Queue;
  ingestion?: AppContext['ingestion'];
}

function makeCtx(overrides: Overrides = {}): AppContext {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: async () => [{ orgId: 'org_1', slug: 'acme' }],
  };
  return {
    logger: NoopLogger,
    db: { select: () => chain } as unknown as AppContext['db'],
    storage: new MemoryStorage(),
    ingestion:
      overrides.ingestion ??
      ({
        ingest: vi.fn(async () => ({
          irId: 'ir_1',
          graphId: 'g_1',
          ir: { api: { title: 'Acme' }, endpoints: [], resources: [] },
          warnings: [],
        })),
      } as unknown as AppContext['ingestion']),
    emulators: {} as AppContext['emulators'],
    jobs: overrides.jobs,
    ingestionQueue: overrides.ingestionQueue,
  };
}

async function build(ctx: AppContext) {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      reply.status(400).send({ error: { code: 'CARBON_INVALID_INPUT', message: err.message } });
      return;
    }
    if (isCarbonError(err)) {
      const status =
        err.code === 'CARBON_NOT_FOUND' ? 404 : err.code === 'CARBON_INVALID_INPUT' ? 400 : 500;
      reply.status(status).send({ error: { code: err.code, message: err.message } });
      return;
    }
    reply.status(500).send({
      error: { code: 'CARBON_INTERNAL', message: err instanceof Error ? err.message : 'error' },
    });
  });
  app.addHook('onRequest', async (req) => {
    (req as AuthenticatedRequest).apiKey = {
      id: 'key_1',
      orgId: 'org_1',
      prefix: 'aa11bb22cc33',
      scopes: ['read', 'write'],
      projectIds: null,
    } as AuthenticatedRequest['apiKey'];
  });
  await registerIngestRoutes(app, ctx);
  await app.ready();
  return app;
}

const asyncBody = {
  projectSlug: 'acme',
  source: { kind: 'json', content: { openapi: '3.0.0' } },
  origin: 'unit-test',
  enrich: false,
  async: true,
};

const syncBody = { ...asyncBody, async: false };

describe('POST /v1/ingest — async', () => {
  it('returns 503 CARBON_RUNTIME_UNAVAILABLE when the ingestion queue is not configured', async () => {
    const app = await build(makeCtx()); // no jobs, no queue
    const res = await app.inject({ method: 'POST', url: '/v1/ingest', payload: asyncBody });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('CARBON_RUNTIME_UNAVAILABLE');
  });

  it('returns 503 when jobs is configured but the queue is not', async () => {
    const jobs = {
      create: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
    } as unknown as JobService;
    const app = await build(makeCtx({ jobs })); // queue missing
    const res = await app.inject({ method: 'POST', url: '/v1/ingest', payload: asyncBody });
    expect(res.statusCode).toBe(503);
    expect(jobs.create).not.toHaveBeenCalled();
  });

  it('creates a status record and enqueues onto BullMQ with the storage-scoped slug', async () => {
    const jobs = {
      create: vi.fn(async (_kind: string, metaInput: (id: string) => Record<string, unknown>) => ({
        id: 'job_abc',
        kind: 'ingest',
        status: 'queued' as const,
        createdAt: 0,
        updatedAt: 0,
        attempts: 0,
        maxAttempts: 5,
        nextAttemptAt: null,
        deadLetter: false,
        meta: metaInput('job_abc'),
      })),
      setMeta: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
    } as unknown as JobService;
    const add = vi.fn(async () => ({ id: 'bull_1' }));
    const ingestionQueue = { add } as unknown as Queue;
    const ingestion = {
      ingest: vi.fn(async () => {
        throw new Error('inline path should not be exercised for async requests');
      }),
    } as unknown as AppContext['ingestion'];

    const app = await build(makeCtx({ jobs, ingestionQueue, ingestion }));
    const res = await app.inject({ method: 'POST', url: '/v1/ingest', payload: asyncBody });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ jobId: 'job_abc', status: 'queued' });
    expect(jobs.create).toHaveBeenCalledWith('ingest', expect.any(Function));
    const createCall = (jobs.create as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const metaInput = createCall[1] as (id: string) => Record<string, unknown>;
    expect(metaInput('job_abc')).toMatchObject({
      orgId: 'org_1',
      projectSlug: 'acme',
      origin: 'unit-test',
    });
    expect(add).toHaveBeenCalledTimes(1);
    const call = (add.mock.calls as unknown as unknown[][])[0]!;
    const queueJobName = call[0];
    const payload = call[1];
    expect(queueJobName).toBe('ingest');
    expect(payload).toMatchObject({
      statusJobId: 'job_abc',
      orgId: 'org_1',
      // storageSlug for authenticated org
      projectSlug: 'org_1/acme',
      publicSlug: 'acme',
      source: asyncBody.source,
      origin: 'unit-test',
      enrich: false,
    });
    expect(call[2]).toMatchObject({ jobId: 'job_abc' });
    expect(jobs.setMeta).not.toHaveBeenCalled();
    // Sync ingest must NOT be invoked on the async path.
    expect(ingestion.ingest as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it('marks the job failed and returns 503 when the queue push fails', async () => {
    const jobs = {
      create: vi.fn(async (_kind: string, metaInput: (id: string) => Record<string, unknown>) => ({
        id: 'job_abc',
        kind: 'ingest',
        status: 'queued' as const,
        createdAt: 0,
        updatedAt: 0,
        attempts: 0,
        maxAttempts: 5,
        nextAttemptAt: null,
        deadLetter: false,
        meta: metaInput('job_abc'),
      })),
      update: vi.fn(async () => ({})),
    } as unknown as JobService;
    const add = vi.fn(async () => {
      throw new Error('redis down');
    });
    const app = await build(makeCtx({ jobs, ingestionQueue: { add } as unknown as Queue }));

    const res = await app.inject({ method: 'POST', url: '/v1/ingest', payload: asyncBody });

    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('CARBON_RUNTIME_UNAVAILABLE');
    expect(jobs.update).toHaveBeenCalledWith('job_abc', {
      status: 'failed',
      error: 'Failed to enqueue ingestion job',
    });
  });
});

describe('POST /v1/ingest — sync', () => {
  it('runs inline and returns 201 with the ingestion summary (no queue involvement)', async () => {
    const add = vi.fn();
    const ingestionQueue = { add } as unknown as Queue;
    const app = await build(makeCtx({ ingestionQueue }));
    const res = await app.inject({ method: 'POST', url: '/v1/ingest', payload: syncBody });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ irId: 'ir_1', graphId: 'g_1', endpoints: 0, resources: 0 });
    expect(add).not.toHaveBeenCalled();
  });
});
