import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, count, eq, gt } from 'drizzle-orm';
import { CarbonError, makeId, NotFoundError } from '@carbon/core';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import { requireScope } from '../plugins/scopes.js';
import { ProjectSlug } from './project-access.js';

const CreateProjectBody = z.object({
  orgId: z.string().min(1).optional(),
  // Shares the rule used by every path-param route so a project can never be
  // created under a slug those routes would then reject.
  slug: ProjectSlug,
  name: z.string().min(1).max(120),
});

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
  orgId: z.string().optional(),
  /** Costs an extra COUNT(*); off by default. */
  includeTotal: z.coerce.boolean().default(false),
});

export async function registerProjectRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/v1/projects', { preHandler: requireScope('read') }, async (req) => {
    const { limit, cursor, orgId: queryOrgId, includeTotal } = ListQuery.parse(req.query);
    const orgId = requestOrgId(req, queryOrgId);
    const conditions = [];
    if (cursor) conditions.push(gt(schema.projects.id, cursor));
    if (orgId) conditions.push(eq(schema.projects.orgId, orgId));

    // Fetch limit+1 to determine if there's a next page — a common idiom that
    // avoids the extra COUNT round-trip for hot list endpoints.
    let query = ctx.db
      .select()
      .from(schema.projects)
      .orderBy(asc(schema.projects.id))
      .limit(limit + 1)
      .$dynamic();
    if (conditions.length > 0) query = query.where(and(...conditions));
    const rows = await query;

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;

    // COUNT(*) scans the whole table and cannot use the cursor, so it costs
    // the same on page 50 as on page 1 while the caller almost never reads it
    // twice. Compute it only when asked for, and only on the first page.
    const total = includeTotal && !cursor ? await countProjects(ctx, orgId) : null;

    return { data: items, nextCursor, hasMore, total };
  });

  app.post('/v1/projects', { preHandler: requireScope('write') }, async (req, reply) => {
    const body = CreateProjectBody.parse(req.body);
    const orgId = requestOrgId(req, body.orgId);
    if (!orgId) {
      throw new CarbonError({
        code: 'CARBON_INVALID_INPUT',
        message: 'orgId is required when API auth is disabled',
        expose: true,
      });
    }
    const id = makeId('prj');
    await ctx.db.insert(schema.projects).values({
      id,
      orgId,
      slug: body.slug,
      name: body.name,
    });
    reply.status(201);
    return { id, ...body, orgId };
  });

  app.get<{ Params: { id: string } }>(
    '/v1/projects/:id',
    { preHandler: requireScope('read') },
    async (req) => {
    const orgId = requestOrgId(req);
    const where = orgId
      ? and(eq(schema.projects.id, req.params.id), eq(schema.projects.orgId, orgId))
      : eq(schema.projects.id, req.params.id);
    const [row] = await ctx.db.select().from(schema.projects).where(where).limit(1);
    if (!row) throw new NotFoundError('project', req.params.id);
    return row;
    },
  );
}

async function countProjects(ctx: AppContext, orgId: string | undefined): Promise<number> {
  let totalQuery = ctx.db.select({ total: count() }).from(schema.projects).$dynamic();
  if (orgId) totalQuery = totalQuery.where(eq(schema.projects.orgId, orgId));
  const [{ total } = { total: 0 }] = await totalQuery;
  return total;
}

function requestOrgId(req: unknown, fallback?: string): string | undefined {
  return (req as AuthenticatedRequest).apiKey?.orgId ?? fallback;
}
