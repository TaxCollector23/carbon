import { describe, expect, it } from 'vitest';
import type { ResourceId } from '@carbon/types';
import type { StateSnapshot } from './engine.js';
import { diffSnapshots } from './diff.js';

const CUSTOMER = 'customer' as ResourceId;
const ORDER = 'order' as ResourceId;

function snap(records: StateSnapshot['records'], takenAt = 1): StateSnapshot {
  return { version: 1, takenAt, records };
}

describe('diffSnapshots', () => {
  it('detects added, removed, and changed rows per resource', () => {
    const a = snap([
      { resource: CUSTOMER, id: 'c1', data: { id: 'c1', name: 'Ada' }, createdAt: 1, updatedAt: 1 },
      { resource: CUSTOMER, id: 'c2', data: { id: 'c2', name: 'Bob' }, createdAt: 1, updatedAt: 1 },
      { resource: ORDER, id: 'o1', data: { id: 'o1', total: 10 }, createdAt: 1, updatedAt: 1 },
    ]);
    const b = snap(
      [
        { resource: CUSTOMER, id: 'c1', data: { id: 'c1', name: 'Ada L.' }, createdAt: 1, updatedAt: 2 },
        { resource: CUSTOMER, id: 'c3', data: { id: 'c3', name: 'Cid' }, createdAt: 2, updatedAt: 2 },
        { resource: ORDER, id: 'o1', data: { id: 'o1', total: 10 }, createdAt: 1, updatedAt: 1 },
      ],
      2,
    );

    const d = diffSnapshots(a, b);

    expect(d.resources.customer!.added.map((r) => r.id)).toEqual(['c3']);
    expect(d.resources.customer!.removed.map((r) => r.id)).toEqual(['c2']);
    expect(d.resources.customer!.changed).toHaveLength(1);
    expect(d.resources.customer!.changed[0]?.changedFields).toEqual(['name']);
    expect(d.resources.order!.changed).toEqual([]);
    expect(d.resources.order!.added).toEqual([]);
    expect(d.resources.order!.removed).toEqual([]);
  });

  it('handles resources present in only one snapshot', () => {
    const a = snap([
      { resource: CUSTOMER, id: 'c1', data: { id: 'c1' }, createdAt: 1, updatedAt: 1 },
    ]);
    const b = snap([
      { resource: ORDER, id: 'o1', data: { id: 'o1' }, createdAt: 1, updatedAt: 1 },
    ]);
    const d = diffSnapshots(a, b);
    expect(d.resources.customer!.removed).toHaveLength(1);
    expect(d.resources.order!.added).toHaveLength(1);
  });

  it('deep-compares nested data', () => {
    const a = snap([
      { resource: CUSTOMER, id: 'c1', data: { id: 'c1', addr: { city: 'NYC' } }, createdAt: 1, updatedAt: 1 },
    ]);
    const b = snap([
      { resource: CUSTOMER, id: 'c1', data: { id: 'c1', addr: { city: 'NYC' } }, createdAt: 1, updatedAt: 2 },
    ]);
    const d = diffSnapshots(a, b);
    expect(d.resources.customer!.changed).toEqual([]);
  });

  it('reports empty diff for identical snapshots', () => {
    const s = snap([
      { resource: CUSTOMER, id: 'c1', data: { id: 'c1' }, createdAt: 1, updatedAt: 1 },
    ]);
    const d = diffSnapshots(s, s);
    expect(d.resources.customer!.added).toEqual([]);
    expect(d.resources.customer!.removed).toEqual([]);
    expect(d.resources.customer!.changed).toEqual([]);
  });
});
