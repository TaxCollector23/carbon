/**
 * runtime-benchmark.ts
 *
 * Boots the *actual* Carbon runtime in-process and measures it over a real
 * HTTP loopback socket — the same two demonstrations the committed benchmark
 * suite gates on (`benchmarks/scripts/stateful-consistency.ts` and
 * `benchmarks/scripts/throughput.ts`):
 *
 *   1. Stateful consistency — CREATE → READ → PATCH → READ → DELETE → 404,
 *      asserting every step so the result is a pass/fail, not a number.
 *   2. Throughput burst — N concurrent GETs against the same runtime for a
 *      bounded window, reporting req/s and latency percentiles.
 *
 * The point of running this *in the API* (rather than only in CI) is that a
 * visitor to the marketing site can ask for live numbers from the shipped
 * runtime instead of a screenshot of the last CI run. The route is public and
 * rate-limited; the whole benchmark is bounded (~2–4s) and cached briefly so
 * a burst of visitors shares one measurement instead of each booting a
 * runtime.
 *
 * This is a harness over the product, not a product path: no state is
 * persisted, no emulator is registered, and the runtime is closed in a
 * `finally` on every path.
 */
import { performance } from 'node:perf_hooks';
import { BehaviorGraphBuilder } from '@carbon/graph';
import { createRuntime } from '@carbon/runtime';
import { InMemoryStateEngine } from '@carbon/state';
import { createDefaultParserRegistry, createParserContext } from '@carbon/parser';
import { NoopLogger, type Logger } from '@carbon/core';
import type { IntermediateRepresentation, ResourceId } from '@carbon/types';

export interface BenchmarkStep {
  step: string;
  method: string;
  path: string;
  status: number;
  expected: string;
  ok: boolean;
  elapsedMs: number;
}

export interface StatefulBenchmark {
  passed: boolean;
  stepCount: number;
  steps: BenchmarkStep[];
  elapsedMs: number;
}

export interface ThroughputBenchmark {
  totalRequests: number;
  requestsPerSec: number;
  concurrency: number;
  durationMs: number;
  non2xx: number;
  latencyMs: { min: number; p50: number; p95: number; p99: number; max: number };
}

export interface RuntimeBenchmarkResult {
  measuredAt: string;
  node: string;
  spec: string;
  stateful: StatefulBenchmark;
  throughput: ThroughputBenchmark;
  totalElapsedMs: number;
}

export interface RunRuntimeBenchmarkOptions {
  /** Parsed spec (JSON) to compile — typically `loadSampleSpec('petstore')`. */
  readonly spec: unknown;
  readonly logger?: Logger;
  /** Wall-clock budget for the throughput burst. Default 2000ms. */
  readonly burstDurationMs?: number;
  /** Concurrent in-flight GETs during the burst. Default 32. */
  readonly burstConcurrency?: number;
  /** Rows to seed before the burst so GET /pets returns a real list. Default 10. */
  readonly seedRows?: number;
}

const PETS_RESOURCE = 'pet' as ResourceId;

export async function runRuntimeBenchmark(
  options: RunRuntimeBenchmarkOptions,
): Promise<RuntimeBenchmarkResult> {
  const logger = options.logger ?? NoopLogger;
  const burstDurationMs = options.burstDurationMs ?? 2000;
  const burstConcurrency = options.burstConcurrency ?? 32;
  const seedRows = options.seedRows ?? 10;
  const started = performance.now();

  // 1. Compile the spec through the same path the CLI uses: parser registry →
  //    IR → behavior graph. This exercises the real adapters, not a hand-built
  //    fixture IR, so a regression in OpenAPI parsing fails the benchmark too.
  const parsers = createDefaultParserRegistry();
  const ir: IntermediateRepresentation = await parsers.parse(
    { kind: 'json', content: options.spec },
    createParserContext(logger, 'petstore.openapi.json'),
  );
  const graph = new BehaviorGraphBuilder().build(ir);
  const state = new InMemoryStateEngine();
  const runtime = await createRuntime({ ir, graph, state, logger });
  const url = await runtime.listen(0);

  try {
    for (let i = 0; i < seedRows; i += 1) {
      await state.create(PETS_RESOURCE, { id: `seed-${i}`, name: `pet ${i}` });
    }

    const stateful = await runStatefulCheck(url);
    const throughput = await runThroughputBurst(url, {
      durationMs: burstDurationMs,
      concurrency: burstConcurrency,
    });

    return {
      measuredAt: new Date().toISOString(),
      node: process.version,
      spec: ir.api.name,
      stateful,
      throughput,
      totalElapsedMs: round(performance.now() - started),
    };
  } finally {
    await runtime.close();
  }
}

/**
 * The six-step demonstration of the product's core promise: writes change
 * future reads. Every step carries an assertion string so a failure tells you
 * *which* contract broke, matching the committed CI bench.
 */
