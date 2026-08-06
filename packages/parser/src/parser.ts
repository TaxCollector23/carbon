import type { Logger } from '@carbon/core';
import type { IntermediateRepresentation } from '@carbon/types';

/**
 * Every input format Carbon supports is expressed through a Parser. Parsers
 * are pure — given the same input bytes they always produce the same IR.
 *
 * A parser advertises the input kinds it can accept via `canParse`; the
 * ParserRegistry uses this to route inputs. Parsers must never perform network
 * I/O — that is the ingestion package's responsibility.
 */
export interface Parser<Input = ParserInput> {
  readonly name: string;
  readonly formats: readonly ParserFormat[];
  canParse(input: Input): boolean;
  parse(input: Input, ctx: ParserContext): Promise<IntermediateRepresentation>;
}

export type ParserFormat = 'openapi' | 'swagger' | 'graphql' | 'har' | 'postman' | 'traffic';

export interface ParserContext {
  readonly logger: Logger;
  readonly origin?: string;
  /**
   * Parsers may emit non-fatal warnings — malformed examples, unresolved refs,
   * ambiguous relationships. The ingestion layer surfaces these to the user.
   */
  warn(message: string, details?: Record<string, unknown>): void;
}

export type ParserInput =
  | { readonly kind: 'text'; readonly content: string; readonly hint?: ParserFormat }
  | { readonly kind: 'json'; readonly content: unknown; readonly hint?: ParserFormat }
  | { readonly kind: 'binary'; readonly content: Uint8Array; readonly hint?: ParserFormat };

export function createParserContext(logger: Logger, origin?: string): ParserContext {
  const warnings: Array<{ message: string; details?: Record<string, unknown> }> = [];
  return {
    logger,
    origin,
    warn(message, details) {
      warnings.push({ message, details });
      logger.warn(message, details);
    },
  };
}
