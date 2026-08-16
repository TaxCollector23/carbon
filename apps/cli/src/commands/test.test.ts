import { describe, expect, it } from 'vitest';
import type { EndpointDef } from '@carbon/types';
import { orderForSmoke, sampleValue } from './test.js';

function endpoint(operation: EndpointDef['operation'], path: string): EndpointDef {
  return {
    id: `${operation}_${path}` as EndpointDef['id'],
    method: 'GET',
    path,
    operation,
    resource: null,
    params: [],
    requestBody: null,
    responses: [{ status: 200, body: null, headers: {} }],
    auth: [],
    meta: {},
  };
}

describe('stateful smoke-test helpers', () => {
  it('orders creates before reads and cleanup mutations last', () => {
    const ordered = orderForSmoke([
      endpoint('delete', '/pets/{id}'),
      endpoint('get', '/pets/{id}'),
      endpoint('create', '/pets'),
      endpoint('list', '/pets'),
      endpoint('update', '/pets/{id}'),
    ]);

    expect(ordered.map((item) => item.operation)).toEqual([
      'create',
      'list',
      'get',
      'update',
      'delete',
    ]);
  });

  it('builds useful bodies from the normalized schema', () => {
    expect(
      sampleValue({
        kind: 'object',
        required: ['name', 'active', 'count'],
        properties: {
          name: { kind: 'string' },
          active: { kind: 'boolean' },
          count: { kind: 'integer' },
        },
      }),
    ).toEqual({ name: 'example', active: true, count: 1 });
  });
});
