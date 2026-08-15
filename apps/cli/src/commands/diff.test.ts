import { describe, expect, it } from 'vitest';
import type { EndpointDef, IntermediateRepresentation } from '@carbon/types';
import { compareIr } from './diff.js';

function ir(overrides: Partial<IntermediateRepresentation> = {}): IntermediateRepresentation {
  return {
    version: 1,
    api: {
      name: 'Payments',
      version: '1.0.0',
      source: { kind: 'openapi', ingestedAt: 1 },
    },
    servers: [],
    auth: [],
    resources: [],
    endpoints: [],
    relationships: [],
    examples: [],
    meta: {},
    ...overrides,
  } as IntermediateRepresentation;
}

describe('compareIr', () => {
  it('reports added, removed, and changed normalized entities', () => {
    const before = ir({
      endpoints: [
        {
          id: 'endpoint_old' as EndpointDef['id'],
          method: 'GET',
          path: '/customers',
          operation: 'list',
          resource: null,
          params: [],
          requestBody: null,
          responses: [],
          auth: [],
          meta: {},
        },
        {
          id: 'endpoint_changed' as EndpointDef['id'],
          method: 'POST',
          path: '/charges',
          operation: 'create',
          resource: null,
          params: [],
          requestBody: null,
          responses: [],
          auth: [],
          meta: {},
        },
      ],
    });
    const after = ir({
      api: { ...before.api, version: '2.0.0' },
      endpoints: [
        {
          id: 'endpoint_changed' as EndpointDef['id'],
          method: 'POST',
          path: '/charges',
          operation: 'action',
          resource: null,
          params: [],
          requestBody: null,
          responses: [],
          auth: [],
          meta: {},
        },
        {
          id: 'endpoint_new' as EndpointDef['id'],
          method: 'GET',
          path: '/invoices',
          operation: 'list',
          resource: null,
          params: [],
          requestBody: null,
          responses: [],
          auth: [],
          meta: {},
        },
      ],
    });

    const diff = compareIr(before, after);
    expect(diff.summary).toEqual({ added: 1, removed: 1, changed: 2, total: 4 });
    expect(diff.changes).toEqual(
      expect.arrayContaining([
        {
          kind: 'changed',
          subject: 'api',
          key: 'Payments',
          detail: 'Payments v1.0.0 → Payments v2.0.0',
        },
        { kind: 'removed', subject: 'endpoint', key: 'GET /customers' },
        { kind: 'changed', subject: 'endpoint', key: 'POST /charges' },
        { kind: 'added', subject: 'endpoint', key: 'GET /invoices' },
      ]),
    );
  });

  it('ignores endpoint ids and object property ordering', () => {
    const before = ir({
      endpoints: [
        {
          id: 'endpoint_a' as EndpointDef['id'],
          method: 'GET',
          path: '/pets',
          operation: 'list',
          resource: null,
          params: [],
          requestBody: null,
          responses: [],
          auth: [],
          meta: { generatedAt: 1 },
        },
      ],
    });
    const after = ir({
      endpoints: [
        {
          id: 'endpoint_b' as EndpointDef['id'],
          method: 'GET',
          path: '/pets',
          operation: 'list',
          resource: null,
          params: [],
          requestBody: null,
          responses: [],
          auth: [],
          meta: { generatedAt: 2 },
        },
      ],
    });

    expect(compareIr(before, after).summary.total).toBe(0);
  });
});
