import type { FastifyInstance } from 'fastify';
import { and, desc, eq, lt, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { makeId, NotFoundError } from '@carbon/core';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import { requireScope } from '../plugins/scopes.js';
import { zodBody, zodQuery, zodResponse } from '../plugins/schema-helpers.js';
import { getActor, recordEvent } from '../services/events.js';
import { requireProjectAccessById } from './project-access.js';

/**
 * Drift-check surface: list history, trigger a one-off run, and manage the
 * per-project config the worker (see apps/workers/src/drift-worker.ts) reads.
 *
 * Config is intentionally stored on the latest `recording` artifact's `meta`
 * rather than adding a schema migration for a small handful of fields — the
 * worker already reads `meta.upstreamUrl` there, so this is the same shape,
 * just extended with `intervalMinutes` and `enabled`.
 */

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().datetime().optional(),
});

const DriftStatus = z.enum(['pending', 'running', 'ok', 'drift', 'error']);

// Kept intentionally loose — `result` is free-form JSON and `ranAt`/`createdAt`
// are Postgres timestamps that Fastify serializes on the way out. We validate
// the identifying fields and let everything else pass through.
const DriftCheckRow = z
  .object({
    id: z.string(),
    projectId: z.string(),
    status: DriftStatus,
  })
  .passthrough();

