import { describe, expect, it } from 'vitest';
import { NoopLogger } from '@carbon/core';
import { HarParser } from './adapters/har.js';
import { createParserContext } from './parser.js';

describe('HarParser', () => {
  it('groups exchanges into endpoint templates with inferred path params', async () => {
    const parser = new HarParser();
    const har = {
      log: {
        entries: [
          {
            request: { method: 'GET', url: 'https://api.example.com/customers/cus_abc123' },
            response: { status: 200, content: { text: '{"id":"cus_abc123","name":"Ada"}' } },
          },
          {
            request: { method: 'GET', url: 'https://api.example.com/customers/cus_xyz789' },
            response: { status: 200, content: { text: '{"id":"cus_xyz789","name":"Ida"}' } },
          },
          {
            request: { method: 'GET', url: 'https://api.example.com/customers' },
            response: { status: 200, content: { text: '{"data":[]}' } },
          },
        ],
      },
    };
    const ir = await parser.parse({ kind: 'json', content: har }, createParserContext(NoopLogger));
    expect(ir.endpoints.map((e) => e.path).sort()).toEqual(['/customers', '/customers/{id}']);
    const singular = ir.endpoints.find((e) => e.path === '/customers/{id}')!;
    expect(singular.params[0]).toMatchObject({ name: 'id', in: 'path' });
    expect(ir.resources.map((r) => r.name)).toEqual(['Customer']);
    expect(ir.examples.length).toBeGreaterThanOrEqual(1);
  });
});
