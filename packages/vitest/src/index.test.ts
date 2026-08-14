import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withCarbon, type CarbonHandle } from './index.js';

const spec = {
  openapi: '3.0.0',
  info: { title: 'petstore', version: '0.1.0' },
  paths: {
    '/pets': {
      get: {
        operationId: 'listPets',
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Pet' } },
              },
            },
          },
        },
      },
      post: {
        operationId: 'createPet',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/Pet' } },
          },
        },
        responses: {
          '201': {
            description: 'created',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Pet' } },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Pet: {
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
      },
    },
  },
};

describe('@carbon/vitest smoke', () => {
  let handle: CarbonHandle;

  beforeAll(async () => {
    handle = await withCarbon({ spec: { kind: 'json', content: spec } });
  });

  afterAll(async () => {
    await handle?.stop();
  });

  it('boots, serves POST + GET, and rewind restores prior state', async () => {
    const baseUrl = handle.baseUrl;

    const empty = (await fetch(`${baseUrl}/pets`).then((r) => r.json())) as { data: unknown[] };
    expect(Array.isArray(empty.data)).toBe(true);
    expect(empty.data.length).toBe(0);

    const before = await handle.snapshot('before');

    const created = await fetch(`${baseUrl}/pets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Fido' }),
    });
    expect(created.status).toBeGreaterThanOrEqual(200);
    expect(created.status).toBeLessThan(300);
    const createdBody = (await created.json()) as { id: string; name: string };
    expect(createdBody.name).toBe('Fido');

    const listed = (await fetch(`${baseUrl}/pets`).then((r) => r.json())) as {
      data: Array<{ id: string }>;
    };
    expect(listed.data.some((p) => p.id === createdBody.id)).toBe(true);

    await handle.rewind(before);
    const afterRewind = (await fetch(`${baseUrl}/pets`).then((r) => r.json())) as {
      data: unknown[];
    };
    expect(afterRewind.data.length).toBe(0);
  });
});
