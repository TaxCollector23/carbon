import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CarbonError } from '@carbon/core';
import { zodResponse } from '../plugins/schema-helpers.js';
import type { AppContext } from '../context.js';
import { loadSampleSpec } from './samples.js';
import { runRuntimeBenchmark } from '../services/runtime-benchmark.js';

const BenchmarkStep = z.object({
  step: z.string(),
  method: z.string(),
  path: z.string(),
  status: z.number().int(),
  expected: z.string(),
  ok: z.boolean(),
  elapsedMs: z.number(),
});

const BenchmarkResponse = z.object({
  measuredAt: z.string().datetime(),
  node: z.string(),
  spec: z.string(),
  cached: z.boolean(),
  stateful: z.object({
    passed: z.boolean(),
    stepCount: z.number().int(),
    steps: z.array(BenchmarkStep),
    elapsedMs: z.number(),
  }),
  throughput: z.object({
    totalRequests: z.number().int(),
    requestsPerSec: z.number(),
    concurrency: z.number().int(),
    durationMs: z.number(),
    non2xx: z.number().int(),
    latencyMs: z.object({
      min: z.number(),
      p50: z.number(),
      p95: z.number(),
      p99: z.number(),
      max: z.number(),
    }),
  }),
  totalElapsedMs: z.number(),
});

export interface BenchmarkOptions {
  /**
   * How long a measured result stays fresh. A visitor burst on the marketing
   * site shares one runtime boot instead of each request booting its own.
   * Default 30s.
   */
  readonly cacheMs?: number;
  /** Wall-clock budget for the throughput burst. Default 2000ms. */
  readonly burstDurationMs?: number;
  /** Concurrent in-flight GETs during the burst. Default 32. */
  readonly burstConcurrency?: number;
}

/**
 * GET /v1/benchmark — live numbers from the shipped runtime.
 *
 * Public (no API key) and rate-limited per IP like `/v1/capabilities`: the
 * marketing site's "test it yourself" section asks for real measurements and
 * there is no credential a visitor could plausibly hold. The harness boots
 * the actual Carbon runtime in-process, runs the six-step stateful
 * consistency check over a real HTTP socket, then a bounded throughput burst,
 * and returns the measured result. Results are cached for `cacheMs` so the
 * cost of one measurement is amortized across the visitors who ask for it.
 */
export async function registerBenchmarkRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  options: BenchmarkOptions = {},
): Promise<void> {
  const cacheMs = options.cacheMs ?? 30_000;
  const burstDurationMs = options.burstDurationMs ?? 2000;
  const burstConcurrency = options.burstConcurrency ?? 32;

  let cached: { at: number; body: z.infer<typeof BenchmarkResponse> } | null = null;
  let inFlight: Promise<z.infer<typeof BenchmarkResponse>> | null = null;

  app.get(
    '/v1/benchmark',
    {
      schema: {
        summary: 'Measure the Carbon runtime live',
        description:
          'Public benchmark: boots the real Carbon runtime in-process, runs the six-step stateful consistency check (create → read → update → read → delete → 404) over a real HTTP socket, then a short concurrent throughput burst, and returns the measured result. Results are cached briefly.',
        response: { 200: zodResponse(BenchmarkResponse) },
      },
    },
    async () => {
      const now = Date.now();
      if (cached && now - cached.at < cacheMs) return { ...cached.body, cached: true };

      // One measurement at a time: a second caller arriving mid-benchmark
      // waits for the first instead of booting a second runtime.
      inFlight ??= measure().finally(() => {
        inFlight = null;
      });
      const body = await inFlight;
      cached = { at: Date.now(), body };
      return { ...body, cached: false };
    },
  );

  async function measure(): Promise<z.infer<typeof BenchmarkResponse>> {
    let spec: unknown;
    try {
      // The same curated fixture the samples gallery serves — no private copy.
      spec = loadSampleSpec('petstore');
    } catch (err) {
      throw new CarbonError({
        code: 'CARBON_RUNTIME_UNAVAILABLE',
        message: `Benchmark fixture unavailable: ${err instanceof Error ? err.message : String(err)}`,
        expose: true,
      });
    }

    try {
      const result = await runRuntimeBenchmark({
        spec,
        logger: ctx.logger,
        burstDurationMs,
        burstConcurrency,
      });
      return { ...result, cached: false };
    } catch (err) {
      throw new CarbonError({
        code: 'CARBON_RUNTIME_UNAVAILABLE',
        message: `Benchmark run failed: ${err instanceof Error ? err.message : String(err)}`,
        expose: true,
      });
    }
  }
}
