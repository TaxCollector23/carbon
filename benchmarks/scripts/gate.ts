/**
 * gate.ts
 *
 * Reads `benchmarks/results/latest.json` (produced by `pnpm bench`) and fails
 * when any *correctness-critical* metric crosses its floor/ceiling. These are
 * sanity thresholds, not tight regression budgets: CI hardware varies wildly,
 * so we only refuse to ship when something is an order of magnitude off —
 * e.g. a snapshot restore that became O(n²), a throughput collapse, or the
 * stateful-consistency demo no longer passing.
 *
 * Exit codes: 0 = pass, 1 = one or more thresholds violated, 2 = unreadable
 * results (the bench run itself failed).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const resultsFile = resolve(here, '..', 'results', 'latest.json');

interface SnapshotResult {
  totalRows?: number;
  restoreMs?: { p50?: number; p95?: number };
}
interface ThroughputResult {
  requests?: { average?: number; total?: number };
  non2xx?: number;
}
interface MemoryResult {
  perRowBytes?: { rss?: number; heapUsed?: number };
}
interface ColdStartResult {
  coldStartMs?: { p50?: number };
}
interface StatefulResult {
  passed?: boolean;
  stepCount?: number;
}
interface Results {
  results?: {
    stateful?: StatefulResult | { failed?: boolean };
    snapshot?: SnapshotResult | { failed?: boolean };
    throughput?: ThroughputResult | { failed?: boolean };
    memory?: MemoryResult | { failed?: boolean };
    coldStart?: ColdStartResult | { skipped?: boolean; failed?: boolean };
  };
}

/**
 * Generous CI-safe budgets. Local baselines are far inside these bounds:
 * throughput ~40k req/s (floor 1k), snapshot p95 ~14ms (ceiling 1s),
 * per-row RSS ~240KB (ceiling 2MB), cold start ~165ms (ceiling 10s).
 */
const THRESHOLDS = {
  statefulStepCount: 6,
  snapshotP95Ms: 1_000,
  throughputReqPerSec: 1_000,
  throughputNon2xxPct: 1, // percent
  memoryPerRowRssBytes: 2_000_000,
  coldStartP50Ms: 10_000,
} as const;

interface Violation {
  metric: string;
  got: string;
  budget: string;
}

function failed(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as { failed?: boolean }).failed;
}

function main(): number {
  let raw: string;
  try {
    raw = readFileSync(resultsFile, 'utf8');
  } catch (err) {
    console.error(`[gate] cannot read ${resultsFile}: ${(err as Error).message}`);
    return 2;
  }
  const results = JSON.parse(raw) as Results;
  const r = results.results ?? {};
  const violations: Violation[] = [];

  // 1. Stateful consistency — the product's core promise. Hard gate.
  if (failed(r.stateful)) {
    violations.push({ metric: 'stateful', got: 'bench failed', budget: 'must pass' });
  } else {
    const s = r.stateful as StatefulResult | undefined;
    if (!s?.passed) {
      violations.push({ metric: 'stateful', got: 'not passed', budget: 'passed=true' });
    } else if ((s.stepCount ?? 0) < THRESHOLDS.statefulStepCount) {
      violations.push({
        metric: 'stateful.stepCount',
        got: String(s.stepCount),
        budget: `>= ${THRESHOLDS.statefulStepCount}`,
      });
    }
  }

  // 2. Snapshot restore latency ceiling.
  if (failed(r.snapshot)) {
    violations.push({ metric: 'snapshot', got: 'bench failed', budget: 'must pass' });
  } else {
    const s = r.snapshot as SnapshotResult | undefined;
    const p95 = s?.restoreMs?.p95;
    if (p95 !== undefined && p95 > THRESHOLDS.snapshotP95Ms) {
      violations.push({
        metric: 'snapshot.restoreMs.p95',
        got: `${p95.toFixed(2)} ms`,
        budget: `<= ${THRESHOLDS.snapshotP95Ms} ms`,
      });
    }
  }

  // 3. Throughput floor + error ceiling.
  if (failed(r.throughput)) {
    violations.push({ metric: 'throughput', got: 'bench failed', budget: 'must pass' });
  } else {
    const t = r.throughput as ThroughputResult | undefined;
    const rps = t?.requests?.average;
    if (rps !== undefined && rps < THRESHOLDS.throughputReqPerSec) {
      violations.push({
        metric: 'throughput.requests.average',
        got: `${rps.toFixed(0)} req/s`,
        budget: `>= ${THRESHOLDS.throughputReqPerSec} req/s`,
      });
    }
    const total = t?.requests?.total ?? 0;
    const non2xx = t?.non2xx ?? 0;
    if (total > 0) {
      const pct = (non2xx / total) * 100;
      if (pct > THRESHOLDS.throughputNon2xxPct) {
        violations.push({
          metric: 'throughput.non2xx',
          got: `${pct.toFixed(2)}%`,
          budget: `<= ${THRESHOLDS.throughputNon2xxPct}%`,
        });
      }
    }
  }

  // 4. Memory per-row ceiling.
  if (!failed(r.memory)) {
    const m = r.memory as MemoryResult | undefined;
    const perRow = m?.perRowBytes?.rss;
    if (perRow !== undefined && perRow > THRESHOLDS.memoryPerRowRssBytes) {
      violations.push({
        metric: 'memory.perRowBytes.rss',
        got: `${(perRow / 1024).toFixed(0)} KB`,
        budget: `<= ${(THRESHOLDS.memoryPerRowRssBytes / 1024).toFixed(0)} KB`,
      });
    }
  }

  // 5. Cold start ceiling (skipped when the CLI wasn't built).
  const cold = r.coldStart;
  if (cold && !failed(cold) && !(cold as ColdStartResult & { skipped?: boolean }).skipped) {
    const p50 = (cold as ColdStartResult).coldStartMs?.p50;
    if (p50 !== undefined && p50 > THRESHOLDS.coldStartP50Ms) {
      violations.push({
        metric: 'coldStart.p50',
        got: `${p50.toFixed(0)} ms`,
        budget: `<= ${THRESHOLDS.coldStartP50Ms} ms`,
      });
    }
  }

  if (violations.length > 0) {
    console.error('[gate] performance thresholds violated:');
    for (const v of violations) {
      console.error(`  - ${v.metric}: got ${v.got}, budget ${v.budget}`);
    }
    return 1;
  }

  // eslint-disable-next-line no-console
  console.log('[gate] all performance thresholds passed');
  return 0;
}

process.exit(main());
