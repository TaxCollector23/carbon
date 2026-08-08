import { describe, expect, it } from 'vitest';
import type {
  EndpointId,
  IntermediateRepresentation,
  RelationshipDef,
  ResourceDef,
  ResourceId,
} from '@carbon/types';
import type { z } from 'zod';
import { AiJudge, type JudgeVerdict } from './judge.js';
import type { AiProvider, CompletionRequest, CompletionResponse, StructuredRequest } from './provider.js';

const customerId = 'customer' as ResourceId;
const orderId = 'order' as ResourceId;

function baseIr(): IntermediateRepresentation {
  return {
    version: 1,
    api: { name: 't', version: '0', source: { kind: 'openapi', ingestedAt: 0 } },
    servers: [],
    auth: [],
    resources: [
      { id: customerId, name: 'Customer', primaryKey: 'id', schema: { kind: 'unknown' } },
    ],
    endpoints: [
      {
        id: 'GET:/customers' as EndpointId,
        method: 'GET',
        path: '/customers',
        operation: 'list',
        resource: customerId,
        params: [],
        requestBody: null,
        responses: [],
        auth: [],
        meta: {},
      },
      {
        id: 'GET:/orders' as EndpointId,
        method: 'GET',
        path: '/orders',
        operation: 'list',
        resource: orderId,
        params: [],
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

/**
 * Test double: a provider whose `structured` call returns a pre-canned
 * verdict, chosen by the test based on the resource/relationship fixture.
 * The real prompt content is not exercised — the judge class's job here is
 * to shepherd input to the provider, validate the response against the
 * verdict schema, and fall back gracefully on errors.
 */
function mockProvider(next: () => unknown): AiProvider {
  return {
    name: 'mock',
    defaultModel: 'mock-1',
    complete(_req: CompletionRequest): Promise<CompletionResponse> {
      throw new Error('not used');
    },
    async structured<T>(req: StructuredRequest<T>): Promise<T> {
      const payload = next();
      return (req.schema as z.ZodType<T>).parse(payload);
    },
  };
}

describe('AiJudge.judgeResourceInference', () => {
  it('scores >= threshold when proposed resources are grounded in the IR', async () => {
    const ir = baseIr();
    const proposed: ResourceDef[] = [
      { id: customerId, name: 'Customer', primaryKey: 'id', schema: { kind: 'unknown' } },
    ];
    const provider = mockProvider(() => ({ score: 0.92, issues: [] }));
    const judge = new AiJudge({ provider });
    const verdict: JudgeVerdict = await judge.judgeResourceInference({
      ir,
      proposedResources: proposed,
    });
    expect(verdict.score).toBeGreaterThanOrEqual(0.75);
    expect(verdict.issues).toHaveLength(0);
    expect(verdict.model).toBe('mock-1');
  });

  it('flags hallucinated fields with score below threshold', async () => {
    const ir = baseIr();
    const hallucinated: ResourceDef[] = [
      { id: customerId, name: 'Customer', primaryKey: 'id', schema: { kind: 'unknown' } },
      // Ghost resource — not referenced by any endpoint.
      {
        id: 'invoice' as ResourceId,
        name: 'Invoice',
        primaryKey: 'invoice_uuid',
        schema: { kind: 'unknown' },
      },
    ];
    const provider = mockProvider(() => ({
      score: 0.3,
      issues: [
        {
          targetType: 'field',
          targetId: 'Invoice.invoice_uuid',
          reason: 'no endpoint or example references Invoice.invoice_uuid',
          severity: 'error',
        },
        {
          targetType: 'resource',
          targetId: 'Invoice',
          reason: 'no endpoint operates on an Invoice resource',
          severity: 'error',
        },
      ],
    }));
    const judge = new AiJudge({ provider });
    const verdict = await judge.judgeResourceInference({
      ir,
      proposedResources: hallucinated,
    });
    expect(verdict.score).toBeLessThan(0.75);
    expect(verdict.issues.some((i) => i.targetType === 'field')).toBe(true);
    expect(verdict.issues[0]?.targetId).toContain('invoice_uuid');
  });
});

describe('AiJudge.judgeRelationshipInference', () => {
  it('flags relationships whose endpoints do not exist', async () => {
    const ir = baseIr();
    const proposed: RelationshipDef[] = [
      {
        from: customerId,
        to: 'shipment' as ResourceId, // no such resource / endpoint
        kind: 'owns',
        via: 'shipment_id',
      },
    ];
    const provider = mockProvider(() => ({
      score: 0.4,
      issues: [
        {
          targetType: 'relationship',
          targetId: 'customer->shipment',
          reason: 'no endpoints exist for the "shipment" resource',
          severity: 'error',
        },
      ],
    }));
    const judge = new AiJudge({ provider });
    const verdict = await judge.judgeRelationshipInference({
      ir,
      proposedRelationships: proposed,
    });
    expect(verdict.score).toBeLessThan(0.75);
    expect(verdict.issues[0]?.targetType).toBe('relationship');
    expect(verdict.issues[0]?.reason).toMatch(/shipment/);
  });
});

describe('AiJudge fallback', () => {
  it('returns a neutral verdict when the provider throws', async () => {
    const provider: AiProvider = {
      name: 'broken',
      defaultModel: 'x',
      complete: () => Promise.reject(new Error('boom')),
      structured: () => Promise.reject(new Error('boom')),
    };
    const judge = new AiJudge({ provider });
    const verdict = await judge.judgeResourceInference({
      ir: baseIr(),
      proposedResources: [],
    });
    expect(verdict.score).toBe(0.5);
    expect(verdict.model).toBeUndefined();
    expect(verdict.issues[0]?.reason).toBe('judge unavailable');
  });
});
