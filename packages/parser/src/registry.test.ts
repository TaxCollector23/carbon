import { describe, expect, it } from 'vitest';
import { NoopLogger } from '@carbon/core';
import { OpenApiParser } from './adapters/openapi.js';
import { HarParser } from './adapters/har.js';
import { ParserRegistry } from './registry.js';
import { createParserContext } from './parser.js';

describe('ParserRegistry', () => {
  it('routes an OpenAPI document to the OpenAPI parser', async () => {
    const registry = new ParserRegistry().register(new OpenApiParser()).register(new HarParser());
    const ir = await registry.parse(
      {
        kind: 'json',
        content: {
          openapi: '3.0.0',
          info: { title: 'Widgets', version: '1.2.3' },
          paths: {
            '/widgets': { get: { operationId: 'listWidgets' } },
            '/widgets/{id}': { get: {}, delete: {} },
          },
        },
      },
      createParserContext(NoopLogger),
    );
    expect(ir.api.name).toBe('Widgets');
    expect(ir.api.version).toBe('1.2.3');
    expect(ir.endpoints).toHaveLength(3);
    const list = ir.endpoints.find((e) => e.path === '/widgets' && e.method === 'GET');
    expect(list?.operation).toBe('list');
    const get = ir.endpoints.find((e) => e.path === '/widgets/{id}' && e.method === 'GET');
    expect(get?.operation).toBe('get');
  });

  it('routes a HAR document to the HAR parser', async () => {
    const registry = new ParserRegistry().register(new OpenApiParser()).register(new HarParser());
    const ir = await registry.parse(
      { kind: 'json', content: { log: { entries: [] } } },
      createParserContext(NoopLogger),
    );
    expect(ir.api.source.kind).toBe('har');
  });
});
