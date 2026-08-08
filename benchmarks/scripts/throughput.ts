/**
 * throughput.ts
 *
 * Real-socket throughput: boot the Carbon runtime bound to a loopback TCP
 * port, seed a handful of pets, then fire 100 concurrent GETs for 30s with
 * autocannon. Prints autocannon's raw result as JSON so req/s and the full
 * latency histogram are visible.
 */
import autocannon from 'autocannon';
import { BehaviorGraphBuilder } from '@carbon/graph';
import { createRuntime } from '@carbon/runtime';
import { InMemoryStateEngine } from '@carbon/state';
import { PETS_RESOURCE, petsIr } from './lib/ir.js';

const DURATION_SECONDS = Number(process.env.CARBON_BENCH_DURATION ?? 30);
const CONNECTIONS = Number(process.env.CARBON_BENCH_CONNECTIONS ?? 100);

async function main() {
  const ir = petsIr();
  const graph = new BehaviorGraphBuilder().build(ir);
  const state = new InMemoryStateEngine();
  const runtime = await createRuntime({ ir, graph, state });
  const url = await runtime.listen(0);

  // Seed a small deterministic set so /pets returns something meaningful.
  for (let i = 0; i < 10; i += 1) {
    await state.create(PETS_RESOURCE, { id: `seed-${i}`, name: `pet ${i}` });
  }

  try {
    const result = await autocannon({
      url: `${url}/pets`,
      connections: CONNECTIONS,
      duration: DURATION_SECONDS,
      pipelining: 1,
      method: 'GET',
    });

    // Keep useful fields; drop autocannon internals that are noisy in JSON.
    const summary = {
      tool: 'carbon',
      demo: 'throughput',
      generatedAt: new Date().toISOString(),
      node: process.version,
      target: `${url}/pets`,
      connections: CONNECTIONS,
      durationSeconds: DURATION_SECONDS,
      requests: result.requests,
      latency: result.latency,
      throughput: result.throughput,
      errors: result.errors,
      timeouts: result.timeouts,
      non2xx: result.non2xx,
      '2xx': result['2xx'],
      start: result.start,
      finish: result.finish,
    };
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await runtime.close();
  }
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
