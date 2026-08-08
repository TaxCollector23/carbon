import type { EndpointId, IntermediateRepresentation, ResourceId } from '@carbon/types';

/**
 * Shared "pets" IR used by the CRUD / state / throughput / memory benches.
 * Kept tiny on purpose — one resource, full CRUD — so numbers reflect
 * runtime + state engine cost, not fixture bloat.
 */
export const PETS_RESOURCE = 'pet' as ResourceId;

export function petsIr(): IntermediateRepresentation {
  return {
    version: 1,
    api: { name: 'petstore-bench', version: '0', source: { kind: 'openapi', ingestedAt: 0 } },
    servers: [],
    auth: [],
    resources: [
      { id: PETS_RESOURCE, name: 'Pet', primaryKey: 'id', schema: { kind: 'unknown' } },
    ],
    endpoints: [
      {
        id: 'GET:/pets' as EndpointId,
        method: 'GET',
        path: '/pets',
        operation: 'list',
        resource: PETS_RESOURCE,
        params: [],
        requestBody: null,
        responses: [],
        auth: [],
        meta: {},
      },
      {
        id: 'POST:/pets' as EndpointId,
        method: 'POST',
        path: '/pets',
        operation: 'create',
        resource: PETS_RESOURCE,
        params: [],
        requestBody: null,
        responses: [],
        auth: [],
        meta: {},
      },
      {
        id: 'GET:/pets/{id}' as EndpointId,
        method: 'GET',
        path: '/pets/{id}',
        operation: 'get',
        resource: PETS_RESOURCE,
        params: [{ name: 'id', in: 'path', required: true, schema: { kind: 'string' } }],
        requestBody: null,
        responses: [],
        auth: [],
        meta: {},
      },
      {
        id: 'PATCH:/pets/{id}' as EndpointId,
        method: 'PATCH',
        path: '/pets/{id}',
        operation: 'update',
        resource: PETS_RESOURCE,
        params: [{ name: 'id', in: 'path', required: true, schema: { kind: 'string' } }],
        requestBody: null,
        responses: [],
        auth: [],
        meta: {},
      },
      {
        id: 'DELETE:/pets/{id}' as EndpointId,
        method: 'DELETE',
        path: '/pets/{id}',
        operation: 'delete',
        resource: PETS_RESOURCE,
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

/** Simple deterministic mulberry32 PRNG. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function percentile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(sortedAsc.length * p));
  return sortedAsc[idx] ?? 0;
}

export function round(n: number, digits = 3): number {
  const m = 10 ** digits;
  return Math.round(n * m) / m;
}
