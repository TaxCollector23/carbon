import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { NotFoundError } from '@carbon/core';
import { parseSnapshot, serializeSnapshot, type StateSnapshot } from '@carbon/state';
import { StorageKeys } from '@carbon/storage';
import type { AppContext } from '../context.js';
import { requireScope } from '../plugins/scopes.js';
import { ProjectSlug, resolveProjectAccess } from './project-access.js';
import { collectStorage } from './storage-listing.js';

/**
 * Snapshot names appear in storage keys, so they must be lowercase, start with
 * an alphanumeric, and contain only `[a-z0-9-]`. Applied to *every* route that
 * takes a name — read and delete included — to keep path traversal shapes off
 * the surface area.
 */
const SnapshotName = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'invalid snapshot name');

const CreateSnapshotBody = z.object({
  projectSlug: ProjectSlug,
  name: SnapshotName,
  snapshot: z.object({
    version: z.literal(1),
    takenAt: z.number(),
    records: z.array(
      z.object({
        resource: z.string(),
        id: z.string(),
        data: z.record(z.unknown()),
        createdAt: z.number(),
        updatedAt: z.number(),
      }),
    ),
  }),
});

export async function registerSnapshotRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get<{ Params: { slug: string }; Querystring: { limit?: string } }>(
    '/v1/projects/:slug/snapshots',
    { preHandler: requireScope('read') },
    async (req) => {
      const params = z.object({ slug: ProjectSlug }).parse(req.params);
      const query = z
        .object({ limit: z.coerce.number().int().min(1).max(500).default(100) })
        .parse(req.query);
      const project = await resolveProjectAccess(ctx, req, params.slug);

      // Bounded scan. On S3 an unbounded `list` paginates through every object
      // under the prefix, so a project with 50k snapshots would hold the
      // connection open for minutes and buffer the whole listing in memory.
      const items: Array<{ name: string; size: number; modifiedAt: number }> = [];
      const scanned = await collectStorage(
        ctx.storage.list(`projects/${project.storageSlug}/snapshots/`),
        query.limit,
        (obj) => {
          const name = obj.key
            .split('/')
            .pop()
            ?.replace(/\.json$/, '');
          if (name) items.push({ name, size: obj.size, modifiedAt: obj.modifiedAt });
        },
      );

      items.sort((a, b) => b.modifiedAt - a.modifiedAt);
      return { data: items, limit: query.limit, truncated: scanned >= query.limit };
    },
  );

  app.post('/v1/snapshots', { preHandler: requireScope('write') }, async (req, reply) => {
    const body = CreateSnapshotBody.parse(req.body);
    const project = await resolveProjectAccess(ctx, req, body.projectSlug);
    const key = StorageKeys.snapshot(project.storageSlug, body.name);
    await ctx.storage.put(key, serializeSnapshot(body.snapshot as unknown as StateSnapshot), {
      contentType: 'application/json',
    });
    reply.status(201);
    return { name: body.name, storageKey: key };
  });

  app.get<{ Params: { slug: string; name: string } }>(
    '/v1/projects/:slug/snapshots/:name',
    { preHandler: requireScope('read') },
    async (req) => {
      const params = z.object({ slug: ProjectSlug, name: SnapshotName }).parse(req.params);
      const project = await resolveProjectAccess(ctx, req, params.slug);
      const key = StorageKeys.snapshot(project.storageSlug, params.name);
      const bytes = await ctx.storage.get(key);
      if (!bytes) throw new NotFoundError('snapshot', params.name);
      const text = new TextDecoder().decode(bytes);
      return parseSnapshot(text);
    },
  );

  app.delete<{ Params: { slug: string; name: string } }>(
    '/v1/projects/:slug/snapshots/:name',
    { preHandler: requireScope('write') },
    async (req, reply) => {
      const params = z.object({ slug: ProjectSlug, name: SnapshotName }).parse(req.params);
      const project = await resolveProjectAccess(ctx, req, params.slug);
      const key = StorageKeys.snapshot(project.storageSlug, params.name);
      const head = await ctx.storage.head(key);
      if (!head) throw new NotFoundError('snapshot', params.name);
      await ctx.storage.delete(key);
      reply.status(204);
    },
  );
}
