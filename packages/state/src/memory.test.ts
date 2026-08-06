import { describe, expect, it } from 'vitest';
import type { ResourceId } from '@carbon/types';
import { InMemoryStateEngine } from './memory.js';

const CUSTOMER = 'customer' as ResourceId;

describe('InMemoryStateEngine', () => {
  const clock = (() => {
    let t = 1_700_000_000_000;
    return () => t++;
  })();

  it('creates, reads, updates, and deletes records', async () => {
    const engine = new InMemoryStateEngine(clock);
    const created = await engine.create(CUSTOMER, { name: 'Ada' });
    expect(created.data.name).toBe('Ada');
    expect(created.id).toBeTruthy();

    const read = await engine.read(CUSTOMER, created.id);
    expect(read?.data.name).toBe('Ada');

    const updated = await engine.update(CUSTOMER, created.id, { email: 'ada@example.com' });
    expect(updated.data).toMatchObject({ name: 'Ada', email: 'ada@example.com' });
    expect(updated.updatedAt).toBeGreaterThan(updated.createdAt);

    await engine.delete(CUSTOMER, created.id);
    expect(await engine.read(CUSTOMER, created.id)).toBeNull();
  });

  it('lists with cursor pagination', async () => {
    const engine = new InMemoryStateEngine(clock);
    for (let i = 0; i < 12; i++) {
      await engine.create(CUSTOMER, { name: `n${i}` });
    }
    const page1 = await engine.list(CUSTOMER, { limit: 5 });
    expect(page1.items).toHaveLength(5);
    expect(page1.total).toBe(12);
    const page2 = await engine.list(CUSTOMER, { limit: 5, cursor: page1.nextCursor });
    expect(page2.items).toHaveLength(5);
    expect(page2.items[0]?.id).not.toBe(page1.items[0]?.id);
  });

  it('rolls back a failed transaction', async () => {
    const engine = new InMemoryStateEngine(clock);
    const first = await engine.create(CUSTOMER, { name: 'kept' });
    await expect(
      engine.transaction(async (tx) => {
        await tx.create(CUSTOMER, { name: 'rolled-back' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const list = await engine.list(CUSTOMER);
    expect(list.items.map((i) => i.id)).toEqual([first.id]);
  });

  it('snapshots and restores', async () => {
    const engine = new InMemoryStateEngine(clock);
    const a = await engine.create(CUSTOMER, { name: 'a' });
    const snap = await engine.snapshot();
    await engine.delete(CUSTOMER, a.id);
    expect(await engine.read(CUSTOMER, a.id)).toBeNull();
    await engine.restore(snap);
    expect((await engine.read(CUSTOMER, a.id))?.data.name).toBe('a');
  });
});
