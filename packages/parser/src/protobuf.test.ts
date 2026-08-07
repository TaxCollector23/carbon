import { describe, expect, it } from 'vitest';
import { NoopLogger } from '@carbon/core';
import { GrpcParser } from './adapters/grpc.js';
import { ProtobufParser } from './adapters/protobuf.js';
import { createParserContext } from './parser.js';

const proto = `
syntax = "proto3";

package carbon.users;

message GetUserRequest {
  string id = 1;
}

message User {
  string id = 1;
  repeated string tags = 2;
}

service Users {
  rpc GetUser (GetUserRequest) returns (User) {
    option (google.api.http) = {
      get: "/v1/users/{id}"
    };
  }
}
`;

describe('ProtobufParser', () => {
  it('parses protobuf messages as resources', async () => {
    const parser = new ProtobufParser();
    const ir = await parser.parse(
      { kind: 'text', hint: 'protobuf', content: proto },
      createParserContext(NoopLogger),
    );

    expect(ir.api.source.kind).toBe('protobuf');
    expect(ir.resources.map((resource) => resource.name)).toEqual(['GetUserRequest', 'User']);
    expect(ir.resources.find((resource) => resource.name === 'User')?.schema).toMatchObject({
      kind: 'object',
      properties: {
        id: { kind: 'string' },
        tags: { kind: 'array', items: { kind: 'string' } },
      },
    });
  });
});

describe('GrpcParser', () => {
  it('parses gRPC services as callable runtime endpoints', async () => {
    const parser = new GrpcParser();
    const ir = await parser.parse(
      { kind: 'text', hint: 'grpc', content: proto },
      createParserContext(NoopLogger),
    );

    expect(ir.api.source.kind).toBe('grpc');
    expect(ir.endpoints).toHaveLength(1);
    expect(ir.endpoints[0]).toMatchObject({
      method: 'POST',
      path: '/grpc/Users/GetUser',
      operation: 'action',
      requestBody: { kind: 'ref', ref: 'GetUserRequest' },
      responses: [{ status: 200, body: { kind: 'ref', ref: 'User' }, headers: {} }],
      meta: {
        grpc: {
          service: 'Users',
          rpc: 'GetUser',
          requestType: 'GetUserRequest',
          responseType: 'User',
          requestStream: false,
          responseStream: false,
        },
        protobufPackage: 'carbon.users',
      },
    });
  });
});
