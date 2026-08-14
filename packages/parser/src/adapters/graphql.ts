import { ParseFailedError } from '@carbon/core';
import type {
  EndpointDef,
  EndpointId,
  IntermediateRepresentation,
  JsonType,
  ParamDef,
  RelationshipDef,
  ResourceDef,
  ResourceId,
} from '@carbon/types';
import type { Parser, ParserContext, ParserInput } from '../parser.js';

/**
 * GraphQL SDL adapter.
 *
 * The mapping is deliberate:
 *   - Every non-Query/Mutation/Subscription/Input object type → a resource.
 *   - Query fields returning `[T]` → list endpoints; returning `T` → get.
 *   - Mutation fields → create/update/delete based on name prefix.
 *   - Subscriptions are recorded as `custom` endpoints with SSE semantics
 *     (the runtime will surface these differently in a later milestone).
 *
 * We use a minimal recursive descent parser rather than pulling in the full
 * `graphql` package — it's ~500KB and Carbon only needs the schema shape.
 * `$ref`-free SDL is a much smaller grammar than we're implementing for
 * OpenAPI. If demand grows, swapping for `graphql-js`'s `buildSchema` is a
 * two-line change.
 */
export class GraphQLParser implements Parser {
  readonly name = 'graphql';
  readonly formats = ['graphql'] as const;

