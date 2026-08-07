import { performance } from 'node:perf_hooks';
import { BehaviorGraphBuilder } from '@carbon/graph';
import { createRuntime, type Runtime } from '@carbon/runtime';
import { InMemoryStateEngine } from '@carbon/state';
import type { EndpointId, IntermediateRepresentation, ResourceId } from '@carbon/types';

const customer = 'customer' as ResourceId;
const iterations = numberFromEnv('CARBON_BENCH_ITERATIONS', 1_000);
const warmup = numberFromEnv('CARBON_BENCH_WARMUP', 100);

async function main() {
  const runtime = await boot();
  try {
    await runWarmup(runtime);
    const list = await measure('GET /customers', iterations, () =>
      runtime.app.inject({ method: 'GET', url: '/customers' }),
    );
    const create = await measure('POST /customers', iterations, () =>
      runtime.app.inject({
        method: 'POST',
        url: '/customers',
        payload: { name: 'Benchmark user' },
      }),
    );
    const snapshot = await measure('snapshot + restore', Math.max(25, Math.floor(iterations / 20)), async () => {
      const snap = await runtime.app.inject({ method: 'POST', url: '/__carbon/state/snapshot' });
      await runtime.app.inject({ method: 'POST', url: '/__carbon/state/reset' });
      return runtime.app.inject({
        method: 'POST',
        url: '/__carbon/state/restore',
        payload: snap.json(),
      });
    });

    console.log(
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          node: process.version,
          iterations,
          warmup,
          requestPath: {
            upstreamCallsAfterImport: 0,
            aiCallsAfterImport: 0,
          },
          metrics: [list, create, snapshot],
        },
        null,
        2,
      ),
    );
  } finally {
    await runtime.close();
  }
}

async function boot(): Promise<Runtime> {
  const ir = fixtureIr();
  const graph = new BehaviorGraphBuilder().build(ir);
  const state = new InMemoryStateEngine();
  return createRuntime({ ir, graph, state });
}

async function runWarmup(runtime: Runtime): Promise<void> {
  for (let i = 0; i < warmup; i += 1) {
    await runtime.app.inject({ method: 'GET', url: '/customers' });
  }
}

async function measure(
  name: string,
  count: number,
  fn: () => Promise<{ statusCode: number }>,
): Promise<Record<string, number | string>> {
  const samples: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const start = performance.now();
    const res = await fn();
    const elapsed = performance.now() - start;
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`${name} returned ${res.statusCode}`);
    }
    samples.push(elapsed);
  }
  samples.sort((a, b) => a - b);
  return {
    name,
    count,
    minMs: round(samples[0] ?? 0),
    p50Ms: round(percentile(samples, 0.5)),
    p95Ms: round(percentile(samples, 0.95)),
    maxMs: round(samples[samples.length - 1] ?? 0),
  };
}

function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return 0;
  const index = Math.min(samples.length - 1, Math.floor(samples.length * p));
  return samples[index] ?? 0;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function fixtureIr(): IntermediateRepresentation {
  return {
    version: 1,
    api: { name: 'benchmark', version: '0', source: { kind: 'openapi', ingestedAt: 0 } },
    servers: [],
    auth: [],
    resources: [{ id: customer, name: 'Customer', primaryKey: 'id', schema: { kind: 'unknown' } }],
    endpoints: [
      {
        id: 'GET:/customers' as EndpointId,
        method: 'GET',
        path: '/customers',
        operation: 'list',
        resource: customer,
        params: [],
        requestBody: null,
        responses: [],
        auth: [],
        meta: {},
      },
      {
        id: 'POST:/customers' as EndpointId,
        method: 'POST',
        path: '/customers',
        operation: 'create',
        resource: customer,
        params: [],
        requestBody: null,
        responses: [],
        auth: [],
        meta: {},
      },
    ],
    relationships: [],
    examples: [],
    meta: {},
  };
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
