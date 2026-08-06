import { ParseFailedError } from '@carbon/core';
import type { IntermediateRepresentation } from '@carbon/types';
import type { Parser, ParserContext, ParserInput } from '../parser.js';

/**
 * HAR (HTTP Archive) adapter. Consumes browser/CLI-exported traffic captures.
 * Phase One implements detection + shell; endpoint grouping and schema
 * inference land alongside the state-engine ingestion milestone.
 */
export class HarParser implements Parser {
  readonly name = 'har';
  readonly formats = ['har'] as const;

  canParse(input: ParserInput): boolean {
    if (input.hint === 'har') return true;
    if (input.kind === 'json') {
      return !!(input.content as { log?: { entries?: unknown[] } })?.log?.entries;
    }
    return false;
  }

  async parse(input: ParserInput, ctx: ParserContext): Promise<IntermediateRepresentation> {
    if (input.kind !== 'json') {
      throw new ParseFailedError('HAR parser requires JSON input');
    }
    ctx.logger.debug('parser.har.entries', {
      count: (input.content as { log?: { entries?: unknown[] } })?.log?.entries?.length ?? 0,
    });
    return {
      version: 1,
      api: {
        name: 'Recorded traffic',
        version: '0.0.0',
        source: { kind: 'har', origin: ctx.origin, ingestedAt: 0 },
      },
      servers: [],
      auth: [],
      resources: [],
      endpoints: [],
      relationships: [],
      examples: [],
      meta: {},
    };
  }
}