async function runStatefulCheck(url: string): Promise<StatefulBenchmark> {
  const steps: BenchmarkStep[] = [];
  let createdId: string | null = null;

  const push = (
    step: string,
    method: string,
    path: string,
    status: number,
    expected: string,
    ok: boolean,
    elapsedMs: number,
  ) => {
    steps.push({ step, method, path, status, expected, ok, elapsedMs: round(elapsedMs) });
  };

  // 1. CREATE
  {
    const body = { name: 'Fido', species: 'dog' };
    const { status, json, elapsedMs } = await http(url, 'POST', '/pets', body);
    const id = (json as { id?: string } | null)?.id ?? null;
    createdId = id;
    push(
      'create',
      'POST',
      '/pets',
      status,
      'status=201 and response.id defined and response.name="Fido"',
      status === 201 && typeof id === 'string' && (json as { name?: string } | null)?.name === 'Fido',
      elapsedMs,
    );
  }
  if (!createdId) {
    return { passed: false, stepCount: steps.length, steps, elapsedMs: 0 };
  }

  // 2. READ after create
  {
    const path = `/pets/${createdId}`;
    const { status, json, elapsedMs } = await http(url, 'GET', path);
    push(
      'read-after-create',
      'GET',
      path,
      status,
      'status=200 and response.name="Fido" (state persisted)',
      status === 200 && (json as { name?: string } | null)?.name === 'Fido',
      elapsedMs,
    );
  }

  // 3. PATCH
  {
    const path = `/pets/${createdId}`;
    const body = { name: 'Fido II', tricks: ['sit', 'roll'] };
    const { status, json, elapsedMs } = await http(url, 'PATCH', path, body);
    push(
      'update',
      'PATCH',
      path,
      status,
      'status=200 and response.name="Fido II" (patch merged)',
      status === 200 && (json as { name?: string } | null)?.name === 'Fido II',
      elapsedMs,
    );
  }

  // 4. READ after update — patch must have merged, not replaced
  {
    const path = `/pets/${createdId}`;
    const { status, json, elapsedMs } = await http(url, 'GET', path);
    const j = json as { name?: string; species?: string; tricks?: unknown[] } | null;
    push(
      'read-after-update',
      'GET',
      path,
      status,
      'status=200, patch persisted, previous fields preserved (species=dog)',
      status === 200 &&
        j?.name === 'Fido II' &&
        j?.species === 'dog' &&
        Array.isArray(j?.tricks) &&
        j?.tricks.length === 2,
      elapsedMs,
    );
  }

  // 5. DELETE
  {
    const path = `/pets/${createdId}`;
    const { status, json, elapsedMs } = await http(url, 'DELETE', path);
    push('delete', 'DELETE', path, status, 'status=204', status === 204, elapsedMs);
  }

  // 6. READ after delete — must 404
  {
    const path = `/pets/${createdId}`;
    const { status, json, elapsedMs } = await http(url, 'GET', path);
    push('read-after-delete', 'GET', path, status, 'status=404 (delete honored)', status === 404, elapsedMs);
  }

  const allOk = steps.every((s) => s.ok);
  return { passed: allOk, stepCount: steps.length, steps, elapsedMs: 0 };
}

/**
 * A bounded worker-pool burst against GET /pets. Pure fetch loop — no extra
 * dependencies, and the concurrency cap keeps a single request from
 * saturating the API process.
 */
async function runThroughputBurst(
  url: string,
  options: { durationMs: number; concurrency: number },
): Promise<ThroughputBenchmark> {
  const latencies: number[] = [];
  let totalRequests = 0;
  let non2xx = 0;
  let stop = false;
  const deadline = Date.now() + options.durationMs;

  const worker = async () => {
    while (!stop && Date.now() < deadline) {
      const t0 = performance.now();
      try {
        const res = await fetch(`${url}/pets`);
        if (res.status !== 200) non2xx += 1;
      } catch {
        non2xx += 1;
      }
      latencies.push(performance.now() - t0);
      totalRequests += 1;
    }
  };

  const workers = Array.from({ length: Math.max(1, options.concurrency) }, () => worker());
  await Promise.all(workers);
  stop = true;

  const sorted = [...latencies].sort((a, b) => a - b);
  const elapsed = options.durationMs;
  return {
    totalRequests,
    requestsPerSec: round(totalRequests / (elapsed / 1000), 1),
    concurrency: options.concurrency,
    durationMs: elapsed,
    non2xx,
    latencyMs: {
      min: round(sorted[0] ?? 0),
      p50: round(percentile(sorted, 0.5)),
      p95: round(percentile(sorted, 0.95)),
      p99: round(percentile(sorted, 0.99)),
      max: round(sorted.at(-1) ?? 0),
    },
  };
}

async function http(
  baseUrl: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown; elapsedMs: number }> {
  const start = performance.now();
  const res = await fetch(baseUrl + path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const elapsedMs = performance.now() - start;
  let json: unknown = null;
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }
  return { status: res.status, json, elapsedMs };
}

function percentile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(sortedAsc.length * p));
  return sortedAsc[idx] ?? 0;
}

function round(n: number, digits = 3): number {
  const m = 10 ** digits;
  return Math.round(n * m) / m;
}
