import {
  buildSchema,
  graphql,
  type GraphQLField,
  type GraphQLObjectType,
  type GraphQLSchema,
} from 'graphql';
import type { FastifyInstance } from 'fastify';
import type { ResourceId } from '@carbon/types';
import type { RuntimeContext } from './runtime.js';

/**
 * Fastify plugin that mounts `POST /graphql` when the IR was produced from a
 * GraphQL SDL. Resolvers dispatch to the same `StateEngine` that the REST
 * routes use, so a mutation issued through `/graphql` is visible to a
 * subsequent REST call and vice versa.
 *
 * The synthesis rules are intentionally rigid — they mirror the CRUD
 * conventions the parser already assumes:
 *
 *   Query.<resource>(id: ID!)       → state.read('<resource>', id)
 *   Query.<resource>s(limit, cursor) → state.list('<resource>', ...)
 *   Mutation.create<Resource>(input)         → state.create('<resource>', input)
 *   Mutation.update<Resource>(id, input)     → state.update('<resource>', id, input)
 *   Mutation.delete<Resource>(id: ID!)       → state.delete('<resource>', id)
 *
 * We don't try to be a general GraphQL server — the goal is to give the
 * emulator a truthful surface for the same operations the SDL declares.
 */
export async function registerGraphQL(app: FastifyInstance, ctx: RuntimeContext): Promise<void> {
  const sdl = extractSdl(ctx);
  if (!sdl) return;

  let schema: GraphQLSchema;
  try {
    schema = buildSchema(sdl);
  } catch (err) {
    ctx.logger.warn('runtime.graphql.build_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const rootValue = buildRootValue(schema, ctx);

  app.post('/graphql', async (req, reply) => {
    const body = (req.body ?? {}) as {
      query?: string;
      variables?: Record<string, unknown>;
      operationName?: string;
    };
    if (typeof body.query !== 'string' || body.query.length === 0) {
      reply.status(400);
      return {
        errors: [{ message: 'Request body must include a non-empty `query` string.' }],
      };
    }
    const result = await graphql({
      schema,
      source: body.query,
      rootValue,
      variableValues: body.variables ?? {},
      operationName: body.operationName ?? undefined,
    });
    return result;
  });
}

function extractSdl(ctx: RuntimeContext): string | null {
  const raw = ctx.ir.meta['graphqlSDL'];
  if (typeof raw === 'string' && raw.trim().length > 0) return raw;
  if (ctx.ir.api.source.kind !== 'graphql') return null;
  // Fallback: reconstruct a minimal SDL from the IR shape so REST-only
  // emulators built from a graphql source still get a `/graphql` surface.
  return synthesizeSdl(ctx);
}

function synthesizeSdl(ctx: RuntimeContext): string | null {
  const resources = ctx.ir.resources;
  if (resources.length === 0) return null;
  const typeBlocks = resources.map((r) => {
    // We know very little about field types at this point — degrade to
    // scalar `String` so buildSchema succeeds.
    const fields = Object.keys(
      (r.schema.kind === 'object' && r.schema.properties) || { id: null },
    );
    const decls = fields.length > 0 ? fields.map((f) => `  ${f}: String`).join('\n') : '  id: ID';
    return `type ${r.name} {\n${decls}\n}`;
  });
  const queryFields: string[] = [];
  const mutationFields: string[] = [];
  for (const r of resources) {
    const single = r.name.charAt(0).toLowerCase() + r.name.slice(1);
    const plural = `${single}s`;
    queryFields.push(`  ${single}(id: ID!): ${r.name}`);
    queryFields.push(`  ${plural}(limit: Int, cursor: String): [${r.name}!]!`);
    mutationFields.push(`  create${r.name}(input: JSONObject): ${r.name}`);
    mutationFields.push(`  update${r.name}(id: ID!, input: JSONObject): ${r.name}`);
    mutationFields.push(`  delete${r.name}(id: ID!): Boolean`);
  }
  return [
    'scalar JSONObject',
    `type Query {\n${queryFields.join('\n')}\n}`,
    `type Mutation {\n${mutationFields.join('\n')}\n}`,
    ...typeBlocks,
  ].join('\n\n');
}

interface ResolverArgs {
  readonly id?: string;
  readonly input?: Record<string, unknown>;
  readonly limit?: number;
  readonly cursor?: string;
  readonly [k: string]: unknown;
}

type Resolver = (args: ResolverArgs) => Promise<unknown> | unknown;

function buildRootValue(schema: GraphQLSchema, ctx: RuntimeContext): Record<string, Resolver> {
  const root: Record<string, Resolver> = {};
  const resourceByName = new Map<string, ResourceId>();
  for (const r of ctx.ir.resources) resourceByName.set(r.name, r.id);

  const query = schema.getQueryType();
  if (query) attachResolvers(query, 'query', root, resourceByName, ctx);
  const mutation = schema.getMutationType();
  if (mutation) attachResolvers(mutation, 'mutation', root, resourceByName, ctx);
  return root;
}

function attachResolvers(
  type: GraphQLObjectType,
  origin: 'query' | 'mutation',
  root: Record<string, Resolver>,
  resourceByName: Map<string, ResourceId>,
  ctx: RuntimeContext,
): void {
  const fields = type.getFields();
  for (const fieldName of Object.keys(fields)) {
    const field = fields[fieldName]!;
    const resolver = origin === 'query'
      ? buildQueryResolver(field, resourceByName, ctx)
      : buildMutationResolver(field, fieldName, resourceByName, ctx);
    if (resolver) root[fieldName] = resolver;
  }
}

function unwrapReturnTypeName(field: GraphQLField<unknown, unknown>): { name: string; list: boolean } {
  let t = field.type as { toString(): string; ofType?: unknown };
  let list = false;
  // Walk NonNull/List wrappers by stringifying and inspecting — the
  // graphql-js typeguards work too but this stays dependency-free of the
  // library's runtime introspection tags.
  const str = t.toString();
  if (str.startsWith('[')) list = true;
  const inner = str.replace(/[![\]]/g, '');
  return { name: inner, list };
}

function buildQueryResolver(
  field: GraphQLField<unknown, unknown>,
  resourceByName: Map<string, ResourceId>,
  ctx: RuntimeContext,
): Resolver | null {
  const { name: returnTypeName, list } = unwrapReturnTypeName(field);
  const resource = resourceByName.get(returnTypeName);
  if (!resource) return null;
  if (list) {
    return async (args) => {
      const result = await ctx.state.list(resource, {
        limit: typeof args.limit === 'number' ? args.limit : undefined,
        cursor: typeof args.cursor === 'string' ? args.cursor : undefined,
      });
      return result.items.map((r) => r.data);
    };
  }
  return async (args) => {
    if (typeof args.id !== 'string') return null;
    const record = await ctx.state.read(resource, args.id);
    return record ? record.data : null;
  };
}

const MUTATION_PREFIXES = ['create', 'add', 'update', 'edit', 'patch', 'delete', 'remove', 'destroy'];

function buildMutationResolver(
  field: GraphQLField<unknown, unknown>,
  fieldName: string,
  resourceByName: Map<string, ResourceId>,
  ctx: RuntimeContext,
): Resolver | null {
  const prefix = MUTATION_PREFIXES.find((p) => fieldName.startsWith(p));
  if (!prefix) return null;
  // Resolve the target resource: prefer the return type; fall back to
  // stripping the prefix from the field name (delete* returns Boolean).
  const { name: returnTypeName } = unwrapReturnTypeName(field);
  const resourceId =
    resourceByName.get(returnTypeName) ??
    resourceByName.get(fieldName.slice(prefix.length));
  if (!resourceId) return null;

  if (prefix === 'create' || prefix === 'add') {
    return async (args) => {
      const value = (args.input as Record<string, unknown>) ?? args;
      const created = await ctx.state.create(resourceId, value);
      return created.data;
    };
  }
  if (prefix === 'update' || prefix === 'edit' || prefix === 'patch') {
    return async (args) => {
      if (typeof args.id !== 'string') return null;
      const value = (args.input as Record<string, unknown>) ?? {};
      const updated = await ctx.state.update(resourceId, args.id, value);
      return updated.data;
    };
  }
  // delete / remove / destroy
  return async (args) => {
    if (typeof args.id !== 'string') return false;
    await ctx.state.delete(resourceId, args.id);
    return true;
  };
}
