import { describe, expect, it } from 'vitest';
import type { IntermediateRepresentation } from '@carbon/types';
import { validateIr } from './ci.js';

function ir(value: Partial<IntermediateRepresentation>): IntermediateRepresentation {
  return {
    version: 1,
    api: {
      name: 'Pets',
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
    ...value,
  } as IntermediateRepresentation;
}

describe('validateIr', () => {
  it('reports duplicate endpoint keys', () => {
    const issues = validateIr(
      ir({
        endpoints: [
          { method: 'GET', path: '/pets', resource: null },
          { method: 'get', path: '/pets', resource: null },
        ] as never,
      }),
    );

    expect(issues).toContainEqual({
      code: 'duplicate_endpoint',
      message: 'Duplicate endpoint: GET /pets',
    });
  });

  it('reports endpoint and relationship references to missing resources', () => {
    const issues = validateIr(
      ir({
        endpoints: [{ method: 'GET', path: '/pets', resource: 'pet' }] as never,
        relationships: [{ from: 'pet', to: 'owner', kind: 'belongs-to', via: 'ownerId' }] as never,
      }),
    );

    expect(issues.map((issue) => issue.code)).toEqual([
      'missing_endpoint_resource',
      'missing_relationship_source',
      'missing_relationship_target',
    ]);
  });

  it('accepts a self-contained contract', () => {
    expect(
      validateIr(
        ir({
          resources: [{ id: 'pet', name: 'Pet', primaryKey: 'id', schema: {} }] as never,
          endpoints: [{ method: 'GET', path: '/pets', resource: 'pet' }] as never,
          relationships: [],
        }),
      ),
    ).toEqual([]);
  });
});
