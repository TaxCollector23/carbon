import { describe, expect, it } from 'vitest';
import { NoopLogger } from '@carbon/core';
import { GraphQLParser } from './adapters/graphql.js';
import { createParserContext } from './parser.js';

const sdl = `
type Query {
  customer(id: ID!): Customer
  customers(limit: Int): [Customer!]!
}

type Mutation {
  createCustomer(input: CustomerInput!): Customer!
  updateCustomer(id: ID!, input: CustomerInput!): Customer!
  deleteCustomer(id: ID!): Boolean!
}

type Customer {
  id: ID!
  name: String!
  email: String!
}

input CustomerInput {
  name: String!
  email: String!
}
`;

describe('GraphQLParser', () => {
  it('maps queries and mutations to endpoints and types to resources', async () => {
    const parser = new GraphQLParser();
    const ir = await parser.parse({ kind: 'text', content: sdl }, createParserContext(NoopLogger));

    expect(ir.resources.map((r) => r.name).sort()).toEqual(['Customer']);

    const ops = new Map(ir.endpoints.map((e) => [e.path, e.operation]));
    expect(ops.get('/graphql/customer')).toBe('get');
    expect(ops.get('/graphql/customers')).toBe('list');
    expect(ops.get('/graphql/createCustomer')).toBe('create');
    expect(ops.get('/graphql/updateCustomer')).toBe('update');
    expect(ops.get('/graphql/deleteCustomer')).toBe('delete');
  });
});
