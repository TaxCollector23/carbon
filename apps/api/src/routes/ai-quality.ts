import type { FastifyInstance } from 'fastify';
import { and, desc, eq, lt, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { NotFoundError } from '@carbon/core';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import { requireScope } from '../plugins/scopes.js';
import { requireProjectAccessById } from './project-access.js';

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** ISO-8601 createdAt of the last row from the previous page. */
  cursor: z.string().datetime().optional(),
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
    { preHandler: requireScope('read') },
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
    { preHandler: requireScope('read') },
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
