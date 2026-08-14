import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, eq } from 'drizzle-orm';
import { CarbonError, makeId, NotFoundError } from '@carbon/core';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import { resolveCallerOrg } from '../plugins/caller-org.js';
import { requireScope } from '../plugins/scopes.js';
import { zodBody, zodResponse, zodResponseWithExample } from '../plugins/schema-helpers.js';
import { getActor, recordEvent } from '../services/events.js';

const ChaosPresetSchema = z
  .object({
    id: z.string(),
    orgId: z.string(),
    name: z.string(),
    description: z.string().nullable().optional(),
    rules: z.array(z.unknown()),
    builtIn: z.boolean().optional(),
    createdAt: z.union([z.string(), z.date()]).optional(),
  })
  .passthrough();
const ChaosPresetListResponse = z.object({ data: z.array(ChaosPresetSchema) });

const RuleSchema = z.object({
  kind: z.enum(['error', 'latency']),
  match: z
    .object({
      method: z.string().min(1).max(10).optional(),
      path: z.string().min(1).max(200).optional(),
    })
    .optional(),
  probability: z.number().min(0).max(1).optional(),
  status: z.number().int().min(100).max(599).optional(),
  body: z.unknown().optional(),
  floorMs: z.number().int().min(0).max(60_000).optional(),
  jitterMs: z.number().int().min(0).max(60_000).optional(),
});

const CreateBody = z.object({
  name: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9-_]*$/i),
  description: z.string().max(500).optional(),
  rules: z.array(RuleSchema).min(1).max(50),
});

export async function registerChaosPresetRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.get(
    '/v1/chaos-presets',
    {
      preHandler: requireScope('read'),
      schema: {
        summary: 'List chaos presets',
        description: "Return every chaos preset visible to the caller's org, sorted by name.",
        response: {
          200: zodResponseWithExample(ChaosPresetListResponse, {
            data: [
              {
                id: 'chaos_01HXK5H7Q9C0R3Q1S8V6M4WJZK',
                orgId: 'org_01HXK5H7Q9C0R3Q1S8V6M4WJZK',
                name: 'flaky-checkout',
                description: '10% 500s and 200ms latency on POST /orders',
                rules: [
                  {
                    kind: 'error',
                    match: { method: 'POST', path: '/orders' },
                    probability: 0.1,
                    status: 500,
                  },
                  { kind: 'latency', match: { path: '/orders' }, floorMs: 200, jitterMs: 50 },
                ],
                builtIn: false,
                createdAt: '2025-11-14T18:22:41.000Z',
              },
            ],
          }),
        },
      },
    },
    async (req) => {
      const orgId = resolveCallerOrg(req, {
        queryOrg: readQueryOrg(req),
        message: 'orgId is required — presets are org-scoped',
      });
      const rows = await ctx.db
        .select()
        .from(schema.chaosPresets)
        .where(eq(schema.chaosPresets.orgId, orgId))
        .orderBy(asc(schema.chaosPresets.name));
      return { data: rows };
    },
  );

  app.post(
    '/v1/chaos-presets',
    {
      preHandler: requireScope('write'),
      schema: {
        summary: 'Create a chaos preset',
        description:
          "Register a named chaos preset scoped to the caller's org. Names are unique per org; duplicates return 409.",
        body: zodBody(CreateBody),
        response: { 201: zodResponse(ChaosPresetSchema) },
      },
    },
    async (req, reply) => {
      const body = CreateBody.parse(req.body);
      const orgId = resolveCallerOrg(req, {
        queryOrg: readQueryOrg(req),
        message: 'orgId is required — presets are org-scoped',
      });
      const id = makeId('chaos');
      try {
        await ctx.db.insert(schema.chaosPresets).values({
          id,
          orgId,
          name: body.name,
          description: body.description,
          rules: body.rules,
          builtIn: false,
        });
      } catch (err) {
        // Unique (orgId, name) violation: return a 409 rather than 500.
        if (err instanceof Error && /unique/i.test(err.message)) {
          throw new CarbonError({
            code: 'CARBON_CONFLICT',
            message: `chaos preset "${body.name}" already exists`,
            expose: true,
          });
        }
        throw err;
      }
      const actor = getActor(req);
      await recordEvent(ctx, {
        orgId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: 'chaos_preset.created',
        metadata: { presetId: id, name: body.name },
      });
      reply.status(201);
      return { id, orgId, name: body.name, description: body.description, rules: body.rules };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/v1/chaos-presets/:id',
    {
      preHandler: requireScope('admin'),
      schema: {
        summary: 'Delete a chaos preset',
        description:
          "Delete a chaos preset owned by the caller's org. Built-in presets and cross-org ids return 404.",
      },
    },
    async (req, reply) => {
      const orgId = resolveCallerOrg(req, {
        queryOrg: readQueryOrg(req),
        message: 'orgId is required — presets are org-scoped',
      });
      // Never let a caller delete another org's presets — a shared control
      // plane where every DELETE was global-scope would be a trivial escalation.
      const deleted = await ctx.db
        .delete(schema.chaosPresets)
        .where(
          and(
            eq(schema.chaosPresets.id, req.params.id),
            eq(schema.chaosPresets.orgId, orgId),
            // Built-ins are re-seeded on boot; deleting one is misleading — the
            // preset would reappear the next time the API starts. Reject
            // outright so an operator learns immediately.
            eq(schema.chaosPresets.builtIn, false),
          ),
        )
        .returning({ id: schema.chaosPresets.id });
      if (deleted.length === 0) throw new NotFoundError('chaos preset', req.params.id);
      reply.status(204);
    },
  );
}

// Dev/admin escape hatch — dashboard in auth-disabled mode passes
// ?orgId=… via the api-client's withOrgQuery helper.
function readQueryOrg(req: unknown): string | undefined {
  const q = (req as { query?: { orgId?: unknown } }).query?.orgId;
  return typeof q === 'string' && q.length > 0 ? q : undefined;
}
