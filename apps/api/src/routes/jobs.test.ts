import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { CarbonError, isCarbonError, NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import type { JobRecord, JobService } from '../services/jobs.js';
import { registerJobRoutes } from './jobs.js';

function makeJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: 'job_a',
    kind: 'ingest',
    orgId: 'org_1',
    status: 'queued',
    createdAt: 1_000,
    updatedAt: 1_000,
    attempts: 0,
    maxAttempts: 5,
    nextAttemptAt: null,
    deadLetter: false,
    ...overrides,
  };
}

function makeCtx(jobs?: JobService): AppContext {
  return {
    logger: NoopLogger,
    db: {} as AppContext['db'],
    storage: new MemoryStorage(),
    ingestion: {} as AppContext['ingestion'],
    emulators: {} as AppContext['emulators'],
    jobs,
  };
}

async function build(ctx: AppContext, scopes: readonly string[] = ['admin']) {
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
          : err.code === 'CARBON_INVALID_INPUT'
            ? 400
            : err.code === 'CARBON_STATE_VIOLATION'
              ? 409
              : err.code === 'CARBON_FORBIDDEN'
                ? 403
                : 500;
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
      scopes: scopes as ('read' | 'write' | 'admin')[],
      projectIds: null,
    } as AuthenticatedRequest['apiKey'];
  });
  await registerJobRoutes(app, ctx);
  await app.ready();
  return app;
}

describe('GET /v1/jobs/:id', () => {
  it('returns the job when the caller owns it', async () => {
    const jobs = {
      get: vi.fn(async () => makeJob({ status: 'succeeded' })),
    } as unknown as JobService;
    const app = await build(makeCtx(jobs));
    const res = await app.inject({ method: 'GET', url: '/v1/jobs/job_a' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 'job_a', status: 'succeeded' });
    // orgId is stripped from the public response
    expect(res.json().orgId).toBeUndefined();
  });

  it('returns 404 for a job on a different org', async () => {
    const jobs = {
      get: vi.fn(async () => makeJob({ orgId: 'org_other' })),
    } as unknown as JobService;
    const app = await build(makeCtx(jobs));
    const res = await app.inject({ method: 'GET', url: '/v1/jobs/job_a' });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /v1/jobs', () => {
  it('lists jobs scoped to the caller org', async () => {
    const jobs = {
      list: vi.fn(async () => ({
        data: [
          makeJob({ id: 'job_a', status: 'running' }),
          makeJob({ id: 'job_b', status: 'failed', attempts: 2, nextAttemptAt: 5_000 }),
        ],
        nextCursor: null,
        hasMore: false,
      })),
    } as unknown as JobService;
    const app = await build(makeCtx(jobs));
    const res = await app.inject({ method: 'GET', url: '/v1/jobs?limit=10' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(2);
    expect(body.data[0].id).toBe('job_a');
    expect(body.data[0].orgId).toBeUndefined();
    expect(body.hasMore).toBe(false);
    expect(jobs.list).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org_1', limit: 10 }));
  });

  it('passes the status filter through', async () => {
    const jobs = {
      list: vi.fn(async () => ({ data: [], nextCursor: null, hasMore: false })),
    } as unknown as JobService;
    const app = await build(makeCtx(jobs));
    const res = await app.inject({ method: 'GET', url: '/v1/jobs?status=deadLetter' });
    expect(res.statusCode).toBe(200);
    expect(jobs.list).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'deadLetter', orgId: 'org_1' }),
    );
  });

  it('returns an empty page when the jobs service is not configured', async () => {
    const app = await build(makeCtx(undefined));
    const res = await app.inject({ method: 'GET', url: '/v1/jobs' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: [], nextCursor: null, hasMore: false });
  });
});

describe('POST /v1/jobs/:id/retry', () => {
  it('re-queues a failed job', async () => {
    const jobs = {
      get: vi.fn(async () => makeJob({ status: 'failed', attempts: 1 })),
      retry: vi.fn(async () => makeJob({ status: 'queued', attempts: 1 })),
    } as unknown as JobService;
    const app = await build(makeCtx(jobs));
    const res = await app.inject({ method: 'POST', url: '/v1/jobs/job_a/retry' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 'job_a', status: 'queued' });
    expect(jobs.retry).toHaveBeenCalledWith('job_a');
  });

  it('re-enqueues a stored ingest payload when a queue is configured', async () => {
    const payload = {
      statusJobId: 'job_a',
      orgId: 'org_1',
      projectSlug: 'org_1/acme',
      publicSlug: 'acme',
      source: { kind: 'json', content: { openapi: '3.0.0' } },
      enrich: false,
    };
    const jobs = {
      get: vi.fn(async () => makeJob({ status: 'failed', attempts: 1, meta: { payload } })),
      retry: vi.fn(async () => makeJob({ status: 'queued', attempts: 1, meta: { payload } })),
    } as unknown as JobService;
    const add = vi.fn(async () => ({ id: 'manual_retry' }));
    const app = await build({
      ...makeCtx(jobs),
      ingestionQueue: { add } as unknown as AppContext['ingestionQueue'],
    });
    const res = await app.inject({ method: 'POST', url: '/v1/jobs/job_a/retry' });
    expect(res.statusCode).toBe(200);
    expect(add).toHaveBeenCalledWith(
      'ingest',
      payload,
      expect.objectContaining({ jobId: expect.stringContaining('job_a:manual:') }),
    );
    expect(res.json().meta).toBeUndefined();
  });

  it('returns 404 on cross-org retry attempts', async () => {
    const jobs = {
      get: vi.fn(async () => makeJob({ orgId: 'org_other' })),
      retry: vi.fn(),
    } as unknown as JobService;
    const app = await build(makeCtx(jobs));
    const res = await app.inject({ method: 'POST', url: '/v1/jobs/job_a/retry' });
    expect(res.statusCode).toBe(404);
    expect(jobs.retry).not.toHaveBeenCalled();
  });

  it('surfaces CARBON_STATE_VIOLATION as 409 for dead-lettered jobs', async () => {
    const jobs = {
      get: vi.fn(async () => makeJob({ status: 'failed', deadLetter: true, attempts: 5 })),
      retry: vi.fn(async () => {
        throw new CarbonError({
          code: 'CARBON_STATE_VIOLATION',
          message: 'Job is dead-lettered — retries exhausted',
          expose: true,
        });
      }),
    } as unknown as JobService;
    const app = await build(makeCtx(jobs));
    const res = await app.inject({ method: 'POST', url: '/v1/jobs/job_a/retry' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CARBON_STATE_VIOLATION');
  });
});
