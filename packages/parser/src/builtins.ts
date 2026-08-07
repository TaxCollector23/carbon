import { AsyncApiParser } from './adapters/asyncapi.js';
import { GraphQLParser } from './adapters/graphql.js';
import { GrpcParser } from './adapters/grpc.js';
import { HarParser } from './adapters/har.js';
import { OpenApiParser } from './adapters/openapi.js';
import { PostmanParser } from './adapters/postman.js';
import { ProtobufParser } from './adapters/protobuf.js';
import { ParserRegistry } from './registry.js';

export function createDefaultParserRegistry(): ParserRegistry {
  return new ParserRegistry()
    .register(new OpenApiParser())
    .register(new GraphQLParser())
    .register(new AsyncApiParser())
    .register(new GrpcParser())
    .register(new ProtobufParser())
    .register(new HarParser())
    .register(new PostmanParser());
}
