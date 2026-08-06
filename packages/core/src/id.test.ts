import { describe, expect, it } from 'vitest';
import { makeId } from './id.js';

describe('makeId', () => {
  it('produces a prefixed, base32-encoded id', () => {
    const id = makeId('prj', 8);
    const [prefix, body] = id.split('_');
    expect(prefix).toBe('prj');
    expect(body).toMatch(/^[a-z2-7]+$/);
  });

  it('produces distinct ids on repeated calls', () => {
    const seen = new Set(Array.from({ length: 128 }, () => makeId('rec')));
    expect(seen.size).toBe(128);
  });
});
