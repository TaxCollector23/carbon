import { ParseFailedError } from '@carbon/core';
import type { IntermediateRepresentation } from '@carbon/types';
import type { Parser, ParserContext, ParserInput } from '../parser.js';
import { parseProtoDocument, protoDocumentToIr } from './protobuf.js';

/** gRPC adapter scaffold backed by `.proto` service declarations. */
export class GrpcParser implements Parser {
  readonly name = 'grpc';
  readonly formats = ['grpc'] as const;

  canParse(input: ParserInput): boolean {
    if (input.hint === 'protobuf') return false;
    if (input.hint === 'grpc') return true;
    if (input.kind !== 'text') return false;
    return /\bservice\s+\w+\s*\{[\s\S]*?\brpc\s+\w+\s*\(/.test(input.content);
  }

  async parse(input: ParserInput, ctx: ParserContext): Promise<IntermediateRepresentation> {
    if (input.kind !== 'text') {
      throw new ParseFailedError('gRPC parser requires .proto service text input');
    }
    return protoDocumentToIr(parseProtoDocument(input.content), ctx, 'grpc');
  }
}
