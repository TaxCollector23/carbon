import { describe, expect, it } from 'vitest';
import type { ResourceId } from '@carbon/types';
import { InMemoryStateEngine } from './memory.js';

const USER = 'user' as ResourceId;

/**
 * Journal / time-travel cases. Verifies that the mutation log is captured,
 * that `rewindTo` and `forwardTo` walk the engine to prior/later states, and
 * that a new mutation after a rewind forks history correctly.
 */
describe('StateEngine journal', () => {
  const clock = (() => {
    let t = 2_000_000_000_000;
    return () => t++;
  })();

  it('captures every mutation with before/after snapshots', async () => {
    const engine = new InMemoryStateEngine(clock);
    const c = await engine.create(USER, { id: 'u1', name: 'Ada' });
    await engine.update(USER, c.id, { name: 'Ada L.' });
    await engine.delete(USER, c.id);

    const hist = engine.history();
    expect(hist.map((e) => e.op)).toEqual(['create', 'update', 'delete']);
    expect(hist[0]?.before).toBeNull();
    expect(hist[0]?.after?.data.name).toBe('Ada');
    expect(hist[1]?.before?.data.name).toBe('Ada');
    expect(hist[1]?.after?.data.name).toBe('Ada L.');
    expect(hist[2]?.before?.data.name).toBe('Ada L.');
    expect(hist[2]?.after).toBeNull();
    expect(new Set(hist.map((e) => e.seq)).size).toBe(3);
  });

  it('rewindTo restores state and forwardTo replays it', async () => {
    const engine = new InMemoryStateEngine(clock);
    const a = await engine.create(USER, { id: 'a', name: 'A' });
    const b = await engine.create(USER, { id: 'b', name: 'B' });
    const upd = await engine.update(USER, a.id, { name: 'AA' });

    const historyBefore = engine.history();
    const targetSeq = historyBefore[0]!.seq; // state after only the first create

    await engine.rewindTo(targetSeq);
    expect((await engine.list(USER)).items.map((i) => i.id)).toEqual(['a']);
    expect((await engine.read(USER, a.id))?.data.name).toBe('A');

    // Forward back to the latest applied mutation.
    await engine.forwardTo(historyBefore[historyBefore.length - 1]!.seq);
    const listed = await engine.list(USER);
    expect(listed.items.map((i) => i.id).sort()).toEqual(['a', 'b']);
    expect((await engine.read(USER, a.id))?.data.name).toBe('AA');
    expect(upd.id).toBe(a.id);
    expect(b.id).toBe('b');
  });

  it('discards redo tail when a new mutation lands after a rewind', async () => {
    const engine = new InMemoryStateEngine(clock);
    await engine.create(USER, { id: 'a' });
    const second = engine.history()[0]!.seq;
    await engine.create(USER, { id: 'b' });
    await engine.rewindTo(second);
    await engine.create(USER, { id: 'c' });

    const ids = (await engine.list(USER)).items.map((i) => i.id).sort();
    expect(ids).toEqual(['a', 'c']);
    // The 'b' branch is gone — forwardTo to the old seq is a no-op.
    expect(engine.history().at(-1)?.after?.data.id).toBe('c');
  });

  it('respects the journal capacity', async () => {
    const engine = new InMemoryStateEngine(clock, { journalCapacity: 3 });
    for (let i = 0; i < 10; i++) {
      await engine.create(USER, { id: `u${i}` });
    }
    expect(engine.history()).toHaveLength(3);
  });
});
