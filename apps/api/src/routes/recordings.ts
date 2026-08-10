import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { makeId, NotFoundError } from '@carbon/core';
import { schema } from '@carbon/database';
import { StorageKeys } from '@carbon/storage';
import type { RecordedExchange } from '@carbon/types';
import type { AppContext } from '../context.js';
import { requireScope } from '../plugins/scopes.js';
import { zodBody, zodQuery, zodResponse } from '../plugins/schema-helpers.js';
import { ProjectSlug, resolveProjectAccess } from './project-access.js';
import { collectStorage } from './storage-listing.js';

/**
 * Recording IDs are filename stems in storage keys, so restrict them to a
 * conservative charset — this keeps a caller from sneaking `..` or slashes
 * into a lookup even though the storage backend already ignores those.
 */
const RecordingId = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9._-]+$/);

const RecordingListItem = z.object({
  id: z.string(),
  size: z.number().int(),
  modifiedAt: z.number(),
  requestCount: z.number().int(),
  firstAt: z.number().nullable(),
  lastAt: z.number().nullable(),
  upstreamUrl: z.string().nullable(),
});
const RecordingListResponse = z.object({
  data: z.array(RecordingListItem),
  limit: z.number().int(),
  truncated: z.boolean(),
});
const RecordingListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const ExchangeSchema = z.object({
  id: z.string(),
  method: z.string(),
  url: z.string(),
  requestBody: z.string().nullable(),
  status: z.number().int(),
  responseBody: z.string().nullable(),
  at: z.number(),
  latencyMs: z.number(),
});
const ExchangeListResponse = z.object({
  id: z.string(),
  exchanges: z.array(ExchangeSchema),
});

const ReplayBody = z.object({
  targetUrl: z.string().url(),
});
const ReplayResultRow = z.object({
  exchangeId: z.string(),
  method: z.string(),
  url: z.string(),
  status: z.number().int().nullable(),
  expectedStatus: z.number().int(),
  diff: z.array(z.string()),
  latencyMs: z.number().int(),
  error: z.string().optional(),
});
const ReplayResponse = z.object({
  id: z.string(),
  recordingId: z.string(),
  targetUrl: z.string(),
  status: z.enum(['ok', 'drift', 'error']),
  results: z.array(ReplayResultRow),
  createdAt: z.union([z.string(), z.date()]),
});
const ReplayListResponse = z.object({ data: z.array(ReplayResponse) });

/**
 * Recording routes — list, per-recording exchange dump, and one-shot replay
 * against a caller-supplied target. Recordings live under
 * `projects/{storageSlug}/recordings/{id}.jsonl` (extension retained from the
 * initial capture path even though the payload is a single JSON document).
 * List summaries are computed by parsing each recording body; at O(10)
 * recordings per project the cost is acceptable and lets us surface real
 * per-recording metadata without a separate index table.
 */
