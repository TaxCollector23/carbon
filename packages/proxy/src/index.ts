import type { Logger } from '@carbon/core';
import type { Recording, RecordedExchange } from '@carbon/types';

/**
 * Recording proxy interfaces. The concrete forward-proxy + TLS-intercept
 * implementation lands in a later milestone. This package fixes the shape so
 * downstream packages (ingestion, storage) can be built now.
 */
export interface RecordingProxy {
  start(opts: ProxyStartOptions): Promise<ProxyHandle>;
}

export interface ProxyStartOptions {
  readonly target: string;
  readonly port?: number;
  readonly redactHeaders?: readonly string[];
  readonly onExchange?: (exchange: RecordedExchange) => void;
  readonly logger?: Logger;
}

export interface ProxyHandle {
  readonly url: string;
  stop(): Promise<Recording>;
}

export const DEFAULT_REDACT_HEADERS = ['authorization', 'x-api-key', 'cookie', 'set-cookie'] as const;
