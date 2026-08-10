import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, lt, type SQL } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { CarbonError } from '@carbon/core';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import { requireScope } from '../plugins/scopes.js';
import { zodQuery, zodResponse } from '../plugins/schema-helpers.js';
import { eventBus, redisChannelForOrg, type PublishedEvent } from '../services/events.js';

const EventSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  projectId: z.string().nullable(),
  actorType: z.string(),
  actorId: z.string().nullable(),
  action: z.string(),
  metadata: z.unknown(),
  createdAt: z.string().datetime(),
});
const EventListResponse = z.object({
  data: z.array(EventSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().datetime().optional(),
  projectId: z.string().min(1).optional(),
  action: z.string().min(1).max(120).optional(),
  // Optional dev/admin escape hatch. Only honored when the caller has no
  // authenticated org — an authenticated caller cannot cross-org via query.
  orgId: z.string().min(1).optional(),
});

const StreamQuery = z.object({
  orgId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  action: z.string().min(1).max(120).optional(),
});

const ExportQuery = z.object({
  format: z.enum(['csv']).default('csv'),
  limit: z.coerce.number().int().min(1).max(10_000).default(1000),
  projectId: z.string().min(1).optional(),
  action: z.string().min(1).max(120).optional(),
  orgId: z.string().min(1).optional(),
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
  app.get('/v1/events', {
    preHandler: requireScope('read'),
    schema: {
      summary: 'List audit events',
      description:
        'Return audit events for the caller\'s org in descending time order. ' +
        'Supports keyset pagination via `cursor` (ISO 8601 timestamp of the last item seen) and ' +
        'optional filtering by `projectId` or `action`.',
      querystring: zodQuery(ListQuery),
      response: { 200: zodResponse(EventListResponse) },
    },
  }, async (req) => {
    const query = ListQuery.parse(req.query);
    const orgId = requestOrgId(req, query.orgId);
    if (!orgId) {
      // Auth-disabled dev mode with no query fallback → return empty rather
      // than 400. Keeps the dashboard's honest "no activity yet" state truthful
      // instead of turning into a red error banner.
      return { data: [], nextCursor: null, hasMore: false };
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

  app.get('/v1/events/stream', {
    preHandler: requireScope('read'),
    // No response schema: this is a text/event-stream long-lived response and
    // Fastify's serializer would otherwise try to shape the reply. We manage
    // the wire format by writing directly to `reply.raw`.
    schema: {
      summary: 'Server-Sent Events stream of audit events',
      description:
        'Long-lived text/event-stream connection. Emits `hello` on open, ' +
        '`ping` heartbeats every ~15s, and `new-event` frames as events land ' +
        'for the caller\'s org.',
      querystring: zodQuery(StreamQuery),
    },
  }, async (req, reply) => {
    const query = StreamQuery.parse(req.query);
    const orgId = requestOrgId(req, query.orgId);
    if (!orgId) {
      throw new CarbonError({
        code: 'CARBON_INVALID_INPUT',
        message: 'orgId is required — attach an API key or authenticated session',
        expose: true,
      });
    }

    const filter = (evt: PublishedEvent): boolean => {
      if (evt.orgId !== orgId) return false;
      if (query.projectId && evt.projectId !== query.projectId) return false;
      if (query.action && evt.action !== query.action) return false;
      return true;
    };

    const raw = reply.raw;
    // Detach Fastify from the socket so we own the write path. Without this,
    // the send() at the end of the handler would try to serialize.
    reply.hijack();

    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Some proxies (nginx) buffer text/event-stream by default; disable that.
      'x-accel-buffering': 'no',
    });

    const connectionId = randomUUID();
    writeSseFrame(raw, 'hello', { connectionId, orgId });

    const onLocal = (evt: PublishedEvent): void => {
      if (!filter(evt)) return;
      writeSseFrame(raw, 'new-event', evt);
    };
    eventBus.on('new-event', onLocal);

    // Cross-instance fanout via Redis pub/sub when available. ioredis requires
    // a dedicated connection for subscribe mode, so we duplicate the shared
    // client and clean it up when the socket closes.
    let subscriber: Redis | undefined;
    if (ctx.redis) {
      try {
        subscriber = ctx.redis.duplicate();
        const channel = redisChannelForOrg(orgId);
        await subscriber.subscribe(channel);
        subscriber.on('message', (_ch, message) => {
          try {
            const evt = JSON.parse(message) as PublishedEvent;
            if (filter(evt)) writeSseFrame(raw, 'new-event', evt);
          } catch {
            // Ignore malformed messages — a stray publish must not tear the
            // stream down for well-behaved subscribers.
          }
        });
      } catch (err) {
        ctx.logger.warn('events.stream.redis_subscribe_failed', {
          message: err instanceof Error ? err.message : String(err),
        });
        subscriber = undefined;
      }
    }

    const heartbeatMs = heartbeatIntervalMs();
    const heartbeat = setInterval(() => {
      writeSseFrame(raw, 'ping', { at: new Date().toISOString() });
    }, heartbeatMs);
    // Timers keeping the process alive would block graceful shutdown when the
    // only remaining work is an idle SSE loop.
    heartbeat.unref?.();

    const cleanup = (): void => {
      clearInterval(heartbeat);
      eventBus.off('new-event', onLocal);
      if (subscriber) {
        subscriber.disconnect();
        subscriber = undefined;
      }
      try {
        raw.end();
      } catch {
        // Socket already gone; nothing to do.
      }
    };

    req.raw.on('close', cleanup);
    req.raw.on('error', cleanup);
  });

  app.get('/v1/events/export', {
    preHandler: requireScope('read'),
    schema: {
      summary: 'Export audit events as CSV',
      description:
        'Stream audit events as a CSV attachment. Same filters as `GET /v1/events` but returns a single denormalized CSV row per event, ' +
        'capped at `limit` (max 10,000).',
      querystring: zodQuery(ExportQuery),
    },
  }, async (req, reply) => {
    const query = ExportQuery.parse(req.query);
    const orgId = requestOrgId(req, query.orgId);
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

function requestOrgId(req: unknown, fallback?: string): string | undefined {
  return (req as AuthenticatedRequest).apiKey?.orgId ?? fallback;
}

/**
 * Serialize an SSE frame. Each frame is `event: <name>\ndata: <json>\n\n`
 * — `data` MUST be a single line for `EventSource` to fire the message, so we
 * JSON-stringify without pretty-printing.
 */
function writeSseFrame(
  raw: import('node:http').ServerResponse,
  event: string,
  data: unknown,
): void {
  if (raw.writableEnded || raw.destroyed) return;
  try {
    raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    // A socket write can race a client-initiated close; the `close` handler
    // will do the cleanup, so swallow here rather than crashing the process.
  }
}

/**
 * Heartbeat interval in ms. Tunable via `CARBON_SSE_HEARTBEAT_MS` primarily
 * so tests can shrink it — production behaviour is a 15s keepalive that
 * clears most reverse-proxy idle timeouts (nginx defaults to 60s).
 */
function heartbeatIntervalMs(): number {
  const raw = process.env.CARBON_SSE_HEARTBEAT_MS;
  if (!raw) return 15_000;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 15_000;
  return parsed;
}
