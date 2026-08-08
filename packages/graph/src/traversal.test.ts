import { describe, expect, it } from 'vitest';
import { enforceForeignKeys } from './traversal.js';

describe('enforceForeignKeys', () => {
  const rows = [
    { id: 'o1', customerId: 'c1' },
    { id: 'o2', customerId: 'c2' },
    { id: 'o3', customerId: 'missing' },
  ];
  const parents = new Set(['c1', 'c2']);

  it('drops rows with dangling references in strict mode', () => {
    const out = enforceForeignKeys(rows, 'customerId', parents, 'strict');
    expect(out.map((r) => r.id)).toEqual(['o1', 'o2']);
  });

  it('preserves dangling references in loose mode', () => {
    const out = enforceForeignKeys(rows, 'customerId', parents, 'loose');
    expect(out.map((r) => r.id)).toEqual(['o1', 'o2', 'o3']);
  });
});