const DriftListResponse = z.object({
  data: z.array(DriftCheckRow),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

const DriftConfig = z.object({
  upstreamUrl: z.string().nullable(),
  intervalMinutes: z
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .nullable(),
  enabled: z.boolean(),
  /** ISO timestamp of the recording artifact the config is bolted onto (null when no recording exists yet). */
  configuredAt: z.string().nullable(),
});

const ConfigPatchBody = z.object({
  upstreamUrl: z.string().url().max(2048).nullable().optional(),
  intervalMinutes: z
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .nullable()
    .optional(),
  enabled: z.boolean().optional(),
});

const RunResponse = z
  .object({
    id: z.string(),
    projectId: z.string(),
    status: DriftStatus,
  })
  .passthrough();

interface RecordingMetaRow {
  id: string;
  meta: Record<string, unknown> | null;
  createdAt: Date | string;
}

async function loadLatestRecording(
  ctx: AppContext,
  projectId: string,
): Promise<RecordingMetaRow | null> {
  const rows = await ctx.db
    .select({
      id: schema.artifacts.id,
      meta: schema.artifacts.meta,
      createdAt: schema.artifacts.createdAt,
    })
    .from(schema.artifacts)
    .where(and(eq(schema.artifacts.projectId, projectId), eq(schema.artifacts.kind, 'recording')))
    .orderBy(desc(schema.artifacts.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    meta: (row.meta as Record<string, unknown> | null) ?? {},
    createdAt: row.createdAt as Date | string,
  };
}

function extractConfig(
  meta: Record<string, unknown> | null,
  createdAt: Date | string | null,
): z.infer<typeof DriftConfig> {
  const src = meta ?? {};
  const upstreamUrl =
    typeof src.upstreamUrl === 'string' && src.upstreamUrl.length > 0 ? src.upstreamUrl : null;
  const rawInterval = src.driftIntervalMinutes;
  const intervalMinutes =
    typeof rawInterval === 'number' && Number.isFinite(rawInterval)
      ? Math.floor(rawInterval)
      : null;
  const rawEnabled = src.driftEnabled;
  const enabled = typeof rawEnabled === 'boolean' ? rawEnabled : upstreamUrl != null;
  const configuredAt =
    createdAt == null
      ? null
      : createdAt instanceof Date
        ? createdAt.toISOString()
        : String(createdAt);
  return { upstreamUrl, intervalMinutes, enabled, configuredAt };
}

export async function registerDriftRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // -------------------------- list drift history --------------------------
  app.get<{ Params: { id: string } }>(
    '/v1/projects/:id/drift',
    {
      preHandler: requireScope('read'),
      schema: {
        summary: 'List drift-check history for a project',
        description:
          'Return drift checks recorded for the project in descending time order. Rows are paginated by keyset on `createdAt`.',
        querystring: zodQuery(ListQuery),
        response: { 200: zodResponse(DriftListResponse) },
      },
    },
    async (req) => {
      const query = ListQuery.parse(req.query);
      await requireProjectAccessById(ctx, req, req.params.id);

      const conditions: SQL[] = [eq(schema.driftChecks.projectId, req.params.id)];
      if (query.cursor) {
        conditions.push(lt(schema.driftChecks.createdAt, new Date(query.cursor)));
      }
      const where = conditions.length === 1 ? conditions[0] : and(...conditions);
      const rows = await ctx.db
        .select()
        .from(schema.driftChecks)
        .where(where)
        .orderBy(desc(schema.driftChecks.createdAt))
        .limit(query.limit + 1);
      const hasMore = rows.length > query.limit;
      const items = hasMore ? rows.slice(0, query.limit) : rows;
      const last = items[items.length - 1];
      const nextCursor =
        hasMore && last?.createdAt instanceof Date ? last.createdAt.toISOString() : null;
      return { data: items, nextCursor, hasMore };
    },
  );

  // ---------------------------- get config --------------------------------
  app.get<{ Params: { id: string } }>(
    '/v1/projects/:id/drift/config',
    {
      preHandler: requireScope('read'),
      schema: {
        summary: 'Get drift-check config',
        description:
          "Return the drift config (upstream URL, cadence, enabled flag) stored on the project's latest recording artifact. Returns an all-null config when no recording exists yet.",
        response: { 200: zodResponse(DriftConfig) },
      },
    },
    async (req) => {
      await requireProjectAccessById(ctx, req, req.params.id);
      const rec = await loadLatestRecording(ctx, req.params.id);
      return extractConfig(rec?.meta ?? null, rec?.createdAt ?? null);
    },
  );

  // ---------------------------- patch config ------------------------------
  app.patch<{ Params: { id: string } }>(
    '/v1/projects/:id/drift/config',
    {
      preHandler: requireScope('admin'),
      schema: {
        summary: 'Update drift-check config',
        description:
          "Merge fields into the project's drift config. Persists onto the latest recording artifact's `meta`. Returns 404 when the project has no recording to attach config to.",
        body: zodBody(ConfigPatchBody),
        response: { 200: zodResponse(DriftConfig) },
      },
    },
    async (req) => {
      const body = ConfigPatchBody.parse(req.body ?? {});
      const access = await requireProjectAccessById(ctx, req, req.params.id);
      const rec = await loadLatestRecording(ctx, req.params.id);
      if (!rec) {
        throw new NotFoundError('recording', req.params.id);
      }
      const merged: Record<string, unknown> = { ...(rec.meta ?? {}) };
      if (body.upstreamUrl !== undefined) merged.upstreamUrl = body.upstreamUrl;
      if (body.intervalMinutes !== undefined) merged.driftIntervalMinutes = body.intervalMinutes;
      if (body.enabled !== undefined) merged.driftEnabled = body.enabled;
      await ctx.db
        .update(schema.artifacts)
        .set({ meta: merged })
        .where(eq(schema.artifacts.id, rec.id));

      if (access.orgId) {
        const actor = getActor(req);
        await recordEvent(ctx, {
          orgId: access.orgId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          action: 'drift.config_updated',
          metadata: { projectId: req.params.id },
        });
      }
      return extractConfig(merged, rec.createdAt);
    },
  );

  // ------------------------------ run now ---------------------------------
  app.post<{ Params: { id: string } }>(
    '/v1/projects/:id/drift/run',
    {
      preHandler: requireScope('admin'),
      schema: {
        summary: 'Enqueue a one-off drift check',
        description:
          'Insert a `pending` row into `drift_checks` for the drift worker to pick up on its next tick. When the worker is not running the row simply stays pending — it is not lost.',
        response: { 202: zodResponse(RunResponse) },
      },
    },
    async (req, reply) => {
      const access = await requireProjectAccessById(ctx, req, req.params.id);
      const id = makeId('drift');
      const now = new Date();
      await ctx.db.insert(schema.driftChecks).values({
        id,
        projectId: req.params.id,
        status: 'pending',
        ranAt: null,
        result: { triggeredBy: 'api', requestedAt: now.toISOString() },
      });
      if (access.orgId) {
        const actor = getActor(req);
        await recordEvent(ctx, {
          orgId: access.orgId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          action: 'drift.run_requested',
          metadata: { projectId: req.params.id, driftCheckId: id },
        });
      }
      reply.status(202);
      return { id, projectId: req.params.id, status: 'pending' as const, createdAt: now };
    },
  );
}
