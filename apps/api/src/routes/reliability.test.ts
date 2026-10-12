import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { NoopLogger, RELIABILITY_SCENARIOS } from '@carbon/core';
import { MemoryStorage } from '@carbon/storage';
import type { AppContext } from '../context.js';
import { registerReliabilityRoutes } from './reliability.js';

function makeCtx(): AppContext {
  const report = {
    id: 'run_test',
    emulatorId: 'emu_test',
    projectSlug: 'demo',
    scenario: RELIABILITY_SCENARIOS[0]!,
    status: 'passed' as const,
    createdAt: new Date(1).toISOString(),
    completedAt: new Date(2).toISOString(),
    durationMs: 1,
    request: { method: 'GET', path: '/health', timeoutMs: 1000 },
    fault: { kind: 'status' as const, description: 'Return 503.', status: 503 },
    observed: [{ status: 503, latencyMs: 1 }],
    stateBefore: { recordCount: 0, resources: [] },
    stateAfter: { recordCount: 0, resources: [] },
    comparison: {
      passed: true,
      expected: 'HTTP 503 with no state mutation',
      actual: 'HTTP 503; state delta +0/-0/~0',
      added: 0,
      removed: 0,
      changed: 0,
      persistedChange: false,
    },
    steps: [],
    reproduction: 'carbon test --scenario http-outage',
  };
  return {
    logger: NoopLogger,
    db: {} as AppContext['db'],
    storage: new MemoryStorage(),
    ingestion: {} as AppContext['ingestion'],
    emulators: {
      get: () => ({ id: 'emu_test', projectSlug: 'demo' }),
    } as unknown as AppContext['emulators'],
    reliability: {
      scenarios: () => RELIABILITY_SCENARIOS,
      run: async () => report,
      list: async () => [report],
      get: async () => report,
      rerun: async () => report,
    },
  };
}

describe('reliability routes', () => {
  it('lists scenarios and executes a report through the control plane', async () => {
    const app = Fastify();
    await registerReliabilityRoutes(app, makeCtx());
    await app.ready();

    const scenarios = await app.inject('/v1/reliability/scenarios');
    expect(scenarios.statusCode).toBe(200);
    expect(scenarios.json().data).toHaveLength(8);

    const run = await app.inject({
      method: 'POST',
      url: '/v1/reliability/runs',
      payload: { emulatorId: 'emu_test', scenario: 'http-outage' },
    });
    expect(run.statusCode).toBe(201);
    expect(run.json().id).toBe('run_test');
  });
});
