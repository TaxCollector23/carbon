import { URL } from 'node:url';
import { ParseFailedError } from '@carbon/core';
import type {
  EndpointDef,
  EndpointId,
  ExampleDef,
  HttpMethod,
  IntermediateRepresentation,
  ParamDef,
  ResourceDef,
  ResourceId,
  ResponseDef,
} from '@carbon/types';
import type { Parser, ParserContext, ParserInput } from '../parser.js';

/**
 * HAR (HTTP Archive) adapter.
 *
 * A HAR captures individual exchanges — not endpoints. This parser groups
 * exchanges into endpoint templates by inferring `{id}`-style path params
 * from segments that look like ids (uuids, ints, opaque tokens), then
 * aggregates status codes and example bodies per template.
 *
 * The heuristic is intentionally conservative — a segment must have varied
 * across calls (or be an obvious identifier shape) before we generalize it.
 */
export class HarParser implements Parser {
  readonly name = 'har';
  readonly formats = ['har'] as const;

  canParse(input: ParserInput): boolean {
    if (input.hint === 'har') return true;
    if (input.kind === 'json') {
      return !!(input.content as { log?: { entries?: unknown[] } })?.log?.entries;
    }
    return false;
  }

  async parse(input: ParserInput, ctx: ParserContext): Promise<IntermediateRepresentation> {
    if (input.kind !== 'json') {
      throw new ParseFailedError('HAR parser requires JSON input');
    }
    const doc = input.content as {
      log?: {
        entries?: Array<{
          request: { method: string; url: string; queryString?: Array<{ name: string; value: string }> };
          response: { status: number; content?: { text?: string; mimeType?: string } };
          time?: number;
        }>;
      };
    };
    const entries = doc.log?.entries ?? [];
    ctx.logger.debug('parser.har.entries', { count: entries.length });

    // 1. Group by method + segment-shape template
    const groups = new Map<string, Array<(typeof entries)[number]>>();
    const templates = new Map<string, { method: HttpMethod; template: string; segments: string[] }>();

    for (const entry of entries) {
      const method = entry.request.method.toUpperCase();
      if (!isMethod(method)) continue;
      let pathname: string;
      try {
        pathname = new URL(entry.request.url).pathname;
      } catch {
        continue;
      }
      const segments = pathname.split('/').filter(Boolean);
      const key = `${method} ${segments.map((s) => (isIdLike(s) ? '{id}' : s)).join('/')}`;
      const list = groups.get(key) ?? [];
      list.push(entry);
      groups.set(key, list);
      if (!templates.has(key)) {
        templates.set(key, {
          method,
          template: '/' + segments.map((s) => (isIdLike(s) ? '{id}' : s)).join('/'),
          segments,
        });
      }
    }

    // 2. Refine: if two entries share the template but differ in a specific
    //    segment, that segment is a param — even if it doesn't match the
    //    id-like heuristic. This catches slug-style keys.
    for (const [key, group] of groups) {
      if (group.length < 2) continue;
      const paths = group
        .map((g) => {
          try {
            return new URL(g.request.url).pathname.split('/').filter(Boolean);
          } catch {
            return null;
          }
        })
        .filter((s): s is string[] => s !== null);
      const tpl = templates.get(key);
      if (!tpl || paths.length === 0 || !paths[0]) continue;
      const length = paths[0].length;
      if (!paths.every((p) => p.length === length)) continue;
      const refinedSegments = tpl.segments.map((seg, i) => {
        const values = new Set(paths.map((p) => p[i]));
        if (values.size > 1) return isIdLike(seg) ? '{id}' : `{id${i}}`;
        return seg;
      });
      templates.set(key, {
        method: tpl.method,
        template: '/' + refinedSegments.map((s) => (isIdLike(s) ? '{id}' : s)).join('/'),
        segments: refinedSegments,
      });
    }

    // 3. Build endpoints, resources, examples.
    const endpoints: EndpointDef[] = [];
    const examples: ExampleDef[] = [];
    const resources = new Map<string, ResourceDef>();

    for (const [key, group] of groups) {
      const tpl = templates.get(key)!;
      const resourceName = pickResource(tpl.template);
      const resourceId = resourceName ? (resourceName as ResourceId) : null;
      if (resourceId) {
        if (!resources.has(resourceName!)) {
          resources.set(resourceName!, {
            id: resourceId,
            name: capitalize(resourceName!),
            primaryKey: 'id',
            schema: { kind: 'unknown' },
          });
        }
      }

      const params: ParamDef[] = [];
      for (const seg of tpl.template.split('/').filter((s) => s.startsWith('{') && s.endsWith('}'))) {
        const name = seg.slice(1, -1);
        params.push({ name, in: 'path', required: true, schema: { kind: 'string' } });
      }

      // Query params: union across the group.
      const seenQuery = new Set<string>();
      for (const entry of group) {
        for (const q of entry.request.queryString ?? []) {
          if (seenQuery.has(q.name)) continue;
          seenQuery.add(q.name);
          params.push({ name: q.name, in: 'query', required: false, schema: { kind: 'string' } });
        }
      }

      // Responses: unique status codes, first body per status.
      const responsesByStatus = new Map<number, ResponseDef>();
      for (const entry of group) {
        if (responsesByStatus.has(entry.response.status)) continue;
        responsesByStatus.set(entry.response.status, {
          status: entry.response.status,
          body: { kind: 'unknown' },
          headers: {},
        });
      }

      const endpointId = `${tpl.method}:${tpl.template}` as EndpointId;
      endpoints.push({
        id: endpointId,
        method: tpl.method,
        path: tpl.template,
        operation: inferOperation(tpl.method, tpl.template),
        resource: resourceId,
        params,
        requestBody: null,
        responses: Array.from(responsesByStatus.values()),
        auth: [],
        meta: { observations: group.length },
      });

      // Harvest one example body per endpoint.
      for (const entry of group) {
        const text = entry.response.content?.text;
        if (!text) continue;
        try {
          const parsed = JSON.parse(text);
          examples.push({
            endpointId,
            request: { params: {}, body: null },
            response: { status: entry.response.status, body: parsed },
          });
          break;
        } catch {
          continue;
        }
      }
    }

    return {
      version: 1,
      api: {
        name: 'Recorded traffic',
        version: '0.0.0',
        source: { kind: 'har', origin: ctx.origin, ingestedAt: 0 },
      },
      servers: [],
      auth: [],
      resources: Array.from(resources.values()),
      endpoints,
      relationships: [],
      examples,
      meta: { entryCount: entries.length },
    };
  }
}

function isMethod(m: string): m is HttpMethod {
  return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(m);
}

function isIdLike(seg: string): boolean {
  if (/^\d+$/.test(seg)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return true;
  if (/^[a-z]{2,5}_[A-Za-z0-9]{6,}$/.test(seg)) return true; // Stripe-style ids
  if (seg.length >= 20 && /^[A-Za-z0-9]+$/.test(seg)) return true;
  return false;
}

function pickResource(template: string): string | null {
  const segments = template.split('/').filter((s) => s && !s.startsWith('{'));
  const last = segments[segments.length - 1];
  return last ? singularize(last) : null;
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
