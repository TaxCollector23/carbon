import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { and, asc, count, eq, gt, isNull, or } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { CarbonError, makeId, NotFoundError } from '@carbon/core';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import type { SessionAuthenticatedRequest } from '../plugins/session-auth.js';
import { requireScope } from '../plugins/scopes.js';
import { getActor, recordEvent } from '../services/events.js';
import { ProjectSlug } from './project-access.js';
import { registerShareLinkRoutes } from './share-links.js';

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
    const actor = getActor(req);
    await recordEvent(ctx, {
      orgId,
      projectId: id,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: 'project.created',
      metadata: { slug: body.slug, name: body.name },
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

  // Per-project ACL — add or remove a specific user's membership.
  // Absence of any project_members row for a project preserves the legacy
  // org-wide behavior (see project-access.ts). Creating the first row for a
  // project effectively narrows access to just those members plus org admins.
  const MemberBody = z.object({
    userId: z.string().min(1),
    role: z.enum(['viewer', 'editor', 'admin']).default('viewer'),
  });

  app.get<{ Params: { id: string } }>(
    '/v1/projects/:id/members',
    { preHandler: requireScope('read') },
    async (req) => {
      const project = await requireProjectInOrg(ctx, req, req.params.id);
      const rows = await ctx.db
        .select()
        .from(schema.projectMembers)
        .where(eq(schema.projectMembers.projectId, project.id));
      return { data: rows };
    },
  );

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/v1/projects/:id/members',
    { preHandler: requireScope('write') },
    async (req, reply) => {
      const project = await requireProjectInOrg(ctx, req, req.params.id);
      const body = MemberBody.parse(req.body);
      const id = makeId('pmb');
      try {
        const [row] = await ctx.db
          .insert(schema.projectMembers)
          .values({ id, projectId: project.id, userId: body.userId, role: body.role })
          .returning();
        reply.status(201);
        const actor = getActor(req);
        await recordEvent(ctx, {
          orgId: project.orgId,
          projectId: project.id,
          actorType: actor.actorType,
          actorId: actor.actorId,
          action: 'project.member_added',
          metadata: { userId: body.userId, role: body.role },
        });
        return row;
      } catch (err) {
        if (err instanceof Error && /duplicate|unique/i.test(err.message)) {
          const [existing] = await ctx.db
            .select()
            .from(schema.projectMembers)
            .where(
              and(
                eq(schema.projectMembers.projectId, project.id),
                eq(schema.projectMembers.userId, body.userId),
              ),
            )
            .limit(1);
          return existing;
        }
        throw err;
      }
    },
  );

  app.delete<{ Params: { id: string; userId: string } }>(
    '/v1/projects/:id/members/:userId',
    { preHandler: requireScope('write') },
    async (req, reply) => {
      const project = await requireProjectInOrg(ctx, req, req.params.id);
      await ctx.db
        .delete(schema.projectMembers)
        .where(
          and(
            eq(schema.projectMembers.projectId, project.id),
            eq(schema.projectMembers.userId, req.params.userId),
          ),
        );
      const actor = getActor(req);
      await recordEvent(ctx, {
        orgId: project.orgId,
        projectId: project.id,
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: 'project.member_removed',
        metadata: { userId: req.params.userId },
      });
      reply.status(204).send();
    },
  );

  await registerShareLinkRoutes(app, ctx, { requireProjectInOrg });
}

export interface ProjectRow {
  id: string;
  orgId: string;
  slug: string;
}

/**
 * Resolve a project by id and confirm the caller's org owns it. Shared with
 * the share-links module to keep authz consistent.
 */
export async function requireProjectInOrg(
  ctx: AppContext,
  req: FastifyRequest,
  projectId: string,
): Promise<ProjectRow> {
  const orgId = requestOrgId(req);
  const where = orgId
    ? and(eq(schema.projects.id, projectId), eq(schema.projects.orgId, orgId))
    : eq(schema.projects.id, projectId);
  const [row] = await ctx.db.select().from(schema.projects).where(where).limit(1);
  if (!row) throw new NotFoundError('project', projectId);
  const apiKey = (req as AuthenticatedRequest).apiKey;
  if (apiKey?.projectIds && !apiKey.projectIds.includes(row.id)) {
    throw new CarbonError({
      code: 'CARBON_FORBIDDEN',
      message: 'API key not scoped to this project',
      expose: true,
    });
  }
  return { id: row.id, orgId: row.orgId, slug: row.slug };
}

// Suppress unused-import warnings when unrelated modules add these later.
void or;
void isNull;
void randomBytes;
void ({} as SessionAuthenticatedRequest);

async function countProjects(ctx: AppContext, orgId: string | undefined): Promise<number> {
  let totalQuery = ctx.db.select({ total: count() }).from(schema.projects).$dynamic();
  if (orgId) totalQuery = totalQuery.where(eq(schema.projects.orgId, orgId));
  const [{ total } = { total: 0 }] = await totalQuery;
  return total;
}

function requestOrgId(req: unknown, fallback?: string): string | undefined {
  return (req as AuthenticatedRequest).apiKey?.orgId ?? fallback;
}
