import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, desc, eq, gte, lt, sum, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { CarbonError } from '@carbon/core';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import type { SessionAuthenticatedRequest } from '../plugins/session-auth.js';
import { requireScope } from '../plugins/scopes.js';
import { zodQuery, zodResponse } from '../plugins/schema-helpers.js';

const DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const AggregateResponse = z.object({
  orgId: z.string(),
  since: z.string(),
  until: z.string(),
  totals: z.array(z.object({ kind: z.string(), total: z.number() })),
});

const UsageEvent = z
  .object({
    id: z.string(),
    orgId: z.string(),
    kind: z.string(),
    amount: z.number(),
    metadata: z.unknown().optional(),
    occurredAt: z.union([z.string(), z.date()]).optional(),
  })
  .passthrough();

const UsageEventsResponse = z.object({
  data: z.array(UsageEvent),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

const AggregateQuery = z.object({
  kind: z.string().min(1).max(120).optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
});

const EventsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.string().datetime().optional(),
  kind: z.string().min(1).max(120).optional(),
});

/**
 * Metered usage — surfaces the raw event stream and pre-grouped totals to
 * the dashboard's billing view. Admin-only because usage numbers feed
 * invoicing and are not something a per-project viewer should see.
 */
export async function registerUsageRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/v1/usage', {
    preHandler: requireScope('admin'),
    schema: {
      summary: 'Aggregate usage totals for the caller\'s org',
      description:
        'Return metered usage totals grouped by kind for a time window. Defaults to the last 30 days; narrow with `since`/`until` (ISO 8601). Admin scope required.',
      querystring: zodQuery(AggregateQuery),
      response: { 200: zodResponse(AggregateResponse) },
    },
  }, async (req) => {
    const query = AggregateQuery.parse(req.query);
    const orgId = requireCallerOrg(req);
    const until = query.until ? new Date(query.until) : new Date();
    const since = query.since ? new Date(query.since) : new Date(until.getTime() - DEFAULT_WINDOW_MS);

    const conditions: SQL[] = [
      eq(schema.usageEvents.orgId, orgId),
      gte(schema.usageEvents.occurredAt, since),
      lt(schema.usageEvents.occurredAt, until),
    ];
    if (query.kind) conditions.push(eq(schema.usageEvents.kind, query.kind));
    const where = conditions.length === 1 ? conditions[0] : and(...conditions);

    const rows = await ctx.db
      .select({ kind: schema.usageEvents.kind, total: sum(schema.usageEvents.amount) })
      .from(schema.usageEvents)
      .where(where)
      .groupBy(schema.usageEvents.kind);
    return {
      orgId,
      since: since.toISOString(),
      until: until.toISOString(),
      totals: rows.map((r) => ({ kind: r.kind, total: Number(r.total ?? 0) })),
    };
  });

  app.get('/v1/usage/events', {
    preHandler: requireScope('admin'),
    schema: {
      summary: 'List raw usage events',
      description:
        'Return raw usage events for the caller\'s org in descending time order. Keyset pagination via `cursor` (ISO 8601). Optionally filter by `kind`.',
      querystring: zodQuery(EventsQuery),
      response: { 200: zodResponse(UsageEventsResponse) },
    },
  }, async (req) => {
    const query = EventsQuery.parse(req.query);
    const orgId = requireCallerOrg(req);
    const conditions: SQL[] = [eq(schema.usageEvents.orgId, orgId)];
    if (query.cursor) conditions.push(lt(schema.usageEvents.occurredAt, new Date(query.cursor)));
    if (query.kind) conditions.push(eq(schema.usageEvents.kind, query.kind));
    const where = conditions.length === 1 ? conditions[0] : and(...conditions);
    const rows = await ctx.db
      .select()
      .from(schema.usageEvents)
      .where(where)
      .orderBy(desc(schema.usageEvents.occurredAt))
      .limit(query.limit + 1);
    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last?.occurredAt instanceof Date ? last.occurredAt.toISOString() : null;
    return { data: items, nextCursor, hasMore };
  });
}

function requireCallerOrg(req: FastifyRequest): string {
  const apiKey = (req as AuthenticatedRequest).apiKey;
  const session = (req as SessionAuthenticatedRequest).sessionUser;
  const orgId = apiKey?.orgId ?? session?.orgId;
  if (!orgId) {
    throw new CarbonError({
      code: 'CARBON_INVALID_INPUT',
      message: 'usage is org-scoped — attach an API key or authenticated session',
      expose: true,
    });
  }
  return orgId;
}
