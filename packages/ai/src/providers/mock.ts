import { NoopLogger, type Logger } from '@carbon/core';
import type {
  AiProvider,
  CompletionRequest,
  CompletionResponse,
  StructuredRequest,
} from '../provider.js';

/**
 * Deterministic, dependency-free `AiProvider` for tests and CI. It answers
 * `structured()` calls by generating a small set of candidate payloads and
 * returning the first one that satisfies the caller's Zod schema.
 *
 * The two candidates that matter for the ingestion pipeline:
 *
 *  - Resource inference — derives resources from the input IR's endpoint
 *    paths (`/pets` → `pet`, `/pets/{id}/tags` → `pet_tag`).
 *  - Judge verdict — always `{ score: 0.9, issues: [] }`.
 *
 * Callers that need something specific — a low judge score, a different set
 * of resources — install an override with `provider.reply(pattern, response)`.
 * The pattern is matched against the request's `instruction` string.
 */
export interface MockAiProviderOptions {
  readonly defaultModel?: string;
  readonly logger?: Logger;
}

interface Override {
  readonly pattern: string | RegExp;
  readonly response: unknown;
}

export class MockAiProvider implements AiProvider {
  readonly name = 'mock';
  readonly defaultModel: string;
  private readonly logger: Logger;
  private readonly overrides: Override[] = [];

  constructor(opts: MockAiProviderOptions = {}) {
    this.defaultModel = opts.defaultModel ?? 'mock-1';
    this.logger = (opts.logger ?? NoopLogger).child({ provider: this.name });
  }

  /**
   * Install a canned response returned whenever the request instruction
   * contains `pattern`. Overrides are tried in registration order; the first
   * one whose response validates against the request schema wins.
   */
  reply(pattern: string | RegExp, response: unknown): this {
    this.overrides.push({ pattern, response });
    return this;
  }

  /** Clear all installed overrides. Useful between tests. */
  resetOverrides(): void {
    this.overrides.length = 0;
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const flat = req.messages.map((m) => m.content).join(' ').slice(0, 200);
    return {
      text: `mock completion: ${flat}`,
      model: req.model ?? this.defaultModel,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }

  async structured<T>(req: StructuredRequest<T>): Promise<T> {
    // 1. Try overrides first — the escape hatch tests use to steer verdicts.
    for (const o of this.overrides) {
      if (!matches(o.pattern, req.instruction)) continue;
      const parsed = req.schema.safeParse(o.response);
      if (parsed.success) return parsed.data;
      this.logger.debug('mock.override_schema_mismatch', {
        pattern: String(o.pattern),
        issues: parsed.error.issues,
      });
    }

    // 2. Fall back to deterministic candidates keyed off the input shape.
    for (const candidate of buildCandidates(req.input)) {
      const parsed = req.schema.safeParse(candidate);
      if (parsed.success) return parsed.data;
    }

    throw new Error(
      'MockAiProvider: no built-in candidate matched the requested schema; ' +
        'install a reply() override for this instruction.',
    );
  }
}

function matches(pattern: string | RegExp, text: string): boolean {
  return typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text);
}

function buildCandidates(input: unknown): unknown[] {
  const resources = deriveResources(input);
  return [
    // Resource inference (`capabilities.inferResources`).
    { resources },
    // Relationship inference — the mock never invents relationships.
    { relationships: [] },
    // Judge verdict for resources or relationships.
    { score: 0.9, issues: [] },
    // NL → error-injection rules; capabilities has its own regex fallback,
    // but returning an empty set is a valid, well-formed answer.
    { rules: [] },
    // Seed data generator.
    { data: deriveSeedData(input) },
  ];
}

interface IrLikeEndpoint {
  readonly path?: string;
}
interface IrLike {
  readonly endpoints?: readonly IrLikeEndpoint[];
}

function deriveResources(input: unknown): Array<{
  id: string;
  name: string;
  primaryKey: string;
  schema: { kind: 'unknown' };
}> {
  const src = input as { ir?: IrLike } | null | undefined;
  const endpoints = src?.ir?.endpoints ?? [];
  const seen = new Set<string>();
  for (const ep of endpoints) {
    if (typeof ep?.path !== 'string') continue;
    const name = pathToResourceName(ep.path);
    if (name) seen.add(name);
  }
  return [...seen].map((name) => ({
    id: name,
    name,
    primaryKey: 'id',
    schema: { kind: 'unknown' as const },
  }));
}

/**
 * `/pets` → `pet`, `/pets/{id}/tags` → `pet_tag`, `/api/v1/users` → `api_v1_user`.
 * Placeholder segments (`{id}`, `:id`) are dropped so the result reflects the
 * resource hierarchy rather than the URL template.
 */
export function pathToResourceName(path: string): string | null {
  const parts = path
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('{') && !s.startsWith(':'));
  if (parts.length === 0) return null;
  return parts.map(singularize).join('_');
}

function singularize(word: string): string {
  const w = word.toLowerCase();
  if (w.length > 3 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.endsWith('sses')) return w.slice(0, -2);
  if (w.length > 1 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) {
    return w.slice(0, -1);
  }
  return w;
}

function deriveSeedData(input: unknown): Record<string, Array<Record<string, unknown>>> {
  const src = input as { resources?: readonly { name?: string }[] } | null | undefined;
  const out: Record<string, Array<Record<string, unknown>>> = {};
  for (const r of src?.resources ?? []) {
    if (r?.name) out[r.name] = [];
  }
  return out;
}
