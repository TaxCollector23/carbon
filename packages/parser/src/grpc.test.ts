import { describe, expect, it } from 'vitest';
import { NoopLogger } from '@carbon/core';
import { GrpcParser } from './adapters/grpc.js';
import { createParserContext } from './parser.js';

describe('GrpcParser', () => {
  it('maps gRPC services to endpoints and preserves streaming metadata', async () => {
    const parser = new GrpcParser();
    const ir = await parser.parse(
      {
        kind: 'text',
        content: `
          syntax = "proto3";
          package carbon.events.v1;

          message EventRequest {
            string account_id = 1;
          }

          message Event {
            string id = 1;
          }

          service EventService {
            rpc StreamEvents (EventRequest) returns (stream Event);
          }
        `,
      },
      createParserContext(NoopLogger),
    );

    expect(ir.api.source.kind).toBe('grpc');
    expect(ir.endpoints[0]).toMatchObject({
      method: 'POST',
      path: '/grpc/EventService/StreamEvents',
      meta: {
        grpc: {
          service: 'EventService',
          rpc: 'StreamEvents',
          requestType: 'EventRequest',
          responseType: 'Event',
          requestStream: false,
          responseStream: true,
        },
      },
    });
  });
});
