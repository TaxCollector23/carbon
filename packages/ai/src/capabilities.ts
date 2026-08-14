import { z } from 'zod';
import type { IntermediateRepresentation, RelationshipDef, ResourceDef } from '@carbon/types';
import type { AiCallContext, AiProvider } from './provider.js';

/**
 * Structural mirror of `@carbon/runtime`'s ErrorInjectionRule. The AI package
 * intentionally does not depend on the runtime so it can be used in
 * ingestion-only contexts (workers, CLI) without pulling Fastify. Keep in
 * sync with packages/runtime/src/plugins/error-injection.ts.
 */
export interface ErrorInjectionRule {
  readonly match: { readonly method?: string; readonly path: string };
  readonly probability: number;
  readonly action:
    | { readonly kind: 'status'; readonly status: number; readonly body?: unknown }
    | { readonly kind: 'timeout'; readonly afterMs: number };
}

const ErrorInjectionRuleSchema = z.object({
  match: z.object({
    method: z.string().optional(),
    path: z.string().min(1),
  }),
  probability: z.number().min(0).max(1),
  action: z.union([
    z.object({
      kind: z.literal('status'),
      status: z.number().int().min(100).max(599),
      body: z.any().optional(),
    }),
    z.object({ kind: z.literal('timeout'), afterMs: z.number().int().min(0) }),
  ]),
});

/**
 * High-level ingestion capabilities layered on top of a provider. These are
 * the operations the rest of Carbon reaches for — providers themselves are
 * kept low-level and swappable.
 */
export class AiCapabilities {
  constructor(private readonly provider: AiProvider | null = null) {}

  /**
   * Turn a natural-language chaos description ("make POST /orders fail 10%
   * of the time with a 503") into structured ErrorInjectionRule[] the runtime
   * plugin understands. Falls through to a regex-based parser when no
   * provider is configured so the feature is usable air-gapped.
   */
  async nlToErrorInjection(nl: string): Promise<{ rules: ErrorInjectionRule[] }> {
    const fallback = () => ({ rules: parseErrorInjectionRules(nl) });
    if (!this.provider) return fallback();
    try {
      const rules = await this.provider.structured({
        instruction:
          'Convert the following natural-language chaos description into a JSON array of ErrorInjectionRule objects. ' +
          'Rule shape: { match: { method?, path }, probability (0..1), action: { kind: "status", status, body? } | { kind: "timeout", afterMs } }. ' +
          'Return { "rules": [...] } only.',
        input: { nl },
        schema: z.object({ rules: z.array(ErrorInjectionRuleSchema) }),
      });
      return { rules: rules.rules as ErrorInjectionRule[] };
    } catch {
      return fallback();
    }
  }

  /**
   * Generate plausible seed data for a set of resources. Fallback path uses
   * deterministic templates + crypto.randomUUID so it works without an LLM
   * or any external faker dependency.
   */
  async generateSeedData(input: {
    resources: readonly { name: string; fields?: readonly string[] }[];
    count: number;
  }): Promise<Record<string, Row[]>> {
    const fallback = () => templateSeedData(input);
    if (!this.provider) return fallback();
    try {
      const result = await this.provider.structured({
        instruction:
          'Generate plausible seed data for each resource. Return an object keyed by resource name, each value an array of rows. ' +
          'Each row should be a flat JSON object with realistic values.',
        input,
        schema: z.object({ data: z.record(z.array(z.record(z.any())) as z.ZodType<Row[]>) }),
      });
      return result.data;
    } catch {
      return fallback();
    }
  }

