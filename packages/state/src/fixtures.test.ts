import { describe, expect, it } from 'vitest';
import type { ResourceId } from '@carbon/types';
import { InMemoryStateEngine } from './memory.js';
import { loadFixtures } from './fixtures.js';

const USER = 'user' as ResourceId;

describe('loadFixtures', () => {
  it('seeds the engine with 3 users on reset', async () => {
    const engine = new InMemoryStateEngine();
    await engine.reset();
    await loadFixtures(engine, {
      [USER]: [
        { id: 'u1', name: 'Ada' },
        { id: 'u2', name: 'Bob' },
        { id: 'u3', name: 'Cid' },
      ],
    });
    const listed = await engine.list(USER);
    expect(listed.items.map((i) => i.id).sort()).toEqual(['u1', 'u2', 'u3']);
    expect((await engine.read(USER, 'u2'))?.data.name).toBe('Bob');
  });
});
