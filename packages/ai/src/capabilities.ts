import { z } from 'zod';
import type { IntermediateRepresentation, RelationshipDef, ResourceDef } from '@carbon/types';
import type { AiProvider } from './provider.js';

/**
 * High-level ingestion capabilities layered on top of a provider. These are
 * the operations the rest of Carbon reaches for — providers themselves are
 * kept low-level and swappable.
 */
export class AiCapabilities {
  constructor(private readonly provider: AiProvider) {}

  /** Turn an IR + accompanying docs into a list of inferred resources. */
  inferResources(input: {
    ir: IntermediateRepresentation;
    docs?: string;
  }): Promise<ResourceDef[]> {
    return this.provider.structured({
      instruction:
        'Given an IR of API endpoints and optional documentation, identify the underlying resources. ' +
        'Return only resources you can justify from the input; prefer fewer, well-named resources over many speculative ones.',
      input,
      schema: z
        .object({
          resources: z.array(
            z.object({
              id: z.string().min(1),
              name: z.string().min(1),
              primaryKey: z.string().min(1),
              schema: z.any(),
            }),
          ),
        })
        .transform((v) => v.resources as unknown as ResourceDef[]),
    });
  }

  inferRelationships(input: {
    ir: IntermediateRepresentation;
    resources: readonly ResourceDef[];
  }): Promise<RelationshipDef[]> {
    return this.provider.structured({
      instruction:
        'Given resources and endpoints, infer ownership and reference relationships. Only report relationships with clear evidence.',
      input,
      schema: z
        .object({
          relationships: z.array(
            z.object({
              from: z.string(),
              to: z.string(),
              kind: z.enum(['owns', 'belongs-to', 'references', 'many-to-many']),
              via: z.string(),
            }),
          ),
        })
        .transform((v) => v.relationships as unknown as RelationshipDef[]),
    });
  }

  explainEndpoint(input: {
    ir: IntermediateRepresentation;
    endpointId: string;
  }): Promise<string> {
    return this.provider
      .complete({
        system:
          'You are Carbon, an API intelligence tool. Explain endpoints crisply, factually, without marketing language.',
        messages: [
          {
            role: 'user',
            content: `Explain endpoint ${input.endpointId} from this IR: ${JSON.stringify(input.ir).slice(0, 8000)}`,
          },
        ],
        maxTokens: 400,
      })
      .then((r) => r.text);
  }
}
