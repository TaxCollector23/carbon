import { describe, expect, it } from 'vitest';
import { compareDrift, formatDrift, parseIgnorePath } from './drift.js';

describe('compareDrift', () => {
  it('passes for structurally identical JSON', () => {
    const body = { data: { id: 'x1', items: [{ name: 'Fido', price: 9.99 }] }, ok: true };
    expect(compareDrift(body, structuredClone(body))).toEqual({ ok: true });
  });

  it('treats null and missing as equivalent', () => {
    expect(compareDrift({ a: null }, {})).toEqual({ ok: true });
    expect(compareDrift({}, { a: null })).toEqual({ ok: true });
  });

  it('compares numbers numerically, not textually', () => {
    expect(compareDrift({ n: 1 }, { n: 1.0 })).toEqual({ ok: true });
    expect(compareDrift({ n: 1 }, { n: 2 }).ok).toBe(false);
  });

  it('flags a type change', () => {
    const r = compareDrift({ n: 1 }, { n: '1' });
    expect(r).toMatchObject({ ok: false, path: 'n', reason: 'type' });
  });

  it('flags a changed value', () => {
    const r = compareDrift({ data: { name: 'Fido' } }, { data: { name: 'Rex' } });
    expect(r).toMatchObject({ ok: false, path: 'data.name', reason: 'value' });
  });

  it('flags a missing expected field', () => {
    const r = compareDrift({ data: { a: 1, b: 2 } }, { data: { a: 1 } });
    expect(r).toMatchObject({ ok: false, path: 'data.b', reason: 'missing' });
  });

  it('tolerates extra fields by default but flags them in strict mode', () => {
    expect(compareDrift({ a: 1 }, { a: 1, b: 2 })).toEqual({ ok: true });
    const r = compareDrift({ a: 1 }, { a: 1, b: 2 }, { strictKeys: true });
    expect(r).toMatchObject({ ok: false, path: 'b', reason: 'extra' });
  });

  it('flags an array length change', () => {
    const r = compareDrift({ items: [1, 2] }, { items: [1, 2, 3] });
    expect(r).toMatchObject({ ok: false, path: 'items', reason: 'length' });
  });

  it('flags a value change inside an array element with an index path', () => {
    const r = compareDrift({ items: [{ id: 'a', price: 1 }] }, { items: [{ id: 'a', price: 2 }] });
    expect(r).toMatchObject({ ok: false, path: 'items[0].price', reason: 'value' });
  });

  it('ignores volatile fields by exact path', () => {
    const expected = { data: { updated_at: '2026-01-01T00:00:00Z', name: 'x' } };
    const actual = { data: { updated_at: '2026-08-25T12:00:00Z', name: 'x' } };
    expect(compareDrift(expected, actual)).toMatchObject({ ok: false });
    expect(
      compareDrift(expected, actual, { ignore: ['data.updated_at'] }),
    ).toEqual({ ok: true });
  });

  it('ignores everything under a wildcard segment', () => {
    const expected = { data: { items: [{ token: 'abc', id: 1 }] } };
    const actual = { data: { items: [{ token: 'xyz', id: 1 }] } };
    expect(compareDrift(expected, actual, { ignore: ['data.items[*].token'] })).toEqual({
      ok: true,
    });
  });

  it('trailing * ignores a whole subtree', () => {
    const expected = { meta: { a: 1, nested: { deep: 'x' } }, name: 'y' };
    const actual = { meta: { a: 999, nested: { deep: 'changed' } }, name: 'y' };
    expect(compareDrift(expected, actual, { ignore: ['meta.*'] })).toEqual({ ok: true });
  });

  it('reports a root-level mismatch path', () => {
    const r = compareDrift('hello', 'goodbye');
    expect(r).toMatchObject({ ok: false, path: '(root)', reason: 'value' });
  });
});

describe('parseIgnorePath', () => {
  it('splits dotted paths and converts bracket array notation', () => {
    expect(parseIgnorePath('data.items[*].token')).toEqual(['data', 'items', '*', 'token']);
    expect(parseIgnorePath('updated_at')).toEqual(['updated_at']);
  });
});

describe('formatDrift', () => {
  it('renders each reason readably', () => {
    const type = compareDrift({ n: 1 }, { n: '1' });
    const value = compareDrift({ n: 1 }, { n: 2 });
    const missing = compareDrift({ a: 1, b: 2 }, { a: 1 });
    const extra = compareDrift({ a: 1 }, { a: 1, b: 2 }, { strictKeys: true });
    const length = compareDrift({ items: [1] }, { items: [1, 2] });
    for (const r of [type, value, missing, extra, length]) {
      if (!r.ok) expect(formatDrift(r)).toContain(r.path);
    }
  });
});
