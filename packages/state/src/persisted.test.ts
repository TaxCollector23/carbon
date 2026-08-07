import { describe, expect, it } from 'vitest';
import type { ResourceId } from '@carbon/types';
import { InMemoryStateEngine } from './memory.js';
import { withPersistence } from './persisted.js';
import type { StateSnapshot } from './engine.js';

const customer = 'customer' as ResourceId;

describe('withPersistence', () => {
  it('restores from a prior snapshot and flushes writes back', async () => {
    let saved: StateSnapshot | null = null;
    const engine = await withPersistence(new InMemoryStateEngine(), {
      load: async () => null,
      save: async (snap) => {
        saved = snap;
      },
      debounceMs: 5,
    });

    await engine.create(customer, { name: 'Ada' });
    // Wait for the debounce timer to fire and the save to resolve.
    await new Promise((r) => setTimeout(r, 30));
    expect(saved).not.toBeNull();
    expect(saved!.records).toHaveLength(1);

    // Re-boot from the persisted snapshot.
    const snapshot = saved!;
    const restored = await withPersistence(new InMemoryStateEngine(), {
      load: async () => snapshot,
      save: async () => {},
    });
    const list = await restored.list(customer);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.data.name).toBe('Ada');
  });
});
