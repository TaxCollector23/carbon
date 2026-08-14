import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NoopLogger } from '@carbon/core';
import { BehaviorGraphBuilder } from '@carbon/graph';
import { GraphQLParser, createParserContext } from '@carbon/parser';
import { InMemoryStateEngine } from '@carbon/state';
import { createRuntime, type Runtime } from './runtime.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(HERE, '../../../benchmarks/fixtures/store.graphql');

async function bootFromSdl(): Promise<Runtime> {
  const sdl = await readFile(FIXTURE, 'utf8');
  const ir = await new GraphQLParser().parse(
    { kind: 'text', content: sdl },
    createParserContext(NoopLogger),
  );
  const graph = new BehaviorGraphBuilder().build(ir);
  const state = new InMemoryStateEngine();
  return createRuntime({ ir, graph, state });
}

async function gql(
  rt: Runtime,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<{
  data?: Record<string, unknown> | null;
  errors?: Array<{ message: string }>;
}> {
  const res = await rt.app.inject({
    method: 'POST',
    url: '/graphql',
    payload: { query, variables },
    headers: { 'content-type': 'application/json' },
  });
  return res.json() as never;
}

describe('runtime graphql', () => {
  let rt: Runtime | null = null;
  afterEach(async () => {
    if (rt) await rt.close();
    rt = null;
  });

  it('answers an introspection ping', async () => {
    rt = await bootFromSdl();
    const res = await gql(rt, '{ __schema { queryType { name } mutationType { name } } }');
    expect(res.errors).toBeUndefined();
    expect(res.data).toMatchObject({
      __schema: { queryType: { name: 'Query' }, mutationType: { name: 'Mutation' } },
    });
  });

  it('round-trips a mutation and a subsequent query through shared state', async () => {
    rt = await bootFromSdl();
    const create = await gql(
      rt,
      `mutation ($input: ProductInput!) {
         createProduct(input: $input) { id name priceCents }
       }`,
      { input: { name: 'Widget', priceCents: 499 } },
    );
    expect(create.errors).toBeUndefined();
    const created = (create.data as { createProduct: { id: string; name: string } }).createProduct;
    expect(created.name).toBe('Widget');
    expect(typeof created.id).toBe('string');

    const fetched = await gql(rt, `query ($id: ID!) { product(id: $id) { id name priceCents } }`, {
      id: created.id,
    });
    expect(fetched.errors).toBeUndefined();
    expect((fetched.data as { product: { name: string } }).product.name).toBe('Widget');

    const listed = await gql(rt, `{ products { id name } }`);
    expect(listed.errors).toBeUndefined();
    expect((listed.data as { products: unknown[] }).products).toHaveLength(1);
  });

  it('shares state with the REST surface', async () => {
    rt = await bootFromSdl();
    // Create through GraphQL, read through the /rest/products endpoint the
    // parser auto-emitted — same StateEngine underneath.
    const create = await gql(
      rt,
      `mutation { createProduct(input: { name: "Gadget", priceCents: 999 }) { id } }`,
    );
    const id = (create.data as { createProduct: { id: string } }).createProduct.id;

    const rest = await rt.app.inject({ method: 'GET', url: '/rest/products' });
    expect(rest.statusCode).toBe(200);
    const data = (rest.json() as { data: Array<{ id: string }> }).data;
    expect(data.some((r) => r.id === id)).toBe(true);
  });

  it('deletes a record and reflects the change on a follow-up query', async () => {
    rt = await bootFromSdl();
    const create = await gql(
      rt,
      `mutation { createProduct(input: { name: "Ephemeral", priceCents: 1 }) { id } }`,
    );
    const id = (create.data as { createProduct: { id: string } }).createProduct.id;
    const del = await gql(rt, `mutation ($id: ID!) { deleteProduct(id: $id) }`, { id });
    expect((del.data as { deleteProduct: boolean }).deleteProduct).toBe(true);
    const missing = await gql(rt, `query ($id: ID!) { product(id: $id) { id } }`, { id });
    expect((missing.data as { product: unknown }).product).toBeNull();
  });

  it('returns a 400 when the request body has no query', async () => {
    rt = await bootFromSdl();
    const res = await rt.app.inject({
      method: 'POST',
      url: '/graphql',
      payload: {},
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
  });
});
