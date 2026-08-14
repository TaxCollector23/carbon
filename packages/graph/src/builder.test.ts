import { describe, expect, it } from 'vitest';
import type { EndpointId, IntermediateRepresentation, ResourceId } from '@carbon/types';
import { BehaviorGraphBuilder } from './builder.js';

const customer = 'customer' as ResourceId;

function ir(): IntermediateRepresentation {
  return {
    version: 1,
    api: { name: 't', version: '0', source: { kind: 'openapi', ingestedAt: 0 } },
    servers: [],
    auth: [],
    resources: [{ id: customer, name: 'Customer', primaryKey: 'id', schema: { kind: 'unknown' } }],
    endpoints: [
      {
        id: 'GET:/customers' as EndpointId,
        method: 'GET',
        path: '/customers',
        operation: 'list',
        resource: customer,
        params: [],
        requestBody: null,
        responses: [],
        auth: [],
        meta: {},
      },
      {
        id: 'POST:/customers' as EndpointId,
        method: 'POST',
        path: '/customers',
        operation: 'create',
        resource: customer,
        params: [],
        requestBody: null,
        responses: [],
        auth: [],
        meta: {},
      },
      {
        id: 'DELETE:/customers/{id}' as EndpointId,
        method: 'DELETE',
        path: '/customers/{id}',
        operation: 'delete',
        resource: customer,
        params: [{ name: 'id', in: 'path', required: true, schema: { kind: 'string' } }],
        requestBody: null,
        responses: [],
        auth: [],
        meta: {},
      },
    ],
    relationships: [],
    examples: [],
    meta: {},
  };
}

describe('BehaviorGraphBuilder', () => {
  it('produces one node per resource with reader/writer partitions', () => {
    const graph = new BehaviorGraphBuilder().build(ir());
    expect(graph.nodes).toHaveLength(1);
    const [node] = graph.nodes;
    expect(node?.readers).toContain('GET:/customers');
    expect(node?.writers).toContain('POST:/customers');
    expect(node?.writers).toContain('DELETE:/customers/{id}');
  });

  it('emits transitions for create and delete', () => {
    const graph = new BehaviorGraphBuilder().build(ir());
    const kinds = graph.transitions.flatMap((t) => t.effects.map((e) => e.kind));
    expect(kinds).toContain('create');
    expect(kinds).toContain('delete');
  });

  it('emits a unique constraint on the primary key', () => {
    const graph = new BehaviorGraphBuilder().build(ir());
    const unique = graph.constraints.find((c) => c.kind === 'unique' && c.resource === customer);
    expect(unique).toBeTruthy();
  });
});
