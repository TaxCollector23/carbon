import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, lt, type SQL } from 'drizzle-orm';
import { CarbonError } from '@carbon/core';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import { requireScope } from '../plugins/scopes.js';

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().datetime().optional(),
  projectId: z.string().min(1).optional(),
  action: z.string().min(1).max(120).optional(),
});

const ExportQuery = z.object({
  format: z.enum(['csv']).default('csv'),
  limit: z.coerce.number().int().min(1).max(10_000).default(1000),
  projectId: z.string().min(1).optional(),
  action: z.string().min(1).max(120).optional(),
});

interface EventRow {
  id: string;
  orgId: string;
  projectId: string | null;
  actorType: string;
  actorId: string | null;
  action: string;
  metadata: unknown;
  createdAt: Date;
}

export async function registerEventRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/v1/events', { preHandler: requireScope('read') }, async (req) => {
    const query = ListQuery.parse(req.query);
    const orgId = requestOrgId(req);
    if (!orgId) {
      throw new CarbonError({
        code: 'CARBON_INVALID_INPUT',
        message: 'orgId is required — attach an API key or authenticated session',
        expose: true,
      });
    }
    const rows = await fetchEvents(ctx, {
      orgId,
      limit: query.limit + 1,
      cursor: query.cursor ? new Date(query.cursor) : undefined,
      projectId: query.projectId,
      action: query.action,
    });
    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const last = items[items.length - 1];
    const nextCursor = hasMore && last ? last.createdAt.toISOString() : null;
    return { data: items, nextCursor, hasMore };
  });

  app.get('/v1/events/export', { preHandler: requireScope('read') }, async (req, reply) => {
    const query = ExportQuery.parse(req.query);
    const orgId = requestOrgId(req);
    if (!orgId) {
      throw new CarbonError({
        code: 'CARBON_INVALID_INPUT',
        message: 'orgId is required — attach an API key or authenticated session',
        expose: true,
      });
    }
    const rows = await fetchEvents(ctx, {
      orgId,
      limit: query.limit,
      projectId: query.projectId,
      action: query.action,
    });
    const header = 'id,createdAt,orgId,projectId,actorType,actorId,action,metadata';
    const lines = [header];
    for (const row of rows) {
      lines.push(
        [
          row.id,
          row.createdAt.toISOString(),
          row.orgId,
          row.projectId ?? '',
          row.actorType,
          row.actorId ?? '',
          row.action,
          JSON.stringify(row.metadata ?? {}),
        ]
          .map(csvEscape)
          .join(','),
      );
    }
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="events-${Date.now()}.csv"`);
    return lines.join('\n');
  });
}

interface FetchEventsInput {
  readonly orgId: string;
  readonly limit: number;
  readonly cursor?: Date;
  readonly projectId?: string;
  readonly action?: string;
}

async function fetchEvents(ctx: AppContext, input: FetchEventsInput): Promise<EventRow[]> {
  const conditions: SQL[] = [eq(schema.events.orgId, input.orgId)];
  if (input.cursor) conditions.push(lt(schema.events.createdAt, input.cursor));
  if (input.projectId) conditions.push(eq(schema.events.projectId, input.projectId));
  if (input.action) conditions.push(eq(schema.events.action, input.action));
  const where = conditions.length === 1 ? conditions[0] : and(...conditions);
  const rows = await ctx.db
    .select()
    .from(schema.events)
    .where(where)
    .orderBy(desc(schema.events.createdAt))
    .limit(input.limit);
  return rows as EventRow[];
}

function csvEscape(value: string): string {
  // Wrap values containing separators, quotes, or newlines. Everything else
  // stays bare so a plain audit line reads cleanly in `less` or Excel alike.
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function requestOrgId(req: unknown): string | undefined {
  return (req as AuthenticatedRequest).apiKey?.orgId;
}
