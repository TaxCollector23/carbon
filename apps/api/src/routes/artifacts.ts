import type { FastifyInstance } from 'fastify';
import { NotFoundError } from '@carbon/core';
import { StorageKeys } from '@carbon/storage';
import type { AppContext } from '../context.js';
import { z } from 'zod';
import { ProjectSlug, resolveProjectAccess } from './project-access.js';

/**
 * Fetch persisted ingestion artifacts. The ingestion pipeline writes the IR
 * and behavior graph to storage; without these routes, there was no way for
 * the dashboard or SDK to retrieve them without reaching into the file system
 * directly. Every artifact is content-typed application/json.
 */
export async function registerArtifactRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get<{ Params: { slug: string; id: string } }>(
    '/v1/projects/:slug/ir/:id',
    async (req, reply) => {
      const params = z.object({ slug: ProjectSlug, id: z.string().min(1) }).parse(req.params);
      const project = await resolveProjectAccess(ctx, req, params.slug);
      const key = StorageKeys.ir(project.storageSlug, params.id);
      const bytes = await ctx.storage.get(key);
      if (!bytes) throw new NotFoundError('ir', params.id);
      reply.header('content-type', 'application/json');
      return reply.send(bytes);
    },
  );

  app.get<{ Params: { slug: string; id: string } }>(
    '/v1/projects/:slug/graphs/:id',
    async (req, reply) => {
      const params = z.object({ slug: ProjectSlug, id: z.string().min(1) }).parse(req.params);
      const project = await resolveProjectAccess(ctx, req, params.slug);
      const key = StorageKeys.graph(project.storageSlug, params.id);
      const bytes = await ctx.storage.get(key);
      if (!bytes) throw new NotFoundError('graph', params.id);
      reply.header('content-type', 'application/json');
      return reply.send(bytes);
    },
  );

  app.get<{ Params: { slug: string } }>('/v1/projects/:slug/artifacts', async (req) => {
    const params = z.object({ slug: ProjectSlug }).parse(req.params);
    const project = await resolveProjectAccess(ctx, req, params.slug);
    const items: Array<{ kind: 'ir' | 'graph'; id: string; size: number; modifiedAt: number }> = [];
    for (const kind of ['ir', 'graph'] as const) {
      const prefix =
        kind === 'ir'
          ? `projects/${project.storageSlug}/ir/`
          : `projects/${project.storageSlug}/graphs/`;
      for await (const obj of ctx.storage.list(prefix)) {
        const id = obj.key
          .split('/')
          .pop()
          ?.replace(/\.json$/, '');
        if (!id) continue;
        items.push({ kind, id, size: obj.size, modifiedAt: obj.modifiedAt });
      }
    }
    items.sort((a, b) => b.modifiedAt - a.modifiedAt);
    return { data: items };
  });
}
