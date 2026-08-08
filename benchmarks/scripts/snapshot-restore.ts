/**
 * snapshot-restore.ts
 *
 * Populates the in-memory state engine with 10,000 rows spread across
 * 5 resources, serializes the snapshot to disk, wipes state, restores from
 * disk, and measures restore latency across 20 iterations.
 *
 * Uses @carbon/state directly (no HTTP) — this is a pure state-engine bench.
 */
import { performance } from 'node:perf_hooks';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryStateEngine, type StateSnapshot } from '@carbon/state';
import type { ResourceId } from '@carbon/types';
import { percentile, round, seededRandom } from './lib/ir.js';

const RESOURCES = ['pet', 'owner', 'clinic', 'visit', 'invoice'] as const;
const TOTAL_ROWS = 10_000;
const ITERATIONS = 20;
const SEED = 0xc0ffee;

async function main() {
  const engine = new InMemoryStateEngine(() => 1_700_000_000_000);
  const rand = seededRandom(SEED);
  const rowsPerResource = Math.floor(TOTAL_ROWS / RESOURCES.length);

  // Deterministic population.
  for (const r of RESOURCES) {
    const resource = r as ResourceId;
    for (let i = 0; i < rowsPerResource; i += 1) {
      await engine.create(resource, {
        id: `${r}-${i.toString(36).padStart(6, '0')}`,
        name: `${r} ${i}`,
        score: Math.floor(rand() * 1_000_000),
        active: rand() > 0.5,
        tags: [r, `t${i % 17}`],
      });
    }
  }

  const snapshot = await engine.snapshot();
  const dir = mkdtempSync(join(tmpdir(), 'carbon-snap-'));
  const file = join(dir, 'snapshot.json');
  const serialized = JSON.stringify(snapshot);
  writeFileSync(file, serialized);
  const sizeBytes = Buffer.byteLength(serialized);

  try {
    const restoreSamples: number[] = [];
    for (let i = 0; i < ITERATIONS; i += 1) {
      await engine.reset();
      // Re-read from disk each iteration so the bench includes I/O + parse + apply.
      const raw = readFileSync(file, 'utf8');
      const start = performance.now();
      const snap = JSON.parse(raw) as StateSnapshot;
      await engine.restore(snap);
      restoreSamples.push(performance.now() - start);
    }

    restoreSamples.sort((a, b) => a - b);
    const output = {
      tool: 'carbon',
      demo: 'snapshot-restore',
      generatedAt: new Date().toISOString(),
      node: process.version,
      seed: SEED,
      resources: RESOURCES.length,
      rowsPerResource,
      totalRows: rowsPerResource * RESOURCES.length,
      snapshotBytes: sizeBytes,
      iterations: ITERATIONS,
      restoreMs: {
        min: round(restoreSamples[0] ?? 0),
        p50: round(percentile(restoreSamples, 0.5)),
        p95: round(percentile(restoreSamples, 0.95)),
        max: round(restoreSamples[restoreSamples.length - 1] ?? 0),
      },
      samples: restoreSamples.map((s) => round(s)),
    };
    console.log(JSON.stringify(output, null, 2));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
