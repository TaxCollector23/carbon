import { describe, expect, it } from 'vitest';
import { NoopLogger } from '@carbon/core';
import { OpenApiParser } from './adapters/openapi.js';
import { createParserContext } from './parser.js';

describe('OpenApiParser', () => {
  it('extracts params, request bodies, responses and follows $refs', async () => {
    const parser = new OpenApiParser();
    const ir = await parser.parse(
      {
        kind: 'json',
        hint: 'openapi',
        content: {
          openapi: '3.0.0',
          info: { title: 'Petstore', version: '1' },
          components: {
            schemas: {
              Pet: {
                type: 'object',
                required: ['id', 'name'],
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  tags: { type: 'array', items: { type: 'string' } },
                },
              },
            },
            securitySchemes: {
              bearerAuth: { type: 'http', scheme: 'bearer' },
              apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' },
            },
          },
          paths: {
            '/pets': {
              get: {
                tags: ['Pet'],
                parameters: [
                  { name: 'limit', in: 'query', required: false, schema: { type: 'integer' } },
                ],
                responses: {
                  '200': {
                    description: 'ok',
                    content: {
                      'application/json': {
                        schema: { type: 'array', items: { $ref: '#/components/schemas/Pet' } },
                        example: [{ id: '1', name: 'Ada' }],
                      },
                    },
                  },
                },
              },
              post: {
                tags: ['Pet'],
                security: [{ bearerAuth: [] }],
                requestBody: {
                  content: {
                    'application/json': { schema: { $ref: '#/components/schemas/Pet' } },
                  },
                },
                responses: { '201': { description: 'created' } },
              },
            },
          },
        },
      },
      createParserContext(NoopLogger),
    );

    expect(ir.api.name).toBe('Petstore');
    expect(ir.endpoints).toHaveLength(2);
    expect(ir.resources.map((r) => r.name)).toEqual(['Pet']);

    const list = ir.endpoints.find((e) => e.method === 'GET')!;
    expect(list.params[0]).toMatchObject({ name: 'limit', in: 'query', required: false });
    expect(list.responses[0]?.status).toBe(200);
    expect(list.responses[0]?.body).toMatchObject({ kind: 'array' });

    const create = ir.endpoints.find((e) => e.method === 'POST')!;
    expect(create.requestBody).toMatchObject({ kind: 'object' });
    expect(create.auth).toContain('bearerAuth');

    expect(ir.auth.map((a) => a.kind).sort()).toEqual(['api-key', 'bearer']);
    expect(ir.examples).toHaveLength(1);
  });

  it('infers ownership relationships from nested paths', async () => {
    const parser = new OpenApiParser();
    const ir = await parser.parse(
      {
        kind: 'json',
        hint: 'openapi',
        content: {
          openapi: '3.0.0',
          info: { title: 'API', version: '1' },
          paths: {
            '/customers/{id}/subscriptions': {
              get: { responses: { '200': { description: 'ok' } } },
            },
          },
        },
      },
      createParserContext(NoopLogger),
    );

    const owns = ir.relationships.find((r) => r.kind === 'owns');
    const belongs = ir.relationships.find((r) => r.kind === 'belongs-to');
    expect(owns).toMatchObject({ from: 'customer', to: 'subscription' });
    expect(belongs).toMatchObject({ from: 'subscription', to: 'customer' });
  });
});
