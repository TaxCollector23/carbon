import { ParseFailedError } from '@carbon/core';
import type {
  EndpointDef,
  EndpointId,
  ExampleDef,
  HttpMethod,
  IntermediateRepresentation,
  JsonType,
  ParamDef,
  RelationshipDef,
  ResourceDef,
  ResourceId,
  ResponseDef,
} from '@carbon/types';
import type { Parser, ParserContext, ParserInput } from '../parser.js';

/**
 * OpenAPI 3.x adapter.
 *
 * The parser walks the document once and produces:
 *   - endpoints, with typed params / requestBody / responses
 *   - resources, inferred from tags first and path shape second
 *   - relationships, inferred from path nesting (/customers/{id}/subscriptions)
 *   - examples, harvested from responses when present
 *
 * `$ref` resolution is single-pass, non-recursive on cycles — cycles collapse
 * to `{ kind: 'unknown' }` so the graph builder never hangs.
 *
 * We deliberately do not carry every OpenAPI construct into the IR. The IR is
 * the contract every downstream stage relies on; keeping it minimal is a
 * feature, not an oversight.
 */
export class OpenApiParser implements Parser {
  readonly name = 'openapi';
  readonly formats = ['openapi', 'swagger'] as const;

  canParse(input: ParserInput): boolean {
    if (input.hint === 'openapi' || input.hint === 'swagger') return true;
    if (input.kind === 'json') {
      const c = input.content as { openapi?: unknown; swagger?: unknown } | null;
      return !!c && (typeof c.openapi === 'string' || typeof c.swagger === 'string');
    }
    if (input.kind === 'text') {
      return /"openapi"\s*:|"swagger"\s*:/.test(input.content);
    }
    return false;
  }

