import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { asc, eq } from 'drizzle-orm';
import { makeId, NotFoundError } from '@carbon/core';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import { requireScope } from '../plugins/scopes.js';
import { zodBody, zodQuery, zodResponse } from '../plugins/schema-helpers.js';
import { getActor, recordEvent } from '../services/events.js';
import { requireProjectAccessById } from './project-access.js';

const AssertionKind = z.enum(['latency', 'field', 'status']);

const AssertionSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    name: z.string(),
    endpoint: z.string().nullable().optional(),
    kind: AssertionKind,
    config: z.record(z.unknown()),
    enabled: z.boolean(),
    createdAt: z.union([z.string(), z.date()]).optional(),
  })
  .passthrough();
const AssertionListResponse = z.object({ data: z.array(AssertionSchema) });

const CreateBody = z.object({
  projectId: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  endpoint: z.string().min(1).max(200).optional().nullable(),
  kind: AssertionKind,
  config: z.record(z.unknown()).default({}),
  enabled: z.boolean().default(true),
});

const UpdateBody = CreateBody.partial().omit({ projectId: true });

const ListQuery = z.object({
  projectId: z.string().min(1).max(80).optional(),
});

export async function registerAssertionRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.get('/v1/assertions', {
    preHandler: requireScope('read'),
    schema: {
      summary: 'List assertion rules',
      description: 'Return every assertion rule, optionally scoped by `projectId`.',
      querystring: zodQuery(ListQuery),
      response: { 200: zodResponse(AssertionListResponse) },
    },
  }, async (req) => {
    const { projectId } = ListQuery.parse(req.query);
    const where = projectId ? eq(schema.assertionRules.projectId, projectId) : undefined;
    const q = ctx.db.select().from(schema.assertionRules).orderBy(asc(schema.assertionRules.name)).$dynamic();
    const rows = where ? await q.where(where) : await q;
    return { data: rows };
  });

  app.post('/v1/assertions', {
    preHandler: requireScope('write'),
    schema: {
      summary: 'Create an assertion rule',
      description:
        'Create a declarative response assertion targeting `projectId`. Caller must have write access to the project.',
    },
  }, async (req, reply) => {
    const body = CreateBody.parse(req.body);
    // Assertions target a specific project — confirm the caller can act on
    // it before we spend a write on their behalf.
    await requireProjectAccessById(ctx, req, body.projectId);
    const id = makeId('asrt');
    await ctx.db.insert(schema.assertionRules).values({
      id,
      projectId: body.projectId,
      name: body.name,
      endpoint: body.endpoint ?? null,
      kind: body.kind,
      config: body.config,
      enabled: body.enabled,
    });
    const orgId = (req as AuthenticatedRequest).apiKey?.orgId;
    if (orgId) {
      const actor = getActor(req);
      await recordEvent(ctx, {
        orgId,
        projectId: body.projectId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: 'assertion.created',
        metadata: { assertionId: id, kind: body.kind, name: body.name },
      });
    }
    reply.status(201);
    return { id, ...body };
  });

  app.patch<{ Params: { id: string } }>(
    '/v1/assertions/:id',
    {
      preHandler: requireScope('write'),
      schema: {
        summary: 'Update an assertion rule',
        description: 'Partially update an assertion. Omitted fields are left untouched. Returns the current row when the body is empty.',
        body: zodBody(UpdateBody),
      },
    },
    async (req) => {
      const body = UpdateBody.parse(req.body ?? {});
      const patch: Record<string, unknown> = {};
      if (body.name !== undefined) patch.name = body.name;
      if (body.endpoint !== undefined) patch.endpoint = body.endpoint;
      if (body.kind !== undefined) patch.kind = body.kind;
      if (body.config !== undefined) patch.config = body.config;
      if (body.enabled !== undefined) patch.enabled = body.enabled;
      if (Object.keys(patch).length === 0) {
        const [row] = await ctx.db
          .select()
          .from(schema.assertionRules)
          .where(eq(schema.assertionRules.id, req.params.id))
          .limit(1);
        if (!row) throw new NotFoundError('assertion', req.params.id);
        return row;
      }
      const [updated] = await ctx.db
        .update(schema.assertionRules)
        .set(patch)
        .where(eq(schema.assertionRules.id, req.params.id))
        .returning();
      if (!updated) throw new NotFoundError('assertion', req.params.id);
      return updated;
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/v1/assertions/:id',
    {
      preHandler: requireScope('write'),
      schema: {
        summary: 'Delete an assertion rule',
        description: 'Delete an assertion by id. 404 if the id is unknown.',
      },
    },
    async (req, reply) => {
      const deleted = await ctx.db
        .delete(schema.assertionRules)
        .where(eq(schema.assertionRules.id, req.params.id))
        .returning({ id: schema.assertionRules.id });
      if (deleted.length === 0) throw new NotFoundError('assertion', req.params.id);
      reply.status(204);
    },
  );
}

/**
 * Reusable violation sink — installed on an emulator via
 * `emulators.installAssertions(id, rules, buildViolationSink(ctx, ...))`. Every
 * violation lands as an `assertion.violated` event so operators can drill into
 * per-endpoint failure history.
 */
export function buildViolationSink(
  ctx: AppContext,
  scope: { orgId: string; projectId: string },
): (
  rule: { id: string; name: string; kind: string },
  violation: { method: string; url: string; status: number; durationMs: number; detail?: string },
) => Promise<void> {
  return async (rule, violation) => {
    await recordEvent(ctx, {
      orgId: scope.orgId,
      projectId: scope.projectId,
      actorType: 'system',
      action: 'assertion.violated',
      metadata: {
        assertionId: rule.id,
        assertionName: rule.name,
        kind: rule.kind,
        method: violation.method,
        url: violation.url,
        status: violation.status,
        durationMs: violation.durationMs,
        detail: violation.detail,
      },
    });
  };
}

