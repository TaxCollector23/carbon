import { desc, gt } from 'drizzle-orm';
import { schema, type Database } from '@carbon/database';
import { makeId, type Logger } from '@carbon/core';
import { AiCapabilities, type AiProvider } from '@carbon/ai';

/**
 * Anomaly summarization worker.
 *
 * Scans the recent events log and groups "bursts" — the same action fired
 * more than N times by the same actor within a short window — into a single
 * synthetic `ai.summary` event so operators reviewing the audit log see one
 * bullet instead of one hundred. If an AI provider is available we ask it
 * for a one-sentence summary; otherwise we build a deterministic string
 * (`"actor X repeated action Y 12 times in 4m3s"`) so the feature is useful
 * without any provider configured.
 */
export interface AnomalyWorkerOptions {
  readonly db: Database;
  readonly logger: Logger;
  /** Scan interval, default 1h. */
  readonly intervalMs?: number;
  /** Lookback window per run, default 1h. */
  readonly lookbackMs?: number;
  /** Threshold for a burst, default 5. */
  readonly burstThreshold?: number;
  /** Window inside which repeats count as one burst, default 10m. */
  readonly burstWindowMs?: number;
  readonly skipInitialRun?: boolean;
  readonly provider?: AiProvider | null;
}

export interface AnomalyWorker {
  readonly stop: () => void;
  readonly runOnce: () => Promise<AnomalyRunReport>;
}

export interface AnomalyRunReport {
  readonly eventsScanned: number;
  readonly summariesWritten: number;
}

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_LOOKBACK_MS = 60 * 60 * 1000;
const DEFAULT_BURST_THRESHOLD = 5;
const DEFAULT_BURST_WINDOW_MS = 10 * 60 * 1000;

export function startAnomalyWorker(opts: AnomalyWorkerOptions): AnomalyWorker {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const lookbackMs = opts.lookbackMs ?? DEFAULT_LOOKBACK_MS;
  const burstThreshold = opts.burstThreshold ?? DEFAULT_BURST_THRESHOLD;
  const burstWindowMs = opts.burstWindowMs ?? DEFAULT_BURST_WINDOW_MS;
  const capabilities = opts.provider ? new AiCapabilities(opts.provider) : new AiCapabilities();
  let stopped = false;

  const runOnce = async (): Promise<AnomalyRunReport> => {
    const since = new Date(Date.now() - lookbackMs);
    const rows = await opts.db
      .select({
        id: schema.events.id,
        orgId: schema.events.orgId,
        projectId: schema.events.projectId,
        actorType: schema.events.actorType,
        actorId: schema.events.actorId,
        action: schema.events.action,
        createdAt: schema.events.createdAt,
      })
      .from(schema.events)
      .where(gt(schema.events.createdAt, since))
      .orderBy(desc(schema.events.createdAt))
      .limit(10_000);

    const bursts = groupBursts(rows, burstWindowMs, burstThreshold);
    let summariesWritten = 0;
    for (const burst of bursts) {
      const summary = await summarize(burst, capabilities);
      try {
        await opts.db.insert(schema.events).values({
          id: makeId('evt'),
          orgId: burst.orgId,
          projectId: burst.projectId,
          actorType: 'system',
          actorId: null,
          action: 'ai.summary',
          metadata: {
            summary,
            of: {
              action: burst.action,
              actorId: burst.actorId,
              actorType: burst.actorType,
              count: burst.count,
              from: burst.from.toISOString(),
              to: burst.to.toISOString(),
            },
          },
        });
        summariesWritten++;
      } catch (err) {
        opts.logger.warn('anomaly.insert_failed', {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const report: AnomalyRunReport = {
      eventsScanned: rows.length,
      summariesWritten,
    };
    opts.logger.info('anomaly.run', { ...report });
    return report;
  };

  if (!opts.skipInitialRun) {
    void runOnce().catch((err: unknown) => {
      opts.logger.warn('anomaly.run_failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    });
  }

  const timer = setInterval(() => {
    if (stopped) return;
    void runOnce().catch((err: unknown) => {
      opts.logger.warn('anomaly.run_failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    });
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
    runOnce,
  };
}

interface EventRow {
  id: string;
  orgId: string;
  projectId: string | null;
  actorType: 'user' | 'api_key' | 'system';
  actorId: string | null;
  action: string;
  createdAt: Date;
}

interface Burst {
  orgId: string;
  projectId: string | null;
  actorType: 'user' | 'api_key' | 'system';
  actorId: string | null;
  action: string;
  count: number;
  from: Date;
  to: Date;
}

function groupBursts(rows: readonly EventRow[], windowMs: number, threshold: number): Burst[] {
  // Bucket by (orgId, actorId, action). Within each bucket sort by time and
  // walk forward, emitting a burst whenever `threshold` events fit inside
  // `windowMs`.
  const buckets = new Map<string, EventRow[]>();
  for (const row of rows) {
    if (row.action === 'ai.summary') continue;
    const key = `${row.orgId}|${row.actorType}|${row.actorId ?? ''}|${row.action}`;
    const list = buckets.get(key);
    if (list) list.push(row);
    else buckets.set(key, [row]);
  }

  const bursts: Burst[] = [];
  for (const list of buckets.values()) {
    if (list.length < threshold) continue;
    list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    let start = 0;
    while (start < list.length) {
      let end = start;
      const startTime = list[start]!.createdAt.getTime();
      while (end + 1 < list.length && list[end + 1]!.createdAt.getTime() - startTime <= windowMs) {
        end++;
      }
      const count = end - start + 1;
      if (count >= threshold) {
        const first = list[start]!;
        const last = list[end]!;
        bursts.push({
          orgId: first.orgId,
          projectId: first.projectId,
          actorType: first.actorType,
          actorId: first.actorId,
          action: first.action,
          count,
          from: first.createdAt,
          to: last.createdAt,
        });
        start = end + 1;
      } else {
        start++;
      }
    }
  }
  return bursts;
}

async function summarize(burst: Burst, capabilities: AiCapabilities): Promise<string> {
  const rule = ruleSummary(burst);
  try {
    // The provider is optional — AiCapabilities' free-form explain path
    // requires a provider, so we only ask when one is present. Detect that
    // by attempting to call and catching the "requires provider" error.
    const provider = (capabilities as unknown as { provider?: unknown }).provider;
    if (!provider) return rule;
    const enriched = await capabilities
      .explainEndpoint({
        endpointId: `burst:${burst.action}`,
        ir: {
          version: 1,
          api: {
            name: 'audit-log',
            version: '0',
            source: { kind: 'mixed', ingestedAt: Date.now() },
          },
          servers: [],
          auth: [],
          resources: [],
          endpoints: [],
          relationships: [],
          examples: [],
          meta: { burst },
        },
      })
      .catch(() => rule);
    return enriched || rule;
  } catch {
    return rule;
  }
}

function ruleSummary(burst: Burst): string {
  const durationMs = burst.to.getTime() - burst.from.getTime();
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  const durationLabel =
    seconds >= 60 ? `${Math.round(seconds / 60)}m${seconds % 60}s` : `${seconds}s`;
  const actor = burst.actorId
    ? `${burst.actorType} ${burst.actorId}`
    : `an anonymous ${burst.actorType}`;
  return `${actor} performed ${burst.action} ${burst.count} times in ${durationLabel}.`;
}
