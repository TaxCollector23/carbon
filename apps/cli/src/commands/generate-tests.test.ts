import { describe, expect, it } from 'vitest';
import type { EndpointDef, IntermediateRepresentation } from '@carbon/types';
import { renderTestFile } from './generate-tests.js';

function endpoint(overrides: Partial<EndpointDef> & Pick<EndpointDef, 'id'>): EndpointDef {
  return {
    method: 'GET',
    path: '/',
    operation: 'custom',
    resource: null,
    params: [],
    requestBody: null,
    responses: [{ status: 200, body: null, headers: {} }],
    auth: [],
    meta: {},
    ...overrides,
  };
}

function ir(endpoints: EndpointDef[]): IntermediateRepresentation {
  return {
    version: 1,
    api: { name: 'Widgets', version: '1.2.3', source: { kind: 'openapi', ingestedAt: 0 } },
    servers: [],
    auth: [],
    resources: [],
    endpoints,
    relationships: [],
    examples: [],
    meta: {},
  };
}

describe('renderTestFile', () => {
  it('emits one shared replica and no leftover TODO placeholders', () => {
    const output = renderTestFile(
      ir([
        endpoint({
          id: 'create_widgets' as EndpointDef['id'],
          method: 'POST',
          path: '/widgets',
          operation: 'create',
          resource: 'widget' as never,
          responses: [{ status: 201, body: null, headers: {} }],
        }),
        endpoint({
          id: 'list_widgets' as EndpointDef['id'],
          method: 'GET',
          path: '/widgets',
          operation: 'list',
          resource: 'widget' as never,
          responses: [{ status: 200, body: null, headers: {} }],
        }),
      ]),
      '/tmp/widgets.openapi.json',
    );

    expect(output).not.toContain('TODO');
    expect(output).toContain("import { carbon, type Replica } from '@carbon/sdk'");
    expect(output).toContain('beforeAll');
    expect(output).toContain('afterAll');
    // One shared boot, not N per-endpoint boots.
    expect(output.match(/carbon\.emulate\(/g)).toHaveLength(1);
    // Real assertions, not skeletons.
    expect(output).toContain('expect(step.expected).toContain(res.status)');
  });

  it('orders creates before reads so ids can be reused', () => {
    const output = renderTestFile(
      ir([
        endpoint({
          id: 'get_widget' as EndpointDef['id'],
          method: 'GET',
          path: '/widgets/{id}',
          operation: 'get',
          resource: 'widget' as never,
          responses: [{ status: 200, body: null, headers: {} }],
        }),
        endpoint({
          id: 'create_widget' as EndpointDef['id'],
          method: 'POST',
          path: '/widgets',
          operation: 'create',
          resource: 'widget' as never,
          responses: [{ status: 201, body: null, headers: {} }],
        }),
      ]),
      '/tmp/widgets.openapi.json',
    );

    const createAt = output.indexOf('operation: "create"');
    const getAt = output.indexOf('operation: "get"');
    expect(createAt).toBeGreaterThanOrEqual(0);
    expect(getAt).toBeGreaterThan(0);
    expect(createAt).toBeLessThan(getAt);
  });

  it('serializes request-body schemas into the plan', () => {
    const output = renderTestFile(
      ir([
        endpoint({
          id: 'create_widget' as EndpointDef['id'],
          method: 'POST',
          path: '/widgets',
          operation: 'create',
          resource: 'widget' as never,
          requestBody: {
            kind: 'object',
            required: ['name'],
            properties: { name: { kind: 'string' } },
          },
          responses: [{ status: 201, body: null, headers: {} }],
        }),
      ]),
      '/tmp/widgets.openapi.json',
    );

    expect(output).toContain('"required":["name"]');
    expect(output).toContain('"kind":"string"');
  });
});
