import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoopLogger } from '@carbon/core';
import { MemoryStorage, StorageKeys } from '@carbon/storage';
import type { StateSnapshot } from '@carbon/state';
import { createReliabilityService } from './reliability.js';
import type { EmulatorRegistry } from './emulator-registry.js';

const before: StateSnapshot = { version: 1, takenAt: 1, records: [] };

function makeRegistry(after: StateSnapshot) {
  const chaos: unknown[] = [];
  const restored: StateSnapshot[] = [];
  let snapshotCalls = 0;
  const registry = {
    get: vi.fn(() => ({
      id: 'emu_test',
      projectSlug: 'demo',
      irId: 'ir_test',
      url: 'http://127.0.0.1:4321',
      startedAt: 1,
      status: 'running' as const,
    })),
    getStateSnapshot: vi.fn(async () => (snapshotCalls++ === 0 ? before : after)),
    restoreStateSnapshot: vi.fn(async (_id: string, snapshot: StateSnapshot) => {
      restored.push(snapshot);
    }),
    applyChaos: vi.fn((_id: string, config: unknown) => chaos.push(config)),
  } as unknown as EmulatorRegistry;
  return { registry, chaos, restored };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reliability service', () => {
  it('runs a controlled status failure, persists evidence, and restores state', async () => {
    const storage = new MemoryStorage();
    const { registry, chaos, restored } = makeRegistry(before);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'outage' }), { status: 503 })));
    const service = createReliabilityService({ emulators: registry, storage, logger: NoopLogger });

    const run = await service.run({
      emulatorId: 'emu_test',
      scenario: 'http-outage',
      method: 'GET',
      path: '/health',
    });

    expect(run.status).toBe('passed');
    expect(run.observed[0]?.status).toBe(503);
    expect(run.comparison.persistedChange).toBe(false);
    expect(run.reproduction).toContain('--scenario http-outage');
    expect(chaos.at(-1)).toEqual({ errorRules: [], latency: {} });
    expect(restored).toEqual([before]);
    expect(await storage.get(StorageKeys.reliabilityRun('demo', run.id))).not.toBeNull();
    expect((await service.list('demo'))[0]?.id).toBe(run.id);
  });

  it('marks duplicate writes as a failure and still cleans up the target', async () => {
    const after: StateSnapshot = {
      version: 1,
      takenAt: 2,
      records: [
        {
          resource: 'deliveries' as StateSnapshot['records'][number]['resource'],
          id: 'delivery_1',
          data: { eventId: 'evt_1' },
          createdAt: 2,
          updatedAt: 2,
        },
        {
          resource: 'deliveries' as StateSnapshot['records'][number]['resource'],
          id: 'delivery_2',
          data: { eventId: 'evt_1' },
          createdAt: 2,
          updatedAt: 2,
        },
      ],
    };
    const storage = new MemoryStorage();
    const { registry, restored } = makeRegistry(after);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
    const service = createReliabilityService({ emulators: registry, storage, logger: NoopLogger });

    const run = await service.run({ emulatorId: 'emu_test', scenario: 'duplicate-webhook' });

    expect(run.status).toBe('failed');
    expect(run.comparison.added).toBe(2);
    expect(restored).toEqual([before]);
  });
});
