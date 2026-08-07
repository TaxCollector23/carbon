import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';

const CreateBody = z.object({
  projectSlug: z.string().min(1),
  irId: z.string().min(1),
  port: z.number().int().min(0).max(65535).optional(),
  host: z.string().optional(),
  snapshot: z.string().optional(),
});

const SnapshotBody = z.object({
  name: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9-_]*$/i),
});

const RestoreBody = z.object({ name: z.string().min(1) });

export async function registerEmulatorRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/v1/emulators', async () => ({ data: ctx.emulators.list() }));

  app.post('/v1/emulators', async (req, reply) => {
    const body = CreateBody.parse(req.body);
    const record = await ctx.emulators.create(body);
    reply.status(201);
    return record;
  });

  app.get<{ Params: { id: string } }>('/v1/emulators/:id', async (req) => ctx.emulators.get(req.params.id));

  app.delete<{ Params: { id: string } }>('/v1/emulators/:id', async (req, reply) => {
    await ctx.emulators.stop(req.params.id);
    reply.status(204);
  });

  app.post<{ Params: { id: string } }>('/v1/emulators/:id/reset', async (req, reply) => {
    await ctx.emulators.reset(req.params.id);
    reply.status(204);
  });

  app.post<{ Params: { id: string } }>('/v1/emulators/:id/snapshot', async (req, reply) => {
    const body = SnapshotBody.parse(req.body);
    const result = await ctx.emulators.snapshot(req.params.id, body.name);
    reply.status(201);
    return { name: body.name, ...result };
  });

  app.post<{ Params: { id: string } }>('/v1/emulators/:id/restore', async (req, reply) => {
    const body = RestoreBody.parse(req.body);
    await ctx.emulators.restore(req.params.id, body.name);
    reply.status(204);
  });
}
