import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { InvalidInputError } from '@carbon/core';
import type { AppContext } from '../context.js';
import {
  filterStoredProjectRecords,
  ProjectSlug,
  resolveProjectAccess,
  resolveStoredProjectAccess,
} from './project-access.js';

const DEFAULT_ALLOWED_HOSTS: readonly string[] = ['127.0.0.1', 'localhost'];

const CreateBody = z.object({
  projectSlug: ProjectSlug,
  irId: z.string().min(1).max(200),
  // 0 asks the OS for an ephemeral port. Ports below 1024 are privileged and
  // would either fail or, running as root, let a caller squat on a well-known
  // service port.
  port: z
    .number()
    .int()
    .refine((p) => p === 0 || (p >= 1024 && p <= 65535), 'port must be 0 or in 1024-65535')
    .optional(),
  // Free-form here; the route enforces the operator-configured allow-list
  // (`CARBON_EMULATOR_ALLOWED_HOSTS`) after parsing.
  host: z.string().min(1).max(64).optional(),
  snapshot: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9-_]*$/i)
    .optional(),
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

  const allowedHosts = ctx.emulatorAllowedHosts ?? DEFAULT_ALLOWED_HOSTS;

  app.post('/v1/emulators', async (req, reply) => {
    const body = CreateBody.parse(req.body);
    // Default to loopback and reject anything the operator did not opt into.
    // Passing an arbitrary interface straight to `server.listen()` is how an
    // authenticated caller on a shared control plane binds an emulator to a
    // publicly reachable address.
    const host = body.host ?? '127.0.0.1';
    if (!allowedHosts.includes(host)) {
      throw new InvalidInputError(
        `host must be one of: ${allowedHosts.join(', ')} (set CARBON_EMULATOR_ALLOWED_HOSTS to allow more)`,
        { host, allowed: allowedHosts },
      );
    }
    const project = await resolveProjectAccess(ctx, req, body.projectSlug);
    const record = await ctx.emulators.create({
      ...body,
      host,
      projectSlug: project.storageSlug,
    });
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
