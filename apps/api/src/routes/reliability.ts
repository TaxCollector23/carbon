import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { RELIABILITY_SCENARIO_IDS } from '@carbon/core';
import type { AppContext } from '../context.js';
import { requireScope } from '../plugins/scopes.js';
import { zodBody, zodQuery, zodResponse } from '../plugins/schema-helpers.js';
import { resolveStoredProjectAccess } from './project-access.js';

const RunBody = z.object({
  emulatorId: z.string().min(1).max(120),
  scenario: z.enum(RELIABILITY_SCENARIO_IDS),
  method: z.string().regex(/^[A-Za-z]+$/).optional(),
  path: z.string().min(1).max(2_000).optional(),
  body: z.unknown().optional(),
  expectedStatus: z.number().int().min(100).max(599).optional(),
  timeoutMs: z.number().int().min(100).max(30_000).optional(),
});
const ListQuery = z.object({
  projectSlug: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const IdParams = z.object({ id: z.string().min(1).max(120) });
const ScenarioResponse = z.object({ data: z.array(z.unknown()) });
const RunListResponse = z.object({ data: z.array(z.unknown()) });

function service(ctx: AppContext) {
  if (!ctx.reliability) {
    throw new Error('reliability service is not configured');
  }
  return ctx.reliability;
}

export async function registerReliabilityRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.get(
    '/v1/reliability/scenarios',
    {
      preHandler: requireScope('read'),
      schema: {
        summary: 'List reliability failure scenarios',
        response: { 200: zodResponse(ScenarioResponse) },
      },
    },
    async () => ({ data: service(ctx).scenarios() }),
  );

  app.get(
    '/v1/reliability/runs',
    {
      preHandler: requireScope('read'),
      schema: {
        summary: 'List reliability test reports',
        querystring: zodQuery(ListQuery),
        response: { 200: zodResponse(RunListResponse) },
      },
    },
    async (req) => {
      const query = ListQuery.parse(req.query);
      if (query.projectSlug) {
        await resolveStoredProjectAccess(ctx, req, query.projectSlug);
        return { data: await service(ctx).list(query.projectSlug, query.limit) };
      }
      // A global storage listing is useful in auth-disabled local mode, but it
      // must be narrowed before an authenticated response leaves the process.
      // Use a larger bounded read before ACL filtering so one org's reports do
      // not crowd another org out of the first page.
      const candidates = await service(ctx).list(undefined, 500);
      const visible = [];
      for (const candidate of candidates) {
        try {
          await resolveStoredProjectAccess(ctx, req, candidate.projectSlug);
          visible.push(candidate);
        } catch {
          // Cross-org and deleted-project reports are intentionally invisible.
        }
      }
      return { data: visible.slice(0, query.limit) };
    },
  );

  app.post(
    '/v1/reliability/runs',
    {
      preHandler: requireScope('write'),
      schema: {
        summary: 'Execute a reliability test',
        description:
          'Run one controlled failure against a live Carbon emulator, compare before/after state, persist the report, and restore the baseline.',
        body: zodBody(RunBody),
        response: { 201: zodResponse(z.object({}).passthrough()) },
      },
    },
    async (req, reply) => {
      const body = RunBody.parse(req.body);
      const emulator = ctx.emulators.get(body.emulatorId);
      await resolveStoredProjectAccess(ctx, req, emulator.projectSlug);
      const result = await service(ctx).run(body);
      reply.status(201);
      return result;
    },
  );

  app.get<{ Params: { id: string } }>(
    '/v1/reliability/runs/:id',
    {
      preHandler: requireScope('read'),
      schema: {
        summary: 'Get a reliability test report',
        params: zodQuery(IdParams),
        response: { 200: zodResponse(z.object({}).passthrough()) },
      },
    },
    async (req) => {
      const result = await service(ctx).get(req.params.id);
      await resolveStoredProjectAccess(ctx, req, result.projectSlug);
      return result;
    },
  );

  app.post<{ Params: { id: string } }>(
    '/v1/reliability/runs/:id/rerun',
    {
      preHandler: requireScope('write'),
      schema: {
        summary: 'Rerun a reliability test',
        params: zodQuery(IdParams),
        response: { 201: zodResponse(z.object({}).passthrough()) },
      },
    },
    async (req, reply) => {
      const previous = await service(ctx).get(req.params.id);
      await resolveStoredProjectAccess(ctx, req, previous.projectSlug);
      const result = await service(ctx).rerun(req.params.id);
      reply.status(201);
      return result;
    },
  );
}
