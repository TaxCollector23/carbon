import type { FastifyReply, FastifyInstance, FastifyRequest } from 'fastify';
import { NotFoundError } from '@carbon/core';
import { StorageKeys } from '@carbon/storage';
import type { AppContext } from '../context.js';
import { z } from 'zod';
import { requireScope } from '../plugins/scopes.js';
import { ProjectSlug, resolveProjectAccess } from './project-access.js';
import { collectStorage } from './storage-listing.js';

/**
 * Content-addressed artifacts (IR, graph) are immutable — their ids are
 * content hashes — so they are safe to cache aggressively. This value is
 * one year in seconds; combined with `immutable`, browsers and CDNs will
 * skip revalidation entirely for the artifact's lifetime.
 */
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

/**
 * Serve one artifact by key, streaming when the backend supports it and
 * falling back to the buffered `get` path otherwise. Emits weak ETags
 * derived from the artifact id (a content hash) so `If-None-Match`
 * short-circuits to 304 without re-reading storage.
 */
async function sendArtifact(
  ctx: AppContext,
  req: FastifyRequest,
  reply: FastifyReply,
  key: string,
  id: string,
  notFoundKind: 'ir' | 'graph',
): Promise<FastifyReply> {
  const etag = `W/"${id}"`;
  const ifNoneMatch = req.headers['if-none-match'];
  if (ifNoneMatch && ifNoneMatch === etag) {
    reply.header('etag', etag);
    reply.header('cache-control', IMMUTABLE_CACHE);
    return reply.status(304).send();
  }

  if (typeof ctx.storage.getStream === 'function') {
    const result = await ctx.storage.getStream(key);
    if (!result) throw new NotFoundError(notFoundKind, id);
    reply.header('content-type', 'application/json');
    reply.header('content-length', String(result.size));
    reply.header('etag', etag);
    reply.header('cache-control', IMMUTABLE_CACHE);
    return reply.send(result.stream);
  }

  // Backend does not stream — preserve legacy buffered behavior.
  const bytes = await ctx.storage.get(key);
  if (!bytes) throw new NotFoundError(notFoundKind, id);
  reply.header('content-type', 'application/json');
  reply.header('etag', etag);
  reply.header('cache-control', IMMUTABLE_CACHE);
  return reply.send(bytes);
}

/**
 * Fetch persisted ingestion artifacts. The ingestion pipeline writes the IR
 * and behavior graph to storage; without these routes, there was no way for
 * the dashboard or SDK to retrieve them without reaching into the file system
 * directly. Every artifact is content-typed application/json.
 */
export async function registerArtifactRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get<{ Params: { slug: string; id: string } }>(
    '/v1/projects/:slug/ir/:id',
    { preHandler: requireScope('read') },
    async (req, reply) => {
      const params = z.object({ slug: ProjectSlug, id: z.string().min(1) }).parse(req.params);
      const project = await resolveProjectAccess(ctx, req, params.slug);
      const key = StorageKeys.ir(project.storageSlug, params.id);
      return sendArtifact(ctx, req, reply, key, params.id, 'ir');
    },
  );

  app.get<{ Params: { slug: string; id: string } }>(
    '/v1/projects/:slug/graphs/:id',
    { preHandler: requireScope('read') },
    async (req, reply) => {
      const params = z.object({ slug: ProjectSlug, id: z.string().min(1) }).parse(req.params);
      const project = await resolveProjectAccess(ctx, req, params.slug);
      const key = StorageKeys.graph(project.storageSlug, params.id);
      return sendArtifact(ctx, req, reply, key, params.id, 'graph');
    },
  );

  app.get<{ Params: { slug: string }; Querystring: { limit?: string } }>(
    '/v1/projects/:slug/artifacts',
    { preHandler: requireScope('read') },
    async (req) => {
      const params = z.object({ slug: ProjectSlug }).parse(req.params);
      const query = z
        .object({ limit: z.coerce.number().int().min(1).max(500).default(100) })
        .parse(req.query);
      const project = await resolveProjectAccess(ctx, req, params.slug);
      const items: Array<{ kind: 'ir' | 'graph'; id: string; size: number; modifiedAt: number }> =
        [];

      // Each kind gets its own budget. A single shared cap let a project with
      // thousands of IRs consume the whole allowance before the graph prefix
      // was scanned at all, so `kind: 'graph'` silently vanished from the
      // response.
      let truncated = false;
      for (const kind of ['ir', 'graph'] as const) {
        const prefix =
          kind === 'ir'
            ? `projects/${project.storageSlug}/ir/`
            : `projects/${project.storageSlug}/graphs/`;
        const scanned = await collectStorage(ctx.storage.list(prefix), query.limit, (obj) => {
          const id = obj.key
            .split('/')
            .pop()
            ?.replace(/\.json$/, '');
          if (id) items.push({ kind, id, size: obj.size, modifiedAt: obj.modifiedAt });
        });
        if (scanned >= query.limit) truncated = true;
      }

      items.sort((a, b) => b.modifiedAt - a.modifiedAt);
      return { data: items.slice(0, query.limit), limit: query.limit, truncated };
    },
  );
}
