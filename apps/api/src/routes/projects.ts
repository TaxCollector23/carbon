import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { makeId, NotFoundError } from '@carbon/core';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';

const CreateProjectBody = z.object({
  orgId: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
});

export async function registerProjectRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/v1/projects', async () => {
    const rows = await ctx.db.select().from(schema.projects);
    return { data: rows };
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
