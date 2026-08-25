/**
 * metrics-harness.ts
 *
 * The "lightweight test with real metrics" the landing page runs entirely in
 * the visitor's browser, against the same pure state machine that backs the
 * `/try` playground (`lib/try-replica.ts`).
 *
 * Two measurements, mirroring what the committed benchmark suite gates on
 * server-side:
 *
 *   1. Stateful consistency — create → read → list → delete → 404 → restore,
 *      asserting every step so the result is a pass/fail, not a number.
 *   2. A burst of GET /pets executions with wall-clock timing, reporting
 *      executions/s and latency percentiles.
 *
 * Everything is measured with `performance.now()` at the moment the visitor
 * clicks "Run" — these are live numbers of the engine running in their
 * browser, not figures copied from a CI run. That's also the honest framing:
 * the reducer path is pure JS with no network, so it is *not* the same number
 * as the server-measured HTTP runtime — the page shows both and labels them.
 */

import {
  createInitialState,
  executeRequest,
  restoreSnapshot,
  takeSnapshot,
  type ReplicaResponse,
  type ReplicaState,
} from './try-replica';

export interface CheckStep {
  step: string;
  method: string;
  path: string;
  status: number;
  expected: string;
  ok: boolean;
  elapsedMs: number;
}

export interface StatefulResult {
  passed: boolean;
  stepCount: number;
  steps: CheckStep[];
  elapsedMs: number;
}

export interface BurstResult {
  totalRequests: number;
  executionsPerSec: number;
  elapsedMs: number;
  latencyMs: { min: number; p50: number; p95: number; p99: number; max: number };
}

export interface BrowserMetrics {
  measuredAt: string;
  engine: 'browser';
  stateful: StatefulResult;
  burst: BurstResult;
  totalElapsedMs: number;
}

export interface RunBrowserMetricsOptions {
  /** How many GET /pets executions to time in the burst. Default 500. */
  readonly burstIterations?: number;
}

export function runBrowserMetrics(
  options: RunBrowserMetricsOptions = {},
): BrowserMetrics {
  const burstIterations = options.burstIterations ?? 500;
  const started = performance.now();

  const stateful = runStatefulCheck();
  const burst = runBurst(burstIterations);

  return {
    measuredAt: new Date().toISOString(),
    engine: 'browser',
    stateful,
    burst,
    totalElapsedMs: round(performance.now() - started),
  };
}

/**
 * Six steps that prove the core promise ("writes change future reads") using
 * exactly the operations the playground supports. Every step carries an
 * assertion string so a failure names the broken contract.
 */
export function runStatefulCheck(): StatefulResult {
  const steps: CheckStep[] = [];
  let state: ReplicaState = createInitialState();
  let createdId: string | null = null;
  const started = performance.now();

  const run = (
    step: string,
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body: string | undefined,
    expected: string,
    ok: (response: ReplicaResponse) => boolean,
  ) => {
    const t0 = performance.now();
    const { state: next, response } = executeRequest(state, { method, path, body });
    state = next;
    steps.push({
      step,
      method,
      path,
      status: response.status,
      expected,
      ok: ok(response),
      elapsedMs: round(performance.now() - t0),
    });
  };

  // 1. CREATE
  run(
    'create',
    'POST',
    '/pets',
    JSON.stringify({ name: 'Fido', status: 'available' }),
    'status=201 and response.id defined and response.name="Fido"',
    (res) => {
      const body = res.body as { id?: string; name?: string } | null;
      createdId = body?.id ?? null;
      return res.status === 201 && typeof createdId === 'string' && body?.name === 'Fido';
    },
  );

  // 2. READ after create
  if (createdId) {
    run(
      'read-after-create',
      'GET',
      '/pets/{id}',
      undefined,
      'status=200 and response.name="Fido" (state persisted)',
      (res) => res.status === 200 && (res.body as { name?: string } | null)?.name === 'Fido',
    );
  }

  // 3. LIST contains the created pet
  if (createdId) {
    run(
      'list-contains-created',
      'GET',
      '/pets',
      undefined,
      'status=200 and the created pet appears in the list',
      (res) =>
        res.status === 200 &&
        (res.body as { data?: Array<{ id?: string }> } | null)?.data?.some(
          (p) => p.id === createdId,
        ) === true,
    );
  }

  // 4. DELETE
  if (createdId) {
    run(
      'delete',
      'DELETE',
      '/pets/{id}',
      undefined,
      'status=200 and the pet is removed',
      (res) =>
        res.status === 200 && (res.body as { deleted?: string } | null)?.deleted === createdId,
    );
  }

  // 5. READ after delete — the deleted pet must be gone from the list
  run(
    'read-after-delete',
    'GET',
    '/pets',
    undefined,
    'status=200 and the deleted pet is no longer listed (delete honored)',
    (res) =>
      res.status === 200 &&
      (res.body as { data?: Array<{ id?: string }> } | null)?.data?.some(
        (p) => p.id === createdId,
      ) !== true,
  );

  // 6. Snapshot / restore determinism — mutate, rewind, state matches
  {
    const snapState = takeSnapshot(state);
    const before = snapState.pets.length;
    const { state: mutated } = executeRequest(snapState, {
      method: 'POST',
      path: '/pets',
      body: JSON.stringify({ name: 'Mochi' }),
    });
    const restored = restoreSnapshot(mutated);
    steps.push({
      step: 'snapshot-restore',
      method: 'GET',
      path: '/__carbon/snapshot',
      status: 200,
      expected: 'restore returns the exact pre-mutation state',
      ok: restored.pets.length === before,
      elapsedMs: 0,
    });
  }

  const passed = steps.every((s) => s.ok);
  return { passed, stepCount: steps.length, steps, elapsedMs: round(performance.now() - started) };
}

/**
 * Times `iterations` sequential GET /pets executions and reports wall-clock
 * executions/s plus latency percentiles. Sequential on purpose — the reducer
 * is synchronous, so "concurrency" would be fiction.
 */
export function runBurst(iterations: number): BurstResult {
  const latencies: number[] = [];
  let state: ReplicaState = createInitialState();
  const t0 = performance.now();

  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    const { state: next } = executeRequest(state, { method: 'GET', path: '/pets' });
    state = next;
    latencies.push(performance.now() - start);
  }

  const elapsedMs = performance.now() - t0;
  const sorted = [...latencies].sort((a, b) => a - b);
  return {
    totalRequests: iterations,
    executionsPerSec: round(iterations / (elapsedMs / 1000), 1),
    elapsedMs: round(elapsedMs),
    latencyMs: {
      min: round(sorted[0] ?? 0),
      p50: round(percentile(sorted, 0.5)),
      p95: round(percentile(sorted, 0.95)),
      p99: round(percentile(sorted, 0.99)),
      max: round(sorted.at(-1) ?? 0),
    },
  };
}

export function percentile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(sortedAsc.length * p));
  return sortedAsc[idx] ?? 0;
}

function round(n: number, digits = 3): number {
  const m = 10 ** digits;
  return Math.round(n * m) / m;
}
