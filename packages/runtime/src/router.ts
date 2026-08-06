import type { FastifyInstance, FastifyRequest } from 'fastify';
import type {
  EndpointDef,
  ResourceId,
  TransitionRule,
} from '@carbon/types';
import type { RuntimeContext } from './runtime.js';

/**
 * Compiles the behavior graph into Fastify routes. Each endpoint's declared
 * effects are looked up once at register-time, so the request path stays
 * O(1) — no graph traversal per request.
 */
export async function registerGraphRoutes(app: FastifyInstance, ctx: RuntimeContext): Promise<void> {
  const transitionsByEndpoint = new Map<string, TransitionRule[]>();
  for (const t of ctx.graph.transitions) {
    const list = transitionsByEndpoint.get(t.endpoint) ?? [];
    list.push(t);
    transitionsByEndpoint.set(t.endpoint, list);
  }

  for (const endpoint of ctx.ir.endpoints) {
    const transitions = transitionsByEndpoint.get(endpoint.id) ?? [];
    app.route({
      method: endpoint.method,
      url: toFastifyPath(endpoint.path),
      handler: async (req, reply) => {
        const result = await handle(endpoint, transitions, req, ctx);
        reply.status(result.status).send(result.body);
      },
    });
  }

  app.get('/__carbon/health', async () => ({ ok: true, api: ctx.ir.api.name }));
}

interface Handled {
  status: number;
  body: unknown;
}

async function handle(
  endpoint: EndpointDef,
  transitions: TransitionRule[],
  req: FastifyRequest,
  ctx: RuntimeContext,
): Promise<Handled> {
  if (!endpoint.resource) {
    return { status: 200, body: {} };
  }
  const resource = endpoint.resource;
  const idFromPath = paramFromPath(req.params, endpoint);

  switch (endpoint.operation) {
    case 'list': {
      const listed = await ctx.state.list(resource);
      return { status: 200, body: { data: listed.items.map(unwrap), next_cursor: listed.nextCursor } };
    }
    case 'get': {
      if (!idFromPath) return notFound(resource, '(missing id)');
      const record = await ctx.state.read(resource, idFromPath);
      return record ? { status: 200, body: unwrap(record) } : notFound(resource, idFromPath);
    }
    case 'create': {
      const created = await ctx.state.create(resource, req.body ?? {});
      return { status: 201, body: unwrap(created) };
    }
    case 'update': {
      if (!idFromPath) return notFound(resource, '(missing id)');
      const updated = await ctx.state.update(resource, idFromPath, req.body ?? {});
      return { status: 200, body: unwrap(updated) };
    }
    case 'replace': {
      if (!idFromPath) return notFound(resource, '(missing id)');
      const replaced = await ctx.state.replace(resource, idFromPath, req.body ?? {});
      return { status: 200, body: unwrap(replaced) };
    }
    case 'delete': {
      if (!idFromPath) return notFound(resource, '(missing id)');
      await ctx.state.delete(resource, idFromPath);
      return { status: 204, body: null };
    }
    case 'action':
    case 'custom':
    default: {
      // Custom/action endpoints fall back to their declared transitions, if any.
      // For Phase One we acknowledge the invocation deterministically.
      return { status: 200, body: { ok: true, endpoint: endpoint.id, transitions: transitions.length } };
    }
  }
}

function notFound(resource: ResourceId, id: string): Handled {
  return {
    status: 404,
    body: { error: { code: 'CARBON_NOT_FOUND', message: `${resource} ${id} not found` } },
  };
}

function unwrap(record: { data: Readonly<Record<string, unknown>> }): Record<string, unknown> {
  return { ...record.data };
}

function toFastifyPath(path: string): string {
  return path.replace(/\{([^/}]+)\}/g, ':$1');
}

function paramFromPath(params: unknown, endpoint: EndpointDef): string | null {
  if (!params || typeof params !== 'object') return null;
  const pathParam = endpoint.params.find((p) => p.in === 'path');
  const name = pathParam?.name ?? extractLastBrace(endpoint.path);
  if (!name) return null;
  const value = (params as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : null;
}

function extractLastBrace(path: string): string | null {
  const match = path.match(/\{([^/}]+)\}(?!.*\{)/);
  return match?.[1] ?? null;
}
