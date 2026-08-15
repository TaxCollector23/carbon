import { describe, expect, it } from 'vitest';
import { parseExplainTarget } from './explain.js';

describe('parseExplainTarget', () => {
  it('normalizes the HTTP method and preserves the API path', () => {
    expect(parseExplainTarget('post /pets/{id}')).toEqual({
      method: 'POST',
      path: '/pets/{id}',
    });
  });

  it('rejects targets without an HTTP method and path', () => {
    expect(() => parseExplainTarget('/pets')).toThrow(/POST \/pets/);
    expect(() => parseExplainTarget('POST')).toThrow(/POST \/pets/);
  });
});