  canParse(input: ParserInput): boolean {
    if (input.hint === 'graphql') return true;
    if (input.kind === 'text') {
      const t = input.content;
      return /\btype\s+(Query|Mutation)\b/.test(t) || /\bschema\s*\{/.test(t);
    }
    return false;
  }

  async parse(input: ParserInput, ctx: ParserContext): Promise<IntermediateRepresentation> {
    if (input.kind !== 'text') {
      throw new ParseFailedError('GraphQL parser requires SDL text input');
    }
    const sdl = stripComments(input.content);
    const types = parseTypes(sdl);
    ctx.logger.debug('parser.graphql.types', { count: types.length });

    const resources: ResourceDef[] = [];
    const endpoints: EndpointDef[] = [];
    const relationships: RelationshipDef[] = [];

    const queryType = types.find((t) => t.name === 'Query');
    const mutationType = types.find((t) => t.name === 'Mutation');

    const resourceTypeNames = new Set<string>();
    for (const type of types) {
      if (['Query', 'Mutation', 'Subscription'].includes(type.name)) continue;
      if (type.kind !== 'type') continue;
      resourceTypeNames.add(type.name);
    }

    for (const type of types) {
      if (!resourceTypeNames.has(type.name)) continue;
      const id = type.name.toLowerCase() as ResourceId;
      resources.push({
        id,
        name: type.name,
        primaryKey: type.fields.find((f) => f.name.toLowerCase() === 'id')?.name ?? 'id',
        schema: toJsonType(type),
      });
      // A typed field that points at another resource type becomes a
      // relationship — the same edges the OpenAPI adapter emits when path
      // segments reveal ownership. We infer kind conservatively: scalar
      // (single) references become `references`; list references become
      // `owns`. Downstream `graph` code can refine.
      for (const field of type.fields) {
        if (!resourceTypeNames.has(field.returnType)) continue;
        if (field.returnType === type.name) continue;
        relationships.push({
          from: id,
          to: field.returnType.toLowerCase() as ResourceId,
          kind: field.returnList ? 'owns' : 'references',
          via: field.name,
        });
      }
    }

    if (queryType) {
      for (const field of queryType.fields) {
        endpoints.push(toEndpoint('POST', `/graphql/${field.name}`, field, 'query'));
      }
    }
    if (mutationType) {
      for (const field of mutationType.fields) {
        endpoints.push(toEndpoint('POST', `/graphql/${field.name}`, field, 'mutation'));
      }
    }

    // Also emit REST-style endpoints per resource so consumers that prefer
    // REST get list/get/create/update/delete for free — the runtime's normal
    // REST router serves them from the same StateEngine the GraphQL resolvers
    // read from. Path is `/rest/<plural>` so we never collide with a
    // Query/Mutation field named `products` (which would emit `/graphql/products`).
    // Consumers that only want GraphQL can ignore these — they cost nothing
    // when idle.
    const restPaths = new Set<string>();
    for (const resource of resources) {
      const plural = pluralize(resource.name.toLowerCase());
      const base = `/rest/${plural}`;
      if (restPaths.has(base)) continue;
      restPaths.add(base);
      const item = `${base}/:id`;
      endpoints.push(restEndpoint('GET', base, 'list', resource.id));
      endpoints.push(restEndpoint('POST', base, 'create', resource.id));
      endpoints.push(restEndpoint('GET', item, 'get', resource.id));
      endpoints.push(restEndpoint('PATCH', item, 'update', resource.id));
      endpoints.push(restEndpoint('DELETE', item, 'delete', resource.id));
    }

    return {
      version: 1,
      api: {
        name: 'GraphQL API',
        version: '0.0.0',
        source: { kind: 'graphql', origin: ctx.origin, ingestedAt: 0 },
      },
      servers: [],
      auth: [],
      resources,
      endpoints,
      relationships,
      examples: [],
      meta: { schemaTypes: types.length, graphqlSDL: input.content },
    };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Minimal SDL parser
// ────────────────────────────────────────────────────────────────────────────

interface GqlField {
  name: string;
  args: Array<{ name: string; type: string; required: boolean }>;
  returnType: string;
  returnList: boolean;
  returnRequired: boolean;
}

interface GqlType {
  kind: 'type' | 'input' | 'interface' | 'enum' | 'union';
  name: string;
  fields: GqlField[];
}

function stripComments(sdl: string): string {
  return sdl
    .replace(/#[^\n]*/g, '')
    .replace(/"""[\s\S]*?"""/g, '')
    .replace(/"[^"]*"/g, '""');
}

function parseTypes(sdl: string): GqlType[] {
  const results: GqlType[] = [];
  const re =
    /(type|input|interface|enum|union)\s+(\w+)(?:\s+implements\s+[\w& ]+)?\s*\{([\s\S]*?)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sdl)) !== null) {
    const kind = match[1] as GqlType['kind'];
    const name = match[2]!;
    const body = match[3] ?? '';
    const fields: GqlField[] = [];
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const parsed = parseField(line);
      if (parsed) fields.push(parsed);
    }
    results.push({ kind, name, fields });
  }
  return results;
}

function parseField(line: string): GqlField | null {
  // fieldName(arg: Type!): [ReturnType!]!
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*(?:\((.*?)\))?\s*:\s*(.+?)\s*$/.exec(line);
  if (!match) return null;
  const [, nameRaw, argsRaw, returnRaw] = match;
  const name = nameRaw!;
  const args: GqlField['args'] = [];
  if (argsRaw) {
    for (const raw of splitArgs(argsRaw)) {
      const argMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/.exec(raw.trim());
      if (!argMatch) continue;
      const type = argMatch[2]!.trim();
      args.push({
        name: argMatch[1]!,
        type: type.replace(/[![\]]/g, ''),
        required: type.endsWith('!'),
      });
    }
  }
  const returnRawStr = returnRaw ?? '';
  const returnList = /^\[.+\]/.test(returnRawStr);
  const inner = returnList ? returnRawStr.replace(/^\[|\]!?$/g, '') : returnRawStr;
  return {
    name,
    args,
    returnType: inner.replace(/!$/, ''),
    returnList,
    returnRequired: returnRawStr.endsWith('!'),
  };
}

function splitArgs(raw: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = '';
  for (const c of raw) {
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    if (c === ',' && depth === 0) {
      out.push(buf);
      buf = '';
      continue;
    }
    buf += c;
  }
  if (buf.trim().length > 0) out.push(buf);
  return out;
}

function toEndpoint(
  method: 'POST',
  path: string,
  field: GqlField,
  origin: 'query' | 'mutation',
): EndpointDef {
  const params: ParamDef[] = field.args.map((arg) => ({
    name: arg.name,
    in: 'query',
    required: arg.required,
    schema: { kind: 'unknown' },
  }));
  const returnResource = field.returnType.toLowerCase() as ResourceId;
  return {
    id: `${method}:${path}` as EndpointId,
    method,
    path,
    operation: classifyMutation(origin, field.name, field.returnList),
    resource: returnResource,
    params,
    requestBody: null,
    responses: [],
    auth: [],
    meta: { graphql: origin },
  };
}

function restEndpoint(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  operation: EndpointDef['operation'],
  resource: ResourceId,
): EndpointDef {
  return {
    id: `${method}:${path}` as EndpointId,
    method,
    path,
    operation,
    resource,
    params: path.includes(':id')
      ? [{ name: 'id', in: 'path', required: true, schema: { kind: 'string' } }]
      : [],
    requestBody: null,
    responses: [],
    auth: [],
    meta: { graphql: 'rest-shim' },
  };
}

// Very small pluralizer — mirror of the singularizer in
// packages/ai/src/providers/mock.ts. Covers the common cases; anything
// weirder (person/people, mouse/mice) intentionally not supported.
function pluralize(word: string): string {
  if (word.endsWith('y') && !/[aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  if (word.endsWith('s') || word.endsWith('x') || word.endsWith('z')) return `${word}es`;
  return `${word}s`;
}

function classifyMutation(
  origin: 'query' | 'mutation',
  name: string,
  isList: boolean,
): EndpointDef['operation'] {
  if (origin === 'query') return isList ? 'list' : 'get';
  const lower = name.toLowerCase();
  if (lower.startsWith('create') || lower.startsWith('add')) return 'create';
  if (lower.startsWith('update') || lower.startsWith('edit') || lower.startsWith('patch'))
    return 'update';
  if (lower.startsWith('delete') || lower.startsWith('remove') || lower.startsWith('destroy'))
    return 'delete';
  return 'action';
}

function toJsonType(type: GqlType): JsonType {
  if (type.kind === 'enum') {
    return { kind: 'string' };
  }
  const properties: Record<string, JsonType> = {};
  const required: string[] = [];
  for (const field of type.fields) {
    properties[field.name] = { kind: 'unknown' };
    if (field.returnRequired) required.push(field.name);
  }
  return { kind: 'object', properties, required };
}
