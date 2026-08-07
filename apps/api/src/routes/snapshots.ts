import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { NotFoundError } from '@carbon/core';
import { parseSnapshot, serializeSnapshot, type StateSnapshot } from '@carbon/state';
import { StorageKeys } from '@carbon/storage';
import type { AppContext } from '../context.js';

const CreateSnapshotBody = z.object({
  projectSlug: z.string().min(1),
  name: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9-_]*$/i, 'name must be alphanumeric with dashes or underscores'),
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
  app.get<{ Params: { slug: string } }>('/v1/projects/:slug/snapshots', async (req) => {
    const items: Array<{ name: string; size: number; modifiedAt: number }> = [];
    for await (const obj of ctx.storage.list(`projects/${req.params.slug}/snapshots/`)) {
      const name = obj.key.split('/').pop()?.replace(/\.json$/, '');
      if (!name) continue;
      items.push({ name, size: obj.size, modifiedAt: obj.modifiedAt });
    }
    return { data: items };
  });

  app.post('/v1/snapshots', async (req, reply) => {
    const body = CreateSnapshotBody.parse(req.body);
    const key = StorageKeys.snapshot(body.projectSlug, body.name);
    await ctx.storage.put(key, serializeSnapshot(body.snapshot as StateSnapshot), {
      contentType: 'application/json',
    });
    reply.status(201);
    return { name: body.name, storageKey: key };
  });

  app.get<{ Params: { slug: string; name: string } }>(
    '/v1/projects/:slug/snapshots/:name',
    async (req) => {
      const key = StorageKeys.snapshot(req.params.slug, req.params.name);
      const bytes = await ctx.storage.get(key);
      if (!bytes) throw new NotFoundError('snapshot', req.params.name);
      const text = new TextDecoder().decode(bytes);
      return parseSnapshot(text);
    },
  );

  app.delete<{ Params: { slug: string; name: string } }>(
    '/v1/projects/:slug/snapshots/:name',
    async (req, reply) => {
      const key = StorageKeys.snapshot(req.params.slug, req.params.name);
      const head = await ctx.storage.head(key);
      if (!head) throw new NotFoundError('snapshot', req.params.name);
      await ctx.storage.delete(key);
      reply.status(204);
    },
  );
}
