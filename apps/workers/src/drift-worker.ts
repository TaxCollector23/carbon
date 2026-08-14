import { randomUUID } from 'node:crypto';
import { createDatabase, schema, type Database } from '@carbon/database';
import type { Logger } from '@carbon/core';
import type { Storage } from '@carbon/storage';
import { and, desc, eq } from 'drizzle-orm';

export interface DriftWorkerOptions {
  /** Postgres URL. If not present the worker no-ops. */
  readonly databaseUrl?: string;
  readonly intervalMinutes?: number;
  readonly sampleSize?: number;
  readonly logger: Logger;
  readonly storage?: Storage;
  /** Injectable fetch — tests substitute a stub. */
  readonly fetchImpl?: typeof fetch;
}

export interface DriftWorkerHandle {
  /** Cancel the interval timer and stop dispatching new runs. */
  stop(): Promise<void>;
  /** Trigger a run immediately, bypassing the timer. Useful in tests. */
  runOnce(): Promise<void>;
}

/**
 * The drift worker walks every project that has a recording artifact whose
 * meta carries an `upstreamUrl`, replays a bounded sample of recorded requests
 * against that upstream, and writes an entry to `drift_checks` describing the
 * outcome (ok / drift / error).
 *
 * Runs on a fixed cadence (env `DRIFT_INTERVAL_MINUTES`, default 60). When
 * `DATABASE_URL` is not configured the worker is a graceful no-op — this keeps
 * local `pnpm dev` on the workers app usable without Postgres running.
 */
