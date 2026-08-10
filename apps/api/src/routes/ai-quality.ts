import type { FastifyInstance } from 'fastify';
import { and, desc, eq, lt, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { NotFoundError } from '@carbon/core';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import { requireScope } from '../plugins/scopes.js';
import { zodQuery, zodResponse, zodResponseWithExample } from '../plugins/schema-helpers.js';
import { requireProjectAccessById } from './project-access.js';

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** ISO-8601 createdAt of the last row from the previous page. */
  cursor: z.string().datetime().optional(),
});

const AiQualityReport = z
  .object({
    id: z.string(),
    projectId: z.string(),
    irKey: z.string().nullable().optional(),
    score: z.number().nullable().optional(),
    verdicts: z.unknown().optional(),
    createdAt: z.union([z.string(), z.date()]).optional(),
  })
  .passthrough();
const AiQualityListResponse = z.object({
  data: z.array(AiQualityReport),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

/**
 * Historical AI-quality reports for a project. One row is written per ingest
 * with the judge enabled; scores and issues stay queryable independent of the
 * IR blob so the dashboard's "AI quality" view stays fast.
 */
export async function registerAiQualityRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.get<{ Params: { id: string } }>(
    '/v1/projects/:id/ai-quality',
    {
      preHandler: requireScope('read'),
      schema: {
        summary: 'List AI-quality reports for a project',
        description:
          'Return historical AI-quality reports for a project in descending time order. Supports keyset pagination via `cursor` (ISO 8601 timestamp).',
        querystring: zodQuery(ListQuery),
        response: { 200: zodResponse(AiQualityListResponse) },
      },
    },
    async (req) => {
      const query = ListQuery.parse(req.query);
      await requireProjectAccessById(ctx, req, req.params.id);

      const conditions: SQL[] = [eq(schema.aiQualityReports.projectId, req.params.id)];
      if (query.cursor) {
        conditions.push(lt(schema.aiQualityReports.createdAt, new Date(query.cursor)));
      }
      const where = conditions.length === 1 ? conditions[0] : and(...conditions);
      const rows = await ctx.db
        .select()
        .from(schema.aiQualityReports)
        .where(where)
        .orderBy(desc(schema.aiQualityReports.createdAt))
        .limit(query.limit + 1);
      const hasMore = rows.length > query.limit;
      const items = hasMore ? rows.slice(0, query.limit) : rows;
      const last = items[items.length - 1];
      const nextCursor =
        hasMore && last?.createdAt instanceof Date ? last.createdAt.toISOString() : null;
      return { data: items, nextCursor, hasMore };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/v1/projects/:id/ai-quality/latest',
    {
      preHandler: requireScope('read'),
      schema: {
        summary: 'Get the latest AI-quality report for a project',
        description: 'Return the most recent AI-quality report row for the given project. 404 if no reports exist yet.',
        response: {
          200: zodResponseWithExample(AiQualityReport, {
            id: 'aiq_01HXK5N9Q1B7C4D3E2F1G0H9J8',
            projectId: 'prj_01HXK5H7Q9C0R3Q1S8V6M4WJZK',
            irKey: 'projects/checkout-api/ir/01HXK5N9Q1.json',
            score: 0.87,
            verdicts: {
              coverage: { score: 0.92, notes: 'All 34 operations covered.' },
              consistency: { score: 0.82, notes: '2 response shapes drift between GET and POST.' },
            },
            createdAt: '2025-11-14T18:22:41.000Z',
          }),
        },
      },
    },
    async (req) => {
      await requireProjectAccessById(ctx, req, req.params.id);
      const [row] = await ctx.db
        .select()
        .from(schema.aiQualityReports)
        .where(eq(schema.aiQualityReports.projectId, req.params.id))
        .orderBy(desc(schema.aiQualityReports.createdAt))
        .limit(1);
      if (!row) throw new NotFoundError('ai_quality_report', req.params.id);
      return row;
    },
  );
}
