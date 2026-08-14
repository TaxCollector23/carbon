import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EndpointDef, ResourceId, TransitionRule } from '@carbon/types';
import { enforceForeignKeys } from '@carbon/graph';
import type { RuntimeContext } from './runtime.js';

/**
 * Compiles the behavior graph into Fastify routes. Each endpoint's declared
 * effects are looked up once at register-time, so the request path stays
 * O(1) — no graph traversal per request.
 */
export async function registerGraphRoutes(
  app: FastifyInstance,
  ctx: RuntimeContext,
): Promise<void> {
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

  // State control endpoints — used by the CLI, SDK, and dashboard to introspect
  // and manage the runtime without touching the state engine directly.
  app.post('/__carbon/state/snapshot', async () => ctx.state.snapshot());
  app.post('/__carbon/state/restore', async (req, reply) => {
    await ctx.state.restore(req.body as never);
    reply.status(204);
  });
  app.post('/__carbon/state/reset', async (_req, reply) => {
    await ctx.state.reset();
    reply.status(204);
  });
  // Time-travel introspection & scrub controls. Only wired when the engine
  // exposes the optional journal hooks — otherwise 404 keeps the surface
  // honest about what it can actually do.
  app.get('/__carbon/state/history', async (_req, reply) => {
    if (typeof ctx.state.history !== 'function') {
      reply.status(404);
      return { error: { code: 'CARBON_NOT_SUPPORTED', message: 'engine has no journal' } };
    }
    return { entries: ctx.state.history() };
  });
  app.post<{ Body: { seq: number } }>('/__carbon/state/rewind', async (req, reply) => {
    if (typeof ctx.state.rewindTo !== 'function') {
      reply.status(404);
      return { error: { code: 'CARBON_NOT_SUPPORTED', message: 'engine has no journal' } };
    }
    const seq = Number(req.body?.seq);
    if (!Number.isInteger(seq)) {
      reply.status(400);
      return { error: { code: 'CARBON_INVALID', message: 'body.seq must be an integer' } };
    }
    await ctx.state.rewindTo(seq);
    reply.status(204);
  });
  app.post<{ Body: { seq: number } }>('/__carbon/state/forward', async (req, reply) => {
    if (typeof ctx.state.forwardTo !== 'function') {
      reply.status(404);
      return { error: { code: 'CARBON_NOT_SUPPORTED', message: 'engine has no journal' } };
    }
    const seq = Number(req.body?.seq);
    if (!Number.isInteger(seq)) {
      reply.status(400);
      return { error: { code: 'CARBON_INVALID', message: 'body.seq must be an integer' } };
    }
    await ctx.state.forwardTo(seq);
    reply.status(204);
  });

  app.get('/__carbon/inspect', async () => ({
    api: ctx.ir.api,
    endpoints: ctx.ir.endpoints.length,
    resources: ctx.ir.resources.length,
    relationships: ctx.ir.relationships.length,
  }));
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
      const filtered = await applyForeignKeyIntegrity(listed.items.map(unwrap), resource, ctx);
      return { status: 200, body: { data: filtered, next_cursor: listed.nextCursor } };
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
      return {
        status: 200,
        body: { ok: true, endpoint: endpoint.id, transitions: transitions.length },
      };
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

async function applyForeignKeyIntegrity(
  rows: Array<Record<string, unknown>>,
  resource: ResourceId,
  ctx: RuntimeContext,
): Promise<Array<Record<string, unknown>>> {
  const fkConstraints = ctx.graph.constraints.filter(
    (c): c is Extract<typeof c, { kind: 'foreign-key' }> =>
      c.kind === 'foreign-key' && c.from === resource,
  );
  if (fkConstraints.length === 0) return rows;
  let current = rows;
  for (const fk of fkConstraints) {
    const parents = await ctx.state.list(fk.to);
    const parentIds = new Set(parents.items.map((p) => p.id));
    current = enforceForeignKeys(current, fk.field, parentIds, ctx.consistency) as typeof current;
  }
  return current;
}

function extractLastBrace(path: string): string | null {
  const match = path.match(/\{([^/}]+)\}(?!.*\{)/);
  return match?.[1] ?? null;
}
