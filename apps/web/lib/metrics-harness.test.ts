import { describe, expect, it } from 'vitest';
import {
  runBrowserMetrics,
  runBurst,
  runStatefulCheck,
  percentile,
} from './metrics-harness';

describe('runStatefulCheck', () => {
  it('passes all six steps in order', () => {
    const result = runStatefulCheck();
    expect(result.passed).toBe(true);
    expect(result.stepCount).toBe(6);
    expect(result.steps.map((s) => s.step)).toEqual([
      'create',
      'read-after-create',
      'list-contains-created',
      'delete',
      'read-after-delete',
      'snapshot-restore',
    ]);
    expect(result.steps.every((s) => s.ok)).toBe(true);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('records per-step latency and status codes', () => {
    const result = runStatefulCheck();
    for (const step of result.steps) {
      expect(step.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(step.expected.length).toBeGreaterThan(0);
    }
    // create → 201, read → 200, delete → 200, list-after-delete → 200
    expect(result.steps[0]!.status).toBe(201);
    expect(result.steps[1]!.status).toBe(200);
    expect(result.steps[4]!.status).toBe(200);
  });
});

describe('runBurst', () => {
  it('executes the requested iteration count and reports sane stats', () => {
    const result = runBurst(200);
    expect(result.totalRequests).toBe(200);
    expect(result.executionsPerSec).toBeGreaterThan(0);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.latencyMs.min).toBeGreaterThanOrEqual(0);
    expect(result.latencyMs.max).toBeGreaterThanOrEqual(result.latencyMs.p50);
    expect(result.latencyMs.p50).toBeGreaterThanOrEqual(result.latencyMs.min);
    expect(result.latencyMs.p95).toBeGreaterThanOrEqual(result.latencyMs.p50);
  });
});

describe('runBrowserMetrics', () => {
  it('combines a passing stateful check and a burst', () => {
    const result = runBrowserMetrics({ burstIterations: 50 });
    expect(result.engine).toBe('browser');
    expect(result.stateful.passed).toBe(true);
    expect(result.burst.totalRequests).toBe(50);
    expect(result.totalElapsedMs).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(Date.parse(result.measuredAt))).toBe(false);
  });
});

describe('percentile', () => {
  it('indexes a sorted array', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    // nearest-rank: floor(n * p) as index
    expect(percentile(sorted, 0.5)).toBe(6);
    expect(percentile(sorted, 0.9)).toBe(10);
    expect(percentile(sorted, 0.99)).toBe(10);
    expect(percentile([], 0.5)).toBe(0);
  });
});
