import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { InvalidInputError, NotFoundError } from '@carbon/core';
import { schema } from '@carbon/database';
import { runThroughput } from '@carbon/benchmarks/throughput-lib';
import type { AppContext } from '../context.js';
import { resolveCallerOrg } from '../plugins/caller-org.js';
import { requireScope } from '../plugins/scopes.js';
import { zodBody, zodResponse } from '../plugins/schema-helpers.js';
import { compileRules, type ChaosRule } from '../services/chaos.js';

const EmulatorSummary = z
  .object({
    id: z.string(),
    projectSlug: z.string().optional(),
    url: z.string().optional(),
    host: z.string().optional(),
    port: z.number().int().optional(),
    startedAt: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();
const EmulatorListResponse = z.object({ data: z.array(EmulatorSummary) });
const SnapshotAckResponse = z
  .object({ name: z.string() })
  .passthrough();
const ApplyPresetResponse = z.object({
  applied: z.boolean(),
  presetId: z.string(),
  name: z.string(),
  errorRuleCount: z.number().int(),
  latency: z.unknown().optional(),
});
const LoadTestResponse = z.object({
  emulatorId: z.string(),
  target: z.string(),
  concurrency: z.number().int(),
  durationMs: z.number(),
  rps: z.number(),
  p50: z.number(),
  p95: z.number(),
  p99: z.number(),
  errorRate: z.number(),
  totalRequests: z.number(),
});
import { getActor, recordEvent } from '../services/events.js';
import { recordUsage } from '../services/usage.js';
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
  app.get('/v1/emulators', {
    preHandler: requireScope('read'),
    schema: {
      summary: 'List running emulators',
      description: 'Return every emulator visible to the caller\'s org / project ACLs.',
      response: { 200: zodResponse(EmulatorListResponse) },
    },
  }, async (req) => ({
    data: await filterStoredProjectRecords(ctx, req, ctx.emulators.list()),
  }));

  const allowedHosts = ctx.emulatorAllowedHosts ?? DEFAULT_ALLOWED_HOSTS;

  app.post('/v1/emulators', {
    preHandler: requireScope('write'),
    schema: {
      summary: 'Start an emulator',
      description: 'Boot an emulator serving the specified IR. Host must be in `CARBON_EMULATOR_ALLOWED_HOSTS` (default loopback only) so callers cannot bind to public interfaces on a shared control plane.',
      body: zodBody(CreateBody),
      response: { 201: zodResponse(EmulatorSummary) },
    },
  }, async (req, reply) => {
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
      orgId: project.orgId ?? undefined,
    });
    if (project.orgId) {
      const actor = getActor(req);
      await recordEvent(ctx, {
        orgId: project.orgId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: 'emulator.started',
        metadata: { emulatorId: record.id, projectSlug: project.slug, irId: body.irId },
      });
      await recordUsage(ctx, {
        orgId: project.orgId,
        kind: 'emulator_started',
        amount: 1,
        metadata: { emulatorId: record.id, projectSlug: project.slug },
      });
    }
    reply.status(201);
    return { ...record, projectSlug: project.slug };
  });

  app.get<{ Params: { id: string } }>(
    '/v1/emulators/:id',
    {
      preHandler: requireScope('read'),
      schema: {
        summary: 'Get an emulator by id',
        description: 'Return the emulator\'s current binding and metadata.',
        response: { 200: zodResponse(EmulatorSummary) },
      },
    },
    async (req) => {
    const record = ctx.emulators.get(req.params.id);
    const project = await resolveStoredProjectAccess(ctx, req, record.projectSlug);
    return { ...record, projectSlug: project.slug };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/v1/emulators/:id',
    {
      preHandler: requireScope('write'),
      schema: {
        summary: 'Stop an emulator',
        description: 'Shut down and remove a running emulator.',
      },
    },
    async (req, reply) => {
      const record = ctx.emulators.get(req.params.id);
      const project = await resolveStoredProjectAccess(ctx, req, record.projectSlug);
      await ctx.emulators.stop(req.params.id);
      if (project.orgId) {
        const actor = getActor(req);
        await recordEvent(ctx, {
          orgId: project.orgId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          action: 'emulator.stopped',
          metadata: { emulatorId: req.params.id, projectSlug: project.slug },
        });
        await recordUsage(ctx, {
          orgId: project.orgId,
          kind: 'emulator_stopped',
          amount: 1,
          metadata: { emulatorId: req.params.id, projectSlug: project.slug },
        });
      }
      reply.status(204);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/v1/emulators/:id/reset',
    {
      preHandler: requireScope('write'),
      schema: {
        summary: 'Reset an emulator\'s state',
        description: 'Clear the emulator\'s in-memory state without restarting its HTTP listener.',
      },
    },
    async (req, reply) => {
      const record = ctx.emulators.get(req.params.id);
      await resolveStoredProjectAccess(ctx, req, record.projectSlug);
      await ctx.emulators.reset(req.params.id);
      reply.status(204);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/v1/emulators/:id/snapshot',
    {
      preHandler: requireScope('write'),
      schema: {
        summary: 'Snapshot an emulator',
        description: 'Persist the emulator\'s current state under `name`. Overwrites any existing snapshot with the same name.',
        body: zodBody(SnapshotBody),
        response: { 201: zodResponse(SnapshotAckResponse) },
      },
    },
    async (req, reply) => {
      const body = SnapshotBody.parse(req.body);
      const record = ctx.emulators.get(req.params.id);
      await resolveStoredProjectAccess(ctx, req, record.projectSlug);
      const result = await ctx.emulators.snapshot(req.params.id, body.name);
      reply.status(201);
      return { name: body.name, ...result };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/v1/emulators/:id/restore',
    {
      preHandler: requireScope('write'),
      schema: {
        summary: 'Restore an emulator from a snapshot',
        description: 'Replace the emulator\'s current state with the named snapshot.',
        body: zodBody(RestoreBody),
      },
    },
    async (req, reply) => {
      const body = RestoreBody.parse(req.body);
      const record = ctx.emulators.get(req.params.id);
      const project = await resolveStoredProjectAccess(ctx, req, record.projectSlug);
      await ctx.emulators.restore(req.params.id, body.name);
      if (project.orgId) {
        const actor = getActor(req);
        await recordEvent(ctx, {
          orgId: project.orgId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          action: 'snapshot.restored',
          metadata: { emulatorId: req.params.id, projectSlug: project.slug, name: body.name },
        });
        await recordUsage(ctx, {
          orgId: project.orgId,
          kind: 'snapshot_restored',
          amount: 1,
          metadata: { emulatorId: req.params.id, projectSlug: project.slug, name: body.name },
        });
      }
      reply.status(204);
    },
  );

  const ApplyPresetBody = z.object({ presetId: z.string().min(1).max(80) });

  app.post<{ Params: { id: string } }>(
    '/v1/emulators/:id/apply-preset',
    {
      preHandler: requireScope('write'),
      schema: {
        summary: 'Apply a chaos preset to an emulator',
        description: 'Compile and apply the referenced chaos preset (must be owned by the caller\'s org). Overwrites any active chaos configuration.',
        body: zodBody(ApplyPresetBody),
        response: { 200: zodResponse(ApplyPresetResponse) },
      },
    },
    async (req) => {
      const body = ApplyPresetBody.parse(req.body);
      const record = ctx.emulators.get(req.params.id);
      const project = await resolveStoredProjectAccess(ctx, req, record.projectSlug);
      const orgId = resolveCallerOrg(req, { mode: 'optional' }) ?? project.orgId;
      if (!orgId) {
        throw new InvalidInputError('presets are org-scoped — no org on this request');
      }
      const [preset] = await ctx.db
        .select()
        .from(schema.chaosPresets)
        .where(and(eq(schema.chaosPresets.id, body.presetId), eq(schema.chaosPresets.orgId, orgId)))
        .limit(1);
      if (!preset) throw new NotFoundError('chaos preset', body.presetId);
      const compiled = compileRules(preset.rules as ChaosRule[]);
      ctx.emulators.applyChaos(req.params.id, compiled);
      if (project.orgId) {
        const actor = getActor(req);
        await recordEvent(ctx, {
          orgId: project.orgId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          action: 'chaos_preset.applied',
          metadata: {
            emulatorId: req.params.id,
            presetId: preset.id,
            presetName: preset.name,
          },
        });
      }
      return {
        applied: true,
        presetId: preset.id,
        name: preset.name,
        errorRuleCount: compiled.errorRules.length,
        latency: compiled.latency,
      };
    },
  );

  const LoadTestBody = z.object({
    concurrency: z.number().int().min(1).max(500).default(50),
    // Capped hard — the load runner blocks the API's event loop while it
    // fires and forgets, so a caller that asked for 10 minutes would starve
    // every other route on the same process.
    durationMs: z.number().int().min(100).max(60_000).default(5_000),
    path: z.string().min(1).max(200).default('/'),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']).default('GET'),
  });

  app.post<{ Params: { id: string } }>(
    '/v1/emulators/:id/load-test',
    {
      preHandler: requireScope('write'),
      schema: {
        summary: 'Run a throughput load test',
        description: 'Fire load at the emulator for a bounded duration (max 60s) and return latency percentiles. Blocks the API event loop while running, so durations are capped hard.',
        body: zodBody(LoadTestBody),
        response: { 200: zodResponse(LoadTestResponse) },
      },
    },
    async (req) => {
      const body = LoadTestBody.parse(req.body);
      const record = ctx.emulators.get(req.params.id);
      await resolveStoredProjectAccess(ctx, req, record.projectSlug);
      const base = record.url.replace(/\/+$/, '');
      const path = body.path.startsWith('/') ? body.path : `/${body.path}`;
      const result = await runThroughput({
        url: `${base}${path}`,
        method: body.method,
        concurrency: body.concurrency,
        durationMs: body.durationMs,
      });
      return {
        emulatorId: req.params.id,
        target: `${base}${path}`,
        concurrency: body.concurrency,
        durationMs: result.durationMs,
        rps: result.rps,
        p50: result.p50,
        p95: result.p95,
        p99: result.p99,
        errorRate: result.errorRate,
        totalRequests: result.totalRequests,
      };
    },
  );
}
