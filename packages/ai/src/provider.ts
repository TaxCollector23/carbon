import type { Logger } from '@carbon/core';
import type { z } from 'zod';

/**
 * The AI layer is intentionally abstracted so Carbon's runtime never depends
 * on a specific provider. Providers are only invoked during ingestion,
 * analysis, documentation understanding, and developer assistance — never in
 * the request path of an emulator.
 *
 * All calls are typed: consumers pass a Zod schema; the provider is expected
 * to return an object that conforms. This keeps prompt shape and response
 * shape colocated and gives the ingestion pipeline a strongly-typed edge.
 */
export interface AiProvider {
  readonly name: string;
  readonly defaultModel: string;

  /** Free-form completion for narrative outputs (explanations, docs). */
  complete(req: CompletionRequest): Promise<CompletionResponse>;

  /** Structured completion — the primary path for ingestion tasks. */
  structured<T>(req: StructuredRequest<T>): Promise<T>;
}

export interface CompletionRequest {
  readonly model?: string;
  readonly system?: string;
  readonly messages: readonly ChatMessage[];
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly signal?: AbortSignal;
  /**
   * Attribution context threaded through from the ingestion pipeline. The
   * provider echoes this back on the {@link UsageEvent} so `onUsage` can meter
   * the call against the caller's org rather than a globally-pinned one.
   */
  readonly context?: AiCallContext;
}

export interface AiCallContext {
  readonly orgId?: string;
  readonly projectId?: string;
}

export interface CompletionResponse {
  readonly text: string;
  readonly model: string;
  readonly usage: TokenUsage;
}

export interface StructuredRequest<T> extends Omit<CompletionRequest, 'messages'> {
  readonly instruction: string;
  readonly input: unknown;
  readonly schema: z.ZodType<T, z.ZodTypeDef, unknown>;
}

export interface ChatMessage {
  readonly role: 'user' | 'assistant' | 'system';
  readonly content: string;
}

export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface AiProviderOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly defaultModel?: string;
  readonly logger: Logger;
  /**
   * Fired once per successful upstream call. Used by the API to emit
   * `usage.ai.call` events for billing / observability. Failures must not
   * throw — the callback runs after the response is materialized and its
   * result is not part of the caller's success path.
   */
  readonly onUsage?: (event: UsageEvent) => void;
}

export interface UsageEvent {
  readonly provider: string;
  readonly model: string;
  readonly usage: TokenUsage;
  readonly latencyMs: number;
  /**
   * Attribution context supplied by the call site (typically the ingestion
   * pipeline). Absent for callers that do not thread org context — the
   * fallback path in `apps/api` pins by `CARBON_METER_ORG_ID` in that case.
   */
  readonly context?: AiCallContext;
}
