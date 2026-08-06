import { InvalidInputError } from '@carbon/core';
import type { IntermediateRepresentation } from '@carbon/types';
import type { Parser, ParserContext, ParserInput } from './parser.js';

/**
 * Routes an input to the first parser that claims it. Order matters — parsers
 * registered first win ties. In practice the CLI registers all built-in
 * parsers with the recorded-traffic parser last so explicit formats always win.
 */
export class ParserRegistry {
  private readonly parsers: Parser[] = [];

  register(parser: Parser): this {
    this.parsers.push(parser);
    return this;
  }

  find(input: ParserInput): Parser | undefined {
    return this.parsers.find((p) => p.canParse(input));
  }

  async parse(input: ParserInput, ctx: ParserContext): Promise<IntermediateRepresentation> {
    const parser = this.find(input);
    if (!parser) {
      throw new InvalidInputError('No parser can handle this input', {
        hint: 'kind' in input ? input.kind : undefined,
      });
    }
    ctx.logger.debug('parser.selected', { parser: parser.name });
    return parser.parse(input, ctx);
  }
}
