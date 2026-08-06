import type { HttpMethod } from '../common.js';

/**
 * A Recording is the immutable capture of observed API traffic. The parser
 * consumes recordings to synthesize an IR; the runtime replays recordings
 * deterministically.
 */
export interface Recording {
  readonly id: string;
  readonly source: 'proxy' | 'har' | 'sdk-tap';
  readonly startedAt: number;
  readonly endedAt: number;
  readonly exchanges: readonly RecordedExchange[];
}

export interface RecordedExchange {
  readonly id: string;
  readonly request: RecordedRequest;
  readonly response: RecordedResponse;
  readonly latencyMs: number;
  /** Sanitization applied — e.g. redacted auth headers. */
  readonly redactions: readonly string[];
}

export interface RecordedRequest {
  readonly method: HttpMethod;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | null;
  readonly receivedAt: number;
}

export interface RecordedResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | null;
  readonly sentAt: number;
}
