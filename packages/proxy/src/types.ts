import type { Logger } from '@carbon/core';
import type { Recording, RecordedExchange } from '@carbon/types';

/**
 * Recording proxy contract.
 *
 * The default implementation (`HttpRecordingProxy`) is a plain forward proxy
 * for cleartext HTTP. TLS interception (MITM with a locally-trusted CA) is a
 * separate class shipped in a later milestone — the interface is identical so
 * the CLI/SDK do not know which is running.
 */
export interface RecordingProxy {
  start(opts: ProxyStartOptions): Promise<ProxyHandle>;
}

export interface ProxyStartOptions {
  readonly target: string;
  readonly port?: number;
  readonly host?: string;
  readonly redactHeaders?: readonly string[];
  readonly onExchange?: (exchange: RecordedExchange) => void;
  readonly logger?: Logger;
  /** Maximum body size to capture, in bytes. Larger bodies are truncated. */
  readonly maxBodyBytes?: number;
}

export interface ProxyHandle {
  readonly url: string;
  readonly recordingId: string;
  stop(): Promise<Recording>;
}

export const DEFAULT_REDACT_HEADERS = [
  'authorization',
  'x-api-key',
  'cookie',
  'set-cookie',
  'proxy-authorization',
] as const;
