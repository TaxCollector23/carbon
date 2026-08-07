import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { asc, count, eq, gt } from 'drizzle-orm';
import { makeId, NotFoundError } from '@carbon/core';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';

const CreateProjectBody = z.object({
  orgId: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
});

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
  orgId: z.string().optional(),
});

export async function registerProjectRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/v1/projects', async (req) => {
    const { limit, cursor, orgId } = ListQuery.parse(req.query);
    const conditions = [];
    if (cursor) conditions.push(gt(schema.projects.id, cursor));
    if (orgId) conditions.push(eq(schema.projects.orgId, orgId));

    // Fetch limit+1 to determine if there's a next page — a common idiom that
    // avoids the extra COUNT round-trip for hot list endpoints.
    let query = ctx.db.select().from(schema.projects).orderBy(asc(schema.projects.id)).limit(limit + 1).$dynamic();
    for (const cond of conditions) query = query.where(cond);
    const rows = await query;

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

    const [{ total }] = await ctx.db.select({ total: count() }).from(schema.projects);

    return { data: items, nextCursor, total };
  });

  app.post('/v1/projects', async (req, reply) => {
    const body = CreateProjectBody.parse(req.body);
    const id = makeId('prj');
    await ctx.db.insert(schema.projects).values({
      id,
      orgId: body.orgId,
      slug: body.slug,
      name: body.name,
    });
    reply.status(201);
    return { id, ...body };
  });

  app.get<{ Params: { id: string } }>('/v1/projects/:id', async (req) => {
    const [row] = await ctx.db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, req.params.id))
      .limit(1);
    if (!row) throw new NotFoundError('project', req.params.id);
    return row;
  });
}
