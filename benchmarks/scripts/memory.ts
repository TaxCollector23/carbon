/**
 * memory.ts
 *
 * Boots the runtime, POSTs 1,000 pet resources with deterministic payloads,
 * and reports RSS delta. Run via `node --max-old-space-size=512` (wired up in
 * package.json) so growth is measured against a bounded heap.
 *
 * The number this prints IS the runtime + state engine's memory footprint
 * for 1,000 rows including Fastify request/response overhead — no fudging.
 */
import { performance } from 'node:perf_hooks';
import { BehaviorGraphBuilder } from '@carbon/graph';
import { createRuntime } from '@carbon/runtime';
import { InMemoryStateEngine } from '@carbon/state';
import { petsIr, round, seededRandom } from './lib/ir.js';

const COUNT = Number(process.env.CARBON_BENCH_ROWS ?? 1000);
const SEED = 0xdecafbad;

async function main() {
  const ir = petsIr();
  const graph = new BehaviorGraphBuilder().build(ir);
  const state = new InMemoryStateEngine();
  const runtime = await createRuntime({ ir, graph, state });
  const url = await runtime.listen(0);
  const rand = seededRandom(SEED);

  try {
    if (global.gc) global.gc();
    const before = process.memoryUsage();
    const start = performance.now();

    for (let i = 0; i < COUNT; i += 1) {
      const body = {
        name: `pet-${i}`,
        weight: round(rand() * 100),
        tags: [`t${Math.floor(rand() * 20)}`, `t${Math.floor(rand() * 20)}`],
        note: `deterministic note ${i}`,
      };
      const res = await fetch(`${url}/pets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status !== 201) {
        throw new Error(`POST /pets returned ${res.status} at row ${i}`);
      }
      await res.arrayBuffer();
    }

    const elapsedMs = performance.now() - start;
    if (global.gc) global.gc();
    const after = process.memoryUsage();

    const output = {
      tool: 'carbon',
      demo: 'memory',
      generatedAt: new Date().toISOString(),
      node: process.version,
      seed: SEED,
      rowsCreated: COUNT,
      elapsedMs: round(elapsedMs),
      before: mapMem(before),
      after: mapMem(after),
      deltaBytes: {
        rss: after.rss - before.rss,
        heapUsed: after.heapUsed - before.heapUsed,
        external: after.external - before.external,
      },
      perRowBytes: {
        rss: Math.round((after.rss - before.rss) / COUNT),
        heapUsed: Math.round((after.heapUsed - before.heapUsed) / COUNT),
      },
    };
    console.log(JSON.stringify(output, null, 2));
  } finally {
    await runtime.close();
  }
}

function mapMem(m: NodeJS.MemoryUsage) {
  return { rss: m.rss, heapTotal: m.heapTotal, heapUsed: m.heapUsed, external: m.external };
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
