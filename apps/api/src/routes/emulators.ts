import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import {
  filterStoredProjectRecords,
  ProjectSlug,
  resolveProjectAccess,
  resolveStoredProjectAccess,
} from './project-access.js';

const CreateBody = z.object({
  projectSlug: ProjectSlug,
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
  app.get('/v1/emulators', async (req) => ({
    data: await filterStoredProjectRecords(ctx, req, ctx.emulators.list()),
  }));

  app.post('/v1/emulators', async (req, reply) => {
    const body = CreateBody.parse(req.body);
    const project = await resolveProjectAccess(ctx, req, body.projectSlug);
    const record = await ctx.emulators.create({ ...body, projectSlug: project.storageSlug });
    reply.status(201);
    return { ...record, projectSlug: project.slug };
  });

  app.get<{ Params: { id: string } }>('/v1/emulators/:id', async (req) => {
    const record = ctx.emulators.get(req.params.id);
    const project = await resolveStoredProjectAccess(ctx, req, record.projectSlug);
    return { ...record, projectSlug: project.slug };
  });

  app.delete<{ Params: { id: string } }>('/v1/emulators/:id', async (req, reply) => {
    const record = ctx.emulators.get(req.params.id);
    await resolveStoredProjectAccess(ctx, req, record.projectSlug);
    await ctx.emulators.stop(req.params.id);
    reply.status(204);
  });

  app.post<{ Params: { id: string } }>('/v1/emulators/:id/reset', async (req, reply) => {
    const record = ctx.emulators.get(req.params.id);
    await resolveStoredProjectAccess(ctx, req, record.projectSlug);
    await ctx.emulators.reset(req.params.id);
    reply.status(204);
  });

  app.post<{ Params: { id: string } }>('/v1/emulators/:id/snapshot', async (req, reply) => {
    const body = SnapshotBody.parse(req.body);
    const record = ctx.emulators.get(req.params.id);
    await resolveStoredProjectAccess(ctx, req, record.projectSlug);
    const result = await ctx.emulators.snapshot(req.params.id, body.name);
    reply.status(201);
    return { name: body.name, ...result };
  });

  app.post<{ Params: { id: string } }>('/v1/emulators/:id/restore', async (req, reply) => {
    const body = RestoreBody.parse(req.body);
    const record = ctx.emulators.get(req.params.id);
    await resolveStoredProjectAccess(ctx, req, record.projectSlug);
    await ctx.emulators.restore(req.params.id, body.name);
    reply.status(204);
  });
}