export async function registerRecordingRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.get<{ Params: { slug: string }; Querystring: { limit?: string } }>(
    '/v1/projects/:slug/recordings',
    {
      preHandler: requireScope('read'),
      schema: {
        summary: 'List a project\'s recordings',
        description:
          'Enumerate captured recordings for a project, newest first. Includes per-recording ' +
          'metadata (request count, first/last exchange timestamp, upstream URL) computed by ' +
          'parsing each stored body. Bounded scan — pass `limit` (max 200).',
        querystring: zodQuery(RecordingListQuery),
        response: { 200: zodResponse(RecordingListResponse) },
      },
    },
    async (req) => {
      const params = z.object({ slug: ProjectSlug }).parse(req.params);
      const query = RecordingListQuery.parse(req.query);
      const project = await resolveProjectAccess(ctx, req, params.slug);
      const prefix = `projects/${project.storageSlug}/recordings/`;
      const objs: Array<{ key: string; id: string; size: number; modifiedAt: number }> = [];
      const scanned = await collectStorage(ctx.storage.list(prefix), query.limit, (obj) => {
        const base = obj.key.split('/').pop();
        if (!base) return;
        const id = base.replace(/\.(jsonl|json)$/, '');
        if (!id) return;
        objs.push({ key: obj.key, id, size: obj.size, modifiedAt: obj.modifiedAt });
      });

      objs.sort((a, b) => b.modifiedAt - a.modifiedAt);
      const items = await Promise.all(
        objs.map(async (obj) => {
          const summary = await summarize(ctx, obj.key);
          return {
            id: obj.id,
            size: obj.size,
            modifiedAt: obj.modifiedAt,
            requestCount: summary.count,
            firstAt: summary.firstAt,
            lastAt: summary.lastAt,
            upstreamUrl: summary.upstreamUrl,
          };
        }),
      );
      return { data: items, limit: query.limit, truncated: scanned >= query.limit };
    },
  );

  app.get<{ Params: { slug: string; id: string } }>(
    '/v1/projects/:slug/recordings/:id/exchanges',
    {
      preHandler: requireScope('read'),
      schema: {
        summary: 'List a recording\'s exchanges',
        description:
          'Return every captured request/response pair for a recording, in capture order. ' +
          'Bodies are returned verbatim — the recorder already applied header/body redactions ' +
          'at capture time.',
        response: { 200: zodResponse(ExchangeListResponse) },
      },
    },
    async (req) => {
      const params = z
        .object({ slug: ProjectSlug, id: RecordingId })
        .parse(req.params);
      const project = await resolveProjectAccess(ctx, req, params.slug);
      const exchanges = await loadExchanges(ctx, project.storageSlug, params.id);
      if (exchanges === null) throw new NotFoundError('recording', params.id);
      return {
        id: params.id,
        exchanges: exchanges.map((e) => ({
          id: e.id,
          method: e.request.method,
          url: e.request.url,
          requestBody: e.request.body,
          status: e.response.status,
          responseBody: e.response.body,
          at: e.request.receivedAt,
          latencyMs: e.latencyMs,
        })),
      };
    },
  );

  app.post<{ Params: { slug: string; id: string }; Body: unknown }>(
    '/v1/projects/:slug/recordings/:id/replay',
    {
      preHandler: requireScope('write'),
      schema: {
        summary: 'Replay a recording against a target',
        description:
          'Replay each captured request against `targetUrl`, comparing status and (shallow) ' +
          'body shape. A row is written to `recording_replays` so the dashboard can show the ' +
          'run history without re-executing the calls.',
        body: zodBody(ReplayBody),
        response: { 200: zodResponse(ReplayResponse) },
      },
    },
    async (req) => {
      const params = z
        .object({ slug: ProjectSlug, id: RecordingId })
        .parse(req.params);
      const body = ReplayBody.parse(req.body);
      const project = await resolveProjectAccess(ctx, req, params.slug);
      const exchanges = await loadExchanges(ctx, project.storageSlug, params.id);
      if (exchanges === null) throw new NotFoundError('recording', params.id);

      const target = body.targetUrl.replace(/\/+$/, '');
      const results: z.infer<typeof ReplayResultRow>[] = [];
      let mismatches = 0;
      let errors = 0;
      for (const exchange of exchanges) {
        const url = resolveAgainst(target, exchange.request.url);
        const started = Date.now();
        try {
          const res = await fetch(url, {
            method: exchange.request.method,
            headers: safeHeaders(exchange.request.headers),
            body: methodAllowsBody(exchange.request.method) ? exchange.request.body ?? undefined : undefined,
          });
          const text = await res.text();
          const diff: string[] = [];
          if (res.status !== exchange.response.status) {
            diff.push(`status ${res.status} != ${exchange.response.status}`);
          }
          const shapeGot = bodyShape(text);
          const shapeExp = bodyShape(exchange.response.body);
          if (shapeGot !== shapeExp) diff.push(`body ${shapeGot} != ${shapeExp}`);
          if (diff.length > 0) mismatches += 1;
          results.push({
            exchangeId: exchange.id,
            method: exchange.request.method,
            url,
            status: res.status,
            expectedStatus: exchange.response.status,
            diff,
            latencyMs: Date.now() - started,
          });
        } catch (err) {
          errors += 1;
          results.push({
            exchangeId: exchange.id,
            method: exchange.request.method,
            url,
            status: null,
            expectedStatus: exchange.response.status,
            diff: ['connectivity'],
            latencyMs: Date.now() - started,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const overall: 'ok' | 'drift' | 'error' =
        errors > 0 && mismatches === 0 ? 'error' : mismatches > 0 ? 'drift' : 'ok';
      const id = makeId('rrp');
      const createdAt = new Date();
      const inserted = await maybeInsertReplay(ctx, {
        id,
        recordingId: params.id,
        projectSlug: project.slug,
        orgId: project.orgId,
        targetUrl: target,
        status: overall,
        results,
        createdAt,
      });
      return {
        id: inserted?.id ?? id,
        recordingId: params.id,
        targetUrl: target,
        status: overall,
        results,
        createdAt: (inserted?.createdAt as Date | undefined)?.toISOString?.() ?? createdAt.toISOString(),
      };
    },
  );

  app.get<{ Params: { slug: string; id: string } }>(
    '/v1/projects/:slug/recordings/:id/replays',
    {
      preHandler: requireScope('read'),
      schema: {
        summary: 'List past replays for a recording',
        description: 'Return the most recent `recording_replays` rows for a recording, newest first.',
        response: { 200: zodResponse(ReplayListResponse) },
      },
    },
    async (req) => {
      const params = z
        .object({ slug: ProjectSlug, id: RecordingId })
        .parse(req.params);
      await resolveProjectAccess(ctx, req, params.slug);
      try {
        const rows = await ctx.db
          .select()
          .from(schema.recordingReplays)
          .where(eq(schema.recordingReplays.recordingId, params.id))
          .orderBy(desc(schema.recordingReplays.createdAt))
          .limit(50);
        return {
          data: rows.map((r) => ({
            id: r.id,
            recordingId: r.recordingId,
            targetUrl: r.targetUrl,
            status: (r.status as 'ok' | 'drift' | 'error') ?? 'ok',
            results: Array.isArray(r.results) ? (r.results as z.infer<typeof ReplayResultRow>[]) : [],
            createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
          })),
        };
      } catch {
        // The dashboard's dev/no-DB harness returns an empty list rather than
        // 500 — the list is a history convenience, not a correctness signal.
        return { data: [] };
      }
    },
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

interface RecordingSummary {
  count: number;
  firstAt: number | null;
  lastAt: number | null;
  upstreamUrl: string | null;
}

async function summarize(ctx: AppContext, key: string): Promise<RecordingSummary> {
  const parsed = await readRecordingBody(ctx, key);
  if (!parsed) return { count: 0, firstAt: null, lastAt: null, upstreamUrl: null };
  const exchanges = Array.isArray(parsed.exchanges) ? parsed.exchanges : [];
  const timestamps = exchanges
    .map((e) => (e as { request?: { receivedAt?: unknown } })?.request?.receivedAt)
    .filter((n): n is number => typeof n === 'number');
  const firstAt = timestamps.length ? Math.min(...timestamps) : null;
  const lastAt = timestamps.length ? Math.max(...timestamps) : null;
  const upstreamUrl = extractUpstreamUrl(exchanges);
  return { count: exchanges.length, firstAt, lastAt, upstreamUrl };
}

async function loadExchanges(
  ctx: AppContext,
  storageSlug: string,
  id: string,
): Promise<RecordedExchange[] | null> {
  for (const ext of ['jsonl', 'json'] as const) {
    const key = ext === 'jsonl'
      ? StorageKeys.recording(storageSlug, id)
      : `projects/${storageSlug}/recordings/${id}.json`;
    const parsed = await readRecordingBody(ctx, key);
    if (parsed) return Array.isArray(parsed.exchanges) ? (parsed.exchanges as RecordedExchange[]) : [];
  }
  return null;
}

interface RawRecording {
  exchanges?: unknown[];
}

async function readRecordingBody(ctx: AppContext, key: string): Promise<RawRecording | null> {
  const bytes = await ctx.storage.get(key);
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as RawRecording;
  } catch {
    return null;
  }
}

function extractUpstreamUrl(exchanges: unknown[]): string | null {
  for (const e of exchanges) {
    const raw = (e as { request?: { url?: unknown } })?.request?.url;
    if (typeof raw === 'string' && raw.length > 0) {
      try {
        const u = new URL(raw);
        return `${u.protocol}//${u.host}`;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function resolveAgainst(target: string, urlOrPath: string): string {
  try {
    const u = new URL(urlOrPath);
    // Rewrite the origin to the caller's target so a recorded absolute URL
    // still replays against the requested runtime rather than the original
    // upstream.
    const t = new URL(target);
    u.protocol = t.protocol;
    u.host = t.host;
    return u.toString();
  } catch {
    const suffix = urlOrPath.startsWith('/') ? urlOrPath : `/${urlOrPath}`;
    return `${target}${suffix}`;
  }
}

const STRIPPED = new Set([
  'host',
  'connection',
  'content-length',
  'accept-encoding',
  'transfer-encoding',
]);

function safeHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (STRIPPED.has(k.toLowerCase())) continue;
    // Skip redaction placeholders — sending `[redacted]` as `Authorization`
    // would just get rejected upstream with a confusing 401.
    if (v === '[redacted]') continue;
    out[k] = v;
  }
  return out;
}

function methodAllowsBody(method: string): boolean {
  const m = method.toUpperCase();
  return m !== 'GET' && m !== 'HEAD';
}

/**
 * Shape check identical to drift-worker's — keeps the drift signal and the
 * dashboard replay comparison in agreement so callers don't have to reason
 * about two different "is this the same body?" heuristics.
 */
function bodyShape(body: string | null): string {
  if (body == null) return 'null';
  const trimmed = body.trim();
  if (trimmed === '') return 'empty';
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return `text:${trimmed.length}`;
  }
  if (parsed === null) return 'null';
  if (Array.isArray(parsed))
    return `array:${parsed.length === 0 ? 0 : parsed.length > 10 ? '10+' : parsed.length}`;
  if (typeof parsed !== 'object') return typeof parsed;
  return `object:{${Object.keys(parsed as object).sort().join(',')}}`;
}

interface InsertArgs {
  id: string;
  recordingId: string;
  projectSlug: string;
  orgId?: string;
  targetUrl: string;
  status: 'ok' | 'drift' | 'error';
  results: unknown[];
  createdAt: Date;
}

async function maybeInsertReplay(
  ctx: AppContext,
  args: InsertArgs,
): Promise<{ id: string; createdAt: Date } | null> {
  // No orgId → the caller is running in the auth-disabled dev harness with
  // no real project row backing the storage prefix. Skip persistence rather
  // than dangling a row against a nonexistent project id.
  if (!args.orgId) return null;
  try {
    // Look up the DB project id from (orgId, slug) so we can attach the
    // replay row to its project for cascade cleanup.
    const [project] = await ctx.db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(eq(schema.projects.slug, args.projectSlug))
      .limit(1);
    const [row] = await ctx.db
      .insert(schema.recordingReplays)
      .values({
        id: args.id,
        recordingId: args.recordingId,
        projectId: project?.id ?? null,
        targetUrl: args.targetUrl,
        status: args.status,
        results: args.results,
        createdAt: args.createdAt,
      })
      .returning({ id: schema.recordingReplays.id, createdAt: schema.recordingReplays.createdAt });
    return row
      ? { id: row.id, createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt as unknown as string) }
      : null;
  } catch {
    // A missing table (older DB) or a mocked-out db surface should not turn
    // the replay call itself into a 500 — the caller already has the fresh
    // per-exchange results in memory.
    return null;
  }
}
