import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { isCarbonError, NoopLogger } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import type { AppContext } from '../context.js';
import { _resetSampleSpecCache, registerSampleRoutes } from './samples.js';
import { registerBenchmarkRoutes } from './benchmark.js';

function makeCtx(): AppContext {
  return {
    logger: NoopLogger,
    db: {} as AppContext['db'],
    storage: new MemoryStorage(),
    ingestion: {} as AppContext['ingestion'],
    emulators: {} as AppContext['emulators'],
  };
}

async function build(
  ctx: AppContext,
  options: { burstDurationMs?: number; burstConcurrency?: number; cacheMs?: number } = {},
): Promise<FastifyInstance> {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      reply.status(400).send({ error: { code: 'CARBON_INVALID_INPUT', message: err.message } });
      return;
    }
    if (isCarbonError(err)) {
      const status = err.code === 'CARBON_RUNTIME_UNAVAILABLE' ? 503 : 500;
      reply.status(status).send({ error: { code: err.code, message: err.message } });
      return;
    }
    reply.status(500).send({ error: { code: 'CARBON_INTERNAL', message: String(err) } });
  });
  await registerBenchmarkRoutes(app, ctx, {
    burstDurationMs: options.burstDurationMs ?? 150,
    burstConcurrency: options.burstConcurrency ?? 8,
    cacheMs: options.cacheMs ?? 60_000,
  });
  await app.ready();
  return app;
}

interface BenchmarkBody {
  measuredAt: string;
  node: string;
  spec: string;
  cached: boolean;
  stateful: { passed: boolean; stepCount: number; steps: Array<{ step: string; ok: boolean }> };
  throughput: {
    totalRequests: number;
    requestsPerSec: number;
    concurrency: number;
    durationMs: number;
    non2xx: number;
    latencyMs: { min: number; p50: number; p95: number; p99: number; max: number };
  };
  totalElapsedMs: number;
}

beforeEach(() => {
  _resetSampleSpecCache();
  delete process.env.CARBON_SAMPLES_DIR;
});

afterEach(() => {
  delete process.env.CARBON_SAMPLES_DIR;
});

describe('GET /v1/benchmark', () => {
  it('boots the real runtime and returns a live, passing measurement', async () => {
    const app = await build(makeCtx());
    const res = await app.inject({ method: 'GET', url: '/v1/benchmark' });
    expect(res.statusCode).toBe(200);

    const body = res.json() as BenchmarkBody;
    expect(body.cached).toBe(false);
    expect(body.spec).toBe('Petstore Bench');
    expect(body.node).toMatch(/^v/);
    expect(Number.isNaN(Date.parse(body.measuredAt))).toBe(false);

    // The product's core promise held: all six stateful steps passed.
    expect(body.stateful.passed).toBe(true);
    expect(body.stateful.stepCount).toBe(6);
    expect(body.stateful.steps.map((s) => s.step)).toEqual([
      'create',
      'read-after-create',
      'update',
      'read-after-update',
      'delete',
      'read-after-delete',
    ]);
    expect(body.stateful.steps.every((s) => s.ok)).toBe(true);

    // A bounded burst actually ran and returned sane numbers.
    expect(body.throughput.totalRequests).toBeGreaterThan(0);
    expect(body.throughput.requestsPerSec).toBeGreaterThan(0);
    expect(body.throughput.concurrency).toBe(8);
    expect(body.throughput.non2xx).toBe(0);
    const { latencyMs } = body.throughput;
    expect(latencyMs.min).toBeGreaterThanOrEqual(0);
    expect(latencyMs.max).toBeGreaterThanOrEqual(latencyMs.p50);
    expect(latencyMs.p50).toBeGreaterThanOrEqual(latencyMs.min);
  });

  it('serves the second request from cache without re-measuring', async () => {
    const app = await build(makeCtx(), { cacheMs: 60_000 });
    const first = (await app.inject({ method: 'GET', url: '/v1/benchmark' })).json() as BenchmarkBody;
    const second = (
      await app.inject({ method: 'GET', url: '/v1/benchmark' })
    ).json() as BenchmarkBody;

    expect(second.cached).toBe(true);
    expect(second.measuredAt).toBe(first.measuredAt);
    expect(second.stateful.stepCount).toBe(first.stateful.stepCount);
  });

  it('returns 503 when the benchmark fixture cannot be loaded', async () => {
    process.env.CARBON_SAMPLES_DIR = '/nonexistent/carbon-fixtures';
    const app = await build(makeCtx());
    const res = await app.inject({ method: 'GET', url: '/v1/benchmark' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('CARBON_RUNTIME_UNAVAILABLE');
  });
});

// Keep the samples module linked in test coverage (its fixture helper is what
// the benchmark route depends on) — registering routes here is harmless and
// mirrors the server's composition.
describe('registerSampleRoutes (shared fixture dependency)', () => {
  it('lists samples without error', async () => {
    const app = Fastify();
    app.setErrorHandler((err, _req, reply) => {
      if (isCarbonError(err)) {
        reply.status(500).send({ error: { code: err.code, message: err.message } });
        return;
      }
      reply.status(500).send({ error: { code: 'CARBON_INTERNAL', message: String(err) } });
    });
    await registerSampleRoutes(app, makeCtx());
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/v1/samples' });
    expect(res.statusCode).toBe(200);
  });
});
