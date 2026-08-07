import { describe, expect, it } from 'vitest';
import { NoopLogger } from '@carbon/core';
import { AsyncApiParser } from './adapters/asyncapi.js';
import { createParserContext } from './parser.js';

describe('AsyncApiParser', () => {
  it('parses YAML channels into deterministic runtime endpoints', async () => {
    const parser = new AsyncApiParser();
    const ir = await parser.parse(
      {
        kind: 'text',
        hint: 'asyncapi',
        content: `
asyncapi: 2.6.0
info:
  title: User Events
  version: 1.0.0
servers:
  production:
    url: kafka://broker.internal
    description: Production broker
channels:
  users/{userId}/created:
    publish:
      operationId: publishUserCreated
      message:
        name: UserCreated
        payload:
          type: object
          required: [id]
          properties:
            id:
              type: string
            plan:
              type: string
`,
      },
      createParserContext(NoopLogger),
    );

    expect(ir.api.source.kind).toBe('asyncapi');
    expect(ir.api.name).toBe('User Events');
    expect(ir.servers).toEqual([
      { url: 'kafka://broker.internal', description: 'Production broker' },
    ]);
    expect(ir.resources.map((resource) => resource.name)).toEqual(['UserCreated']);
    expect(ir.endpoints).toHaveLength(1);
    expect(ir.endpoints[0]).toMatchObject({
      method: 'POST',
      path: '/asyncapi/users/{userId}/created',
      operation: 'action',
      params: [{ name: 'userId', in: 'path', required: true, schema: { kind: 'string' } }],
    });
    expect(ir.endpoints[0]?.requestBody).toMatchObject({
      kind: 'object',
      required: ['id'],
    });
  });
});