  /** Turn an IR + accompanying docs into a list of inferred resources. */
  inferResources(
    input: {
      ir: IntermediateRepresentation;
      docs?: string;
    },
    context?: AiCallContext,
  ): Promise<ResourceDef[]> {
    return this.requireProvider().structured({
      instruction:
        'Given an IR of API endpoints and optional documentation, identify the underlying resources. ' +
        'Return only resources you can justify from the input; prefer fewer, well-named resources over many speculative ones.',
      input,
      context,
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

  inferRelationships(
    input: {
      ir: IntermediateRepresentation;
      resources: readonly ResourceDef[];
    },
    context?: AiCallContext,
  ): Promise<RelationshipDef[]> {
    return this.requireProvider().structured({
      instruction:
        'Given resources and endpoints, infer ownership and reference relationships. Only report relationships with clear evidence.',
      input,
      context,
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

  explainEndpoint(input: { ir: IntermediateRepresentation; endpointId: string }): Promise<string> {
    return this.requireProvider()
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

  private requireProvider(): AiProvider {
    if (!this.provider) {
      throw new Error('This AI capability requires a configured provider');
    }
    return this.provider;
  }
}

export type Row = Record<string, unknown>;

/**
 * Regex-based fallback for common NL chaos phrasings. Handles patterns like
 * "make POST /orders fail 10% of the time with a 503", "timeout GET /users",
 * "return 500 for /api/*". Best-effort; unmatched input yields an empty list.
 */
export function parseErrorInjectionRules(nl: string): ErrorInjectionRule[] {
  const rules: ErrorInjectionRule[] = [];
  const clauses = nl
    .split(/(?:\n|;|\.\s+|,\s+then\b)/i)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const clause of clauses) {
    const rule = parseSingleClause(clause);
    if (rule) rules.push(rule);
  }
  if (rules.length === 0) {
    const single = parseSingleClause(nl);
    if (single) rules.push(single);
  }
  return rules;
}

function parseSingleClause(clause: string): ErrorInjectionRule | null {
  const methodMatch = clause.match(/\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/i);
  const pathMatch = clause.match(/(\/[A-Za-z0-9_\-{}*/:.]+)/);
  const percentMatch = clause.match(/(\d{1,3})\s*%/);
  const statusMatch = clause.match(/\b([45]\d{2})\b/);
  const timeoutMatch = clause.match(/\btimeout\b(?:\s+after\s+(\d+)\s*(ms|s|seconds?))?/i);

  const path = pathMatch?.[1];
  if (!path) return null;
  const probability = percentMatch?.[1]
    ? Math.min(1, Math.max(0, Number(percentMatch[1]) / 100))
    : 1;
  const method = methodMatch?.[1]?.toUpperCase();
  const match: { readonly method?: string; readonly path: string } = method
    ? { method, path }
    : { path };
  if (timeoutMatch) {
    const raw = timeoutMatch[1] ? Number(timeoutMatch[1]) : 30_000;
    const unit = (timeoutMatch[2] ?? 'ms').toLowerCase();
    const afterMs = unit.startsWith('s') ? raw * 1000 : raw;
    return { match, probability, action: { kind: 'timeout', afterMs } };
  }
  if (statusMatch) {
    return {
      match,
      probability,
      action: { kind: 'status', status: Number(statusMatch[1]) },
    };
  }
  if (/\bfail(s|ing)?\b|\berror\b/i.test(clause)) {
    return { match, probability, action: { kind: 'status', status: 500 } };
  }
  return null;
}

const SAMPLE_FIRST_NAMES = [
  'Ada',
  'Grace',
  'Alan',
  'Linus',
  'Katherine',
  'Margaret',
  'Dennis',
  'Barbara',
];
const SAMPLE_LAST_NAMES = [
  'Lovelace',
  'Hopper',
  'Turing',
  'Torvalds',
  'Johnson',
  'Hamilton',
  'Ritchie',
  'Liskov',
];

function templateSeedData(input: {
  resources: readonly { name: string; fields?: readonly string[] }[];
  count: number;
}): Record<string, Row[]> {
  const out: Record<string, Row[]> = {};
  for (const resource of input.resources) {
    const rows: Row[] = [];
    for (let i = 0; i < input.count; i++) {
      const first = SAMPLE_FIRST_NAMES[i % SAMPLE_FIRST_NAMES.length]!;
      const last = SAMPLE_LAST_NAMES[i % SAMPLE_LAST_NAMES.length]!;
      const row: Row = {
        id: cryptoRandomUUID(),
        name: `${first} ${last}`,
        email: `${first.toLowerCase()}.${last.toLowerCase()}${i}@example.com`,
        createdAt: new Date(Date.UTC(2024, 0, 1 + i)).toISOString(),
      };
      if (resource.fields) {
        for (const field of resource.fields) {
          if (row[field] !== undefined) continue;
          row[field] = `${resource.name}-${field}-${i}`;
        }
      }
      rows.push(row);
    }
    out[resource.name] = rows;
  }
  return out;
}

function cryptoRandomUUID(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  // Fallback for very old runtimes — same shape, weaker entropy.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