  async parse(input: ParserInput, ctx: ParserContext): Promise<IntermediateRepresentation> {
    const doc = normalize(input);
    if (!isObject(doc)) throw new ParseFailedError('OpenAPI root must be an object');

    const info = (doc.info as { title?: string; version?: string } | undefined) ?? {};
    const paths = (doc.paths as Record<string, Record<string, unknown>> | undefined) ?? {};
    const resolver = createResolver(doc);

    const endpoints: EndpointDef[] = [];
    const examples: ExampleDef[] = [];
    const resourceByName = new Map<string, ResourceDef>();
    const relationshipKeys = new Set<string>();
    const relationships: RelationshipDef[] = [];

    for (const [path, methods] of Object.entries(paths)) {
      if (!isObject(methods)) continue;
      for (const [method, op] of Object.entries(methods)) {
        const upper = method.toUpperCase();
        if (!isMethod(upper)) continue;
        if (!isObject(op)) continue;

        const params = extractParams(op, methods, resolver, ctx);
        const requestBody = extractRequestBody(op, resolver);
        const responses = extractResponses(op, resolver);
        const resourceName = pickResourceName(op, path);
        const resourceId = resourceName ? asResourceId(resourceName) : null;

        if (resourceId) ensureResource(resourceByName, resourceId, resourceName!);

        const endpoint: EndpointDef = {
          id: `${upper}:${path}` as EndpointId,
          method: upper,
          path,
          operation: inferOperation(upper, path),
          resource: resourceId,
          params,
          requestBody,
          responses,
          auth: extractAuth(op, doc),
          meta: {
            operationId: (op as { operationId?: string }).operationId,
            summary: (op as { summary?: string }).summary,
            tags: ((op as { tags?: string[] }).tags ?? []) as readonly string[],
            deprecated: (op as { deprecated?: boolean }).deprecated ?? false,
          },
        };
        endpoints.push(endpoint);

        harvestExamples(endpoint, op, resolver, examples);
      }

      // Path shape → relationships. `/customers/{id}/subscriptions` means
      // Subscription belongs-to Customer.
      inferRelationshipsFromPath(path, resourceByName, relationshipKeys, relationships);
    }

    return {
      version: 1,
      api: {
        name: info.title ?? 'Untitled API',
        version: info.version ?? '0.0.0',
        source: {
          kind: 'openapi',
          origin: ctx.origin,
          ingestedAt: 0, // stamped by the ingestion layer
        },
      },
      servers: extractServers(doc),
      auth: extractAuthSchemes(doc),
      resources: Array.from(resourceByName.values()),
      endpoints,
      relationships,
      examples,
      meta: {
        openapiVersion: (doc.openapi as string | undefined) ?? (doc.swagger as string | undefined),
      },
    };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// $ref resolution
// ────────────────────────────────────────────────────────────────────────────

interface Resolver {
  resolve(node: unknown, visited?: Set<string>): unknown;
  schemaToJsonType(node: unknown, visited?: Set<string>): JsonType;
}

function createResolver(root: unknown): Resolver {
  const seen = new WeakMap<object, unknown>();

  const followRef = (ref: string, visited: Set<string>): unknown => {
    if (!ref.startsWith('#/')) return null;
    if (visited.has(ref)) return null;
    const path = ref.slice(2).split('/');
    let cur: unknown = root;
    for (const seg of path) {
      if (!isObject(cur)) return null;
      cur = cur[decodeSegment(seg)];
    }
    return cur;
  };

  const resolve = (node: unknown, visited: Set<string> = new Set()): unknown => {
    if (!isObject(node)) return node;
    if (typeof node.$ref === 'string') {
      const nextVisited = new Set(visited).add(node.$ref);
      const target = followRef(node.$ref, visited);
      return target === null ? null : resolve(target, nextVisited);
    }
    if (seen.has(node)) return seen.get(node);
    seen.set(node, node);
    return node;
  };

  const schemaToJsonType = (node: unknown, visited: Set<string> = new Set()): JsonType => {
    const resolved = resolve(node, visited);
    if (!isObject(resolved)) return { kind: 'unknown' };

    if (Array.isArray((resolved as { anyOf?: unknown }).anyOf)) {
      const anyOf = (resolved as { anyOf: unknown[] }).anyOf.map((s) =>
        schemaToJsonType(s, visited),
      );
      return { kind: 'union', anyOf };
    }

    const type = (resolved as { type?: string }).type;
    switch (type) {
      case 'string':
        return {
          kind: 'string',
          format: (resolved as { format?: string }).format,
          enum: (resolved as { enum?: string[] }).enum as readonly string[] | undefined,
        };
      case 'integer':
      case 'number':
        return { kind: type, format: (resolved as { format?: string }).format };
      case 'boolean':
        return { kind: 'boolean' };
      case 'null':
        return { kind: 'null' };
      case 'array': {
        const items = schemaToJsonType((resolved as { items?: unknown }).items, visited);
        return { kind: 'array', items };
      }
      case 'object':
      default: {
        const props = (resolved as { properties?: Record<string, unknown> }).properties;
        if (!props) return { kind: 'unknown' };
        const properties: Record<string, JsonType> = {};
        for (const [k, v] of Object.entries(props)) {
          properties[k] = schemaToJsonType(v, visited);
        }
        const required = ((resolved as { required?: string[] }).required ?? []) as readonly string[];
        return { kind: 'object', properties, required };
      }
    }
  };

  return { resolve, schemaToJsonType };
}

function decodeSegment(seg: string): string {
  return seg.replace(/~1/g, '/').replace(/~0/g, '~');
}

// ────────────────────────────────────────────────────────────────────────────
// Extraction helpers
// ────────────────────────────────────────────────────────────────────────────

function extractParams(
  op: Record<string, unknown>,
  pathItem: Record<string, unknown>,
  resolver: Resolver,
  _ctx: ParserContext,
): ParamDef[] {
  const raw: unknown[] = [
    ...((pathItem.parameters as unknown[]) ?? []),
    ...((op.parameters as unknown[]) ?? []),
  ];
  const out: ParamDef[] = [];
  for (const p of raw) {
    const resolved = resolver.resolve(p);
    if (!isObject(resolved)) continue;
    const inValue = resolved.in;
    if (
      inValue !== 'path' &&
      inValue !== 'query' &&
      inValue !== 'header' &&
      inValue !== 'cookie'
    ) {
      continue;
    }
    out.push({
      name: String(resolved.name ?? ''),
      in: inValue,
      required: Boolean(resolved.required),
      schema: resolver.schemaToJsonType(resolved.schema),
    });
  }
  return out;
}

function extractRequestBody(op: Record<string, unknown>, resolver: Resolver): JsonType | null {
  const rb = resolver.resolve(op.requestBody);
  if (!isObject(rb)) return null;
  const content = rb.content as Record<string, { schema?: unknown }> | undefined;
  if (!content) return null;
  const media = content['application/json'] ?? Object.values(content)[0];
  return media?.schema ? resolver.schemaToJsonType(media.schema) : null;
}

function extractResponses(op: Record<string, unknown>, resolver: Resolver): ResponseDef[] {
  const responses = op.responses;
  if (!isObject(responses)) return [];
  const out: ResponseDef[] = [];
  for (const [status, response] of Object.entries(responses)) {
    const code = Number(status);
    if (!Number.isFinite(code)) continue;
    const resolved = resolver.resolve(response);
    if (!isObject(resolved)) continue;
    const content = resolved.content as Record<string, { schema?: unknown }> | undefined;
    const media = content?.['application/json'] ?? (content ? Object.values(content)[0] : undefined);
    const body = media?.schema ? resolver.schemaToJsonType(media.schema) : null;
    const headers: Record<string, JsonType> = {};
    const hdrs = resolved.headers as Record<string, unknown> | undefined;
    if (hdrs) {
      for (const [name, def] of Object.entries(hdrs)) {
        const rdef = resolver.resolve(def);
        headers[name] = isObject(rdef) ? resolver.schemaToJsonType(rdef.schema) : { kind: 'unknown' };
      }
    }
    out.push({ status: code, body, headers });
  }
  return out;
}

function extractServers(doc: Record<string, unknown>): IntermediateRepresentation['servers'] {
  const servers = doc.servers;
  if (!Array.isArray(servers)) return [];
  return servers
    .filter((s: unknown) => isObject(s) && typeof s.url === 'string')
    .map((s: unknown) => ({
      url: (s as { url: string }).url,
      description: (s as { description?: string }).description,
    }));
}

function extractAuth(
  op: Record<string, unknown>,
  _doc: Record<string, unknown>,
): readonly string[] {
  const sec = op.security as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(sec)) return [];
  const names = new Set<string>();
  for (const entry of sec) {
    for (const name of Object.keys(entry)) names.add(name);
  }
  return Array.from(names);
}

function extractAuthSchemes(doc: Record<string, unknown>): IntermediateRepresentation['auth'] {
  const components = doc.components as { securitySchemes?: Record<string, unknown> } | undefined;
  const schemes = components?.securitySchemes;
  if (!isObject(schemes)) return [];
  const out: IntermediateRepresentation['auth'][number][] = [];
  for (const value of Object.values(schemes)) {
    if (!isObject(value)) continue;
    const type = value.type as string | undefined;
    if (type === 'http') {
      const scheme = value.scheme as string | undefined;
      if (scheme === 'bearer') out.push({ kind: 'bearer', format: value.bearerFormat as string | undefined });
      else if (scheme === 'basic') out.push({ kind: 'basic' });
    } else if (type === 'apiKey') {
      const inField = value.in as 'header' | 'query' | undefined;
      const name = value.name as string | undefined;
      if ((inField === 'header' || inField === 'query') && name) {
        out.push({ kind: 'api-key', in: inField, name });
      }
    } else if (type === 'oauth2') {
      out.push({ kind: 'oauth2', flows: [] });
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Resource + relationship inference
// ────────────────────────────────────────────────────────────────────────────

function pickResourceName(op: Record<string, unknown>, path: string): string | null {
  const tags = (op.tags as string[] | undefined) ?? [];
  if (tags.length > 0 && tags[0]) return singularize(tags[0]);
  const segments = path.split('/').filter((s) => s && !s.startsWith('{'));
  const last = segments[segments.length - 1];
  return last ? singularize(last) : null;
}

function ensureResource(
  map: Map<string, ResourceDef>,
  id: ResourceId,
  name: string,
): ResourceDef {
  const existing = map.get(String(id));
  if (existing) return existing;
  const def: ResourceDef = {
    id,
    name: capitalize(name),
    primaryKey: 'id',
    schema: { kind: 'unknown' },
  };
  map.set(String(id), def);
  return def;
}

function inferRelationshipsFromPath(
  path: string,
  resources: Map<string, ResourceDef>,
  seen: Set<string>,
  out: RelationshipDef[],
): void {
  // Match /parent/{id}/child — parent owns child, child belongs-to parent.
  const segments = path.split('/').filter(Boolean);
  for (let i = 0; i + 2 < segments.length; i++) {
    const parent = segments[i];
    const param = segments[i + 1];
    const child = segments[i + 2];
    if (!parent || !param || !child) continue;
    if (parent.startsWith('{') || !param.startsWith('{') || child.startsWith('{')) continue;
    const parentId = asResourceId(singularize(parent));
    const childId = asResourceId(singularize(child));
    ensureResource(resources, parentId, singularize(parent));
    ensureResource(resources, childId, singularize(child));
    const key = `${parentId}->${childId}:owns`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from: parentId, to: childId, kind: 'owns', via: `${String(parentId)}_id` });
    out.push({ from: childId, to: parentId, kind: 'belongs-to', via: `${String(parentId)}_id` });
  }
}

function harvestExamples(
  endpoint: EndpointDef,
  op: Record<string, unknown>,
  resolver: Resolver,
  out: ExampleDef[],
): void {
  const responses = op.responses;
  if (!isObject(responses)) return;
  for (const [status, response] of Object.entries(responses)) {
    const code = Number(status);
    if (!Number.isFinite(code)) continue;
    const resolved = resolver.resolve(response);
    if (!isObject(resolved)) continue;
    const content = resolved.content as
      | Record<string, { example?: unknown; examples?: Record<string, { value?: unknown }> }>
      | undefined;
    const media = content?.['application/json'];
    if (!media) continue;
    if (media.example !== undefined) {
      out.push({
        endpointId: endpoint.id,
        request: { params: {}, body: null },
        response: { status: code, body: media.example },
      });
    } else if (media.examples) {
      for (const ex of Object.values(media.examples)) {
        if (ex.value === undefined) continue;
        out.push({
          endpointId: endpoint.id,
          request: { params: {}, body: null },
          response: { status: code, body: ex.value },
        });
      }
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Tiny utilities
// ────────────────────────────────────────────────────────────────────────────

function normalize(input: ParserInput): Record<string, unknown> | unknown {
  if (input.kind === 'json') return input.content;
  if (input.kind === 'text') {
    try {
      return JSON.parse(input.content);
    } catch (cause) {
      throw new ParseFailedError('OpenAPI document is not valid JSON', cause);
    }
  }
  throw new ParseFailedError('OpenAPI parser cannot read binary input directly');
}

function inferOperation(method: HttpMethod, path: string): EndpointDef['operation'] {
  const trailingParam = /\/\{[^/]+\}$/.test(path);
  switch (method) {
    case 'GET':
      return trailingParam ? 'get' : 'list';
    case 'POST':
      return 'create';
    case 'PATCH':
      return 'update';
    case 'PUT':
      return trailingParam ? 'replace' : 'action';
    case 'DELETE':
      return 'delete';
    default:
      return 'custom';
  }
}

function isMethod(m: string): m is HttpMethod {
  return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(m);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function singularize(word: string): string {
  const w = word.toLowerCase();
  if (w.endsWith('ies') && w.length > 3) return `${w.slice(0, -3)}y`;
  if (w.endsWith('sses') || w.endsWith('shes') || w.endsWith('ches')) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

function capitalize(word: string): string {
  return word.length === 0 ? word : word[0]!.toUpperCase() + word.slice(1);
}

function asResourceId(name: string): ResourceId {
  return name as ResourceId;
}
