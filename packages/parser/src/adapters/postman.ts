import { ParseFailedError } from '@carbon/core';
import type { IntermediateRepresentation } from '@carbon/types';
import type { Parser, ParserContext, ParserInput } from '../parser.js';

/** Postman Collection v2.1 adapter shell. */
export class PostmanParser implements Parser {
  readonly name = 'postman';
  readonly formats = ['postman'] as const;

  canParse(input: ParserInput): boolean {
    if (input.hint === 'postman') return true;
    if (input.kind === 'json') {
      const schema = (input.content as { info?: { schema?: string } })?.info?.schema;
      return typeof schema === 'string' && schema.includes('postman.com/json/collection');
    }
    return false;
  }

  async parse(input: ParserInput, ctx: ParserContext): Promise<IntermediateRepresentation> {
    if (input.kind !== 'json') throw new ParseFailedError('Postman parser requires JSON input');
    return {
      version: 1,
      api: {
        name:
          (input.content as { info?: { name?: string } })?.info?.name ?? 'Postman Collection',
        version: '0.0.0',
        source: { kind: 'postman', origin: ctx.origin, ingestedAt: 0 },
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
