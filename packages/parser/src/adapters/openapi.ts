import { ParseFailedError } from '@carbon/core';
import type { EndpointDef, EndpointId, IntermediateRepresentation, ResourceId } from '@carbon/types';
import type { HttpMethod } from '@carbon/types';
import type { Parser, ParserContext, ParserInput } from '../parser.js';

/**
 * OpenAPI 3.x adapter. Only the shape of the parse is implemented here — the
 * detailed schema walking, $ref resolution, and example harvesting will land
 * in subsequent milestones. What matters for Phase One is the interface: this
 * class is a drop-in Parser that emits a well-formed IR.
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
    if (typeof doc !== 'object' || doc === null) {
      throw new ParseFailedError('OpenAPI root must be an object');
    }
    const info = (doc as { info?: { title?: string; version?: string } }).info ?? {};
    const paths = (doc as { paths?: Record<string, Record<string, unknown>> }).paths ?? {};

    const endpoints: EndpointDef[] = [];
    for (const [path, methods] of Object.entries(paths)) {
      for (const [method, op] of Object.entries(methods)) {
        const upper = method.toUpperCase();
        if (!isMethod(upper)) continue;
        endpoints.push(toEndpoint(path, upper, op, ctx));
      }
    }

    return {
      version: 1,
      api: {
        name: info.title ?? 'Untitled API',
        version: info.version ?? '0.0.0',
        source: {
          kind: 'openapi',
          origin: ctx.origin,
          ingestedAt: 0, // ingested-at is stamped by the ingestion layer, not the parser
        },
      },
      servers: extractServers(doc),
      auth: [],
      resources: [],
      endpoints,
      relationships: [],
      examples: [],
      meta: {},
    };
  }
}

function normalize(input: ParserInput): unknown {
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

function extractServers(doc: unknown): IntermediateRepresentation['servers'] {
  const servers = (doc as { servers?: Array<{ url?: string; description?: string }> }).servers;
  if (!Array.isArray(servers)) return [];
  return servers
    .filter((s) => typeof s.url === 'string')
    .map((s) => ({ url: s.url as string, description: s.description }));
}

function toEndpoint(
  path: string,
  method: HttpMethod,
  op: unknown,
  _ctx: ParserContext,
): EndpointDef {
  const meta = (op as { operationId?: string; tags?: string[] }) ?? {};
  const id = `${method}:${path}` as EndpointId;
  return {
    id,
    method,
    path,
    operation: inferOperation(method, path),
    resource: null as ResourceId | null,
    params: [],
    requestBody: null,
    responses: [],
    auth: [],
    meta: { operationId: meta.operationId, tags: meta.tags ?? [] },
  };
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