export function startDriftWorker(opts: DriftWorkerOptions): DriftWorkerHandle {
  const logger = opts.logger.child({ worker: 'drift' });
  if (!opts.databaseUrl) {
    logger.info('drift.disabled', { reason: 'DATABASE_URL not set' });
    return { stop: async () => {}, runOnce: async () => {} };
  }

  const { db, sql } = createDatabase({ url: opts.databaseUrl });
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sampleSize = clampInt(opts.sampleSize ?? 5, 1, 100);
  const intervalMs = clampInt(opts.intervalMinutes ?? 60, 1, 24 * 60) * 60_000;

  let running = false;
  const tick = async () => {
    if (running) {
      logger.debug('drift.tick_skipped', { reason: 'previous run in progress' });
      return;
    }
    running = true;
    try {
      await runOnce({ db, fetchImpl, storage: opts.storage, sampleSize, logger });
    } catch (err) {
      logger.warn('drift.tick_error', { message: (err as Error).message });
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  // Don't hold the process open just for this timer.
  timer.unref?.();
  logger.info('drift.started', { intervalMs, sampleSize });

  return {
    stop: async () => {
      clearInterval(timer);
      await sql.end({ timeout: 5 });
      logger.info('drift.stopped');
    },
    runOnce: () => tick(),
  };
}

interface RunCtx {
  db: Database;
  fetchImpl: typeof fetch;
  storage: Storage | undefined;
  sampleSize: number;
  logger: Logger;
}

async function runOnce(ctx: RunCtx): Promise<void> {
  // Grab the latest `recording` artifact per project. We do this in one scan
  // and de-dup by projectId — simpler than a lateral join and cheap at our
  // current scale (a project has O(10) recordings, not O(1M)).
  const recordings = await ctx.db
    .select({
      projectId: schema.artifacts.projectId,
      storageKey: schema.artifacts.storageKey,
      meta: schema.artifacts.meta,
      createdAt: schema.artifacts.createdAt,
    })
    .from(schema.artifacts)
    .where(eq(schema.artifacts.kind, 'recording'))
    .orderBy(desc(schema.artifacts.createdAt));

  const seen = new Set<string>();
  for (const rec of recordings) {
    if (seen.has(rec.projectId)) continue;
    seen.add(rec.projectId);
    const upstreamUrl = extractUpstreamUrl(rec.meta);
    if (!upstreamUrl) continue;
    await checkOne(ctx, rec.projectId, upstreamUrl, rec.storageKey);
  }
}

async function checkOne(
  ctx: RunCtx,
  projectId: string,
  upstreamUrl: string,
  storageKey: string,
): Promise<void> {
  const id = `drift_${randomUUID()}`;
  const startedAt = new Date();
  await ctx.db.insert(schema.driftChecks).values({
    id,
    projectId,
    status: 'running',
    ranAt: startedAt,
    result: { upstreamUrl },
  });
  try {
    const exchanges = await loadExchanges(ctx.storage, storageKey);
    const sample = exchanges.slice(0, ctx.sampleSize);
    const results: Array<Record<string, unknown>> = [];
    let mismatches = 0;
    for (const exchange of sample) {
      const outcome = await replayOne(ctx.fetchImpl, upstreamUrl, exchange);
      results.push(outcome);
      if (outcome.drift) mismatches += 1;
    }
    const status = mismatches === 0 ? 'ok' : 'drift';
    await ctx.db
      .update(schema.driftChecks)
      .set({
        status,
        ranAt: new Date(),
        result: { upstreamUrl, sampled: sample.length, mismatches, results },
      })
      .where(and(eq(schema.driftChecks.id, id), eq(schema.driftChecks.projectId, projectId)));
    ctx.logger.info('drift.checked', { projectId, status, sampled: sample.length, mismatches });
  } catch (err) {
    await ctx.db
      .update(schema.driftChecks)
      .set({
        status: 'error',
        ranAt: new Date(),
        result: { upstreamUrl, error: (err as Error).message },
      })
      .where(eq(schema.driftChecks.id, id));
    ctx.logger.warn('drift.error', { projectId, message: (err as Error).message });
  }
}

async function loadExchanges(
  storage: Storage | undefined,
  storageKey: string,
): Promise<
  Array<{ method: string; url: string; expectedStatus: number; expectedBody: string | null }>
> {
  if (!storage) return [];
  const bytes = await storage.get(storageKey);
  if (!bytes) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return [];
  }
  const raw = (parsed as { exchanges?: unknown }).exchanges;
  if (!Array.isArray(raw)) return [];
  const out: Array<{
    method: string;
    url: string;
    expectedStatus: number;
    expectedBody: string | null;
  }> = [];
  for (const ex of raw) {
    const req = (ex as { request?: { method?: string; url?: string } }).request;
    const res = (ex as { response?: { status?: number; body?: string | null } }).response;
    if (!req?.method || !req?.url || typeof res?.status !== 'number') continue;
    out.push({
      method: req.method,
      url: req.url,
      expectedStatus: res.status,
      expectedBody: res.body ?? null,
    });
  }
  return out;
}

async function replayOne(
  fetchImpl: typeof fetch,
  upstreamUrl: string,
  exchange: { method: string; url: string; expectedStatus: number; expectedBody: string | null },
): Promise<Record<string, unknown>> {
  const target = resolveAgainst(upstreamUrl, exchange.url);
  try {
    const res = await fetchImpl(target, { method: exchange.method });
    const body = await safeText(res);
    const drift =
      res.status !== exchange.expectedStatus ||
      bodyShape(body) !== bodyShape(exchange.expectedBody);
    return {
      url: target,
      method: exchange.method,
      status: res.status,
      expectedStatus: exchange.expectedStatus,
      drift,
    };
  } catch (err) {
    return {
      url: target,
      method: exchange.method,
      drift: true,
      error: (err as Error).message,
    };
  }
}

function resolveAgainst(upstream: string, urlOrPath: string): string {
  try {
    // If exchange.url is absolute, honor it directly.
    return new URL(urlOrPath).toString();
  } catch {
    // Otherwise treat it as a path against the upstream base.
    try {
      return new URL(urlOrPath, upstream).toString();
    } catch {
      return upstream;
    }
  }
}

async function safeText(res: Response): Promise<string | null> {
  try {
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Cheap shape check — good enough for a first-pass drift detector without
 * introducing schema inference. Compares the JSON top-level structure:
 * key-set for objects, length bucket for arrays, or the raw type name.
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
  return `object:{${Object.keys(parsed as object)
    .sort()
    .join(',')}}`;
}

function extractUpstreamUrl(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object') return null;
  const raw = (meta as Record<string, unknown>).upstreamUrl;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function clampInt(value: number, min: number, max: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
