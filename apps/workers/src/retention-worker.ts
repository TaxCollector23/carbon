import { and, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { schema, type Database } from '@carbon/database';
import type { Logger } from '@carbon/core';

/**
 * Retention purge worker.
 *
 * Enterprise orgs may set `organizations.retentionDays` to bound how long
 * snapshots/recordings and audit events are retained. This worker runs on a
 * fixed interval and, for each org with retentionDays set, deletes any
 * artifact (kind in snapshot | recording) or event row older than the org's
 * retention window.
 *
 * We do NOT delete the underlying storage blob — the artifact row is the
 * canonical index; orphan blobs are swept by a separate storage GC.
 */
export interface RetentionWorkerOptions {
  readonly db: Database;
  readonly logger: Logger;
  /** How often to scan (ms). Defaults to 1h. */
  readonly intervalMs?: number;
  /** Skip the initial run-on-start; useful in tests. */
  readonly skipInitialRun?: boolean;
}

export interface RetentionWorker {
  readonly stop: () => void;
  /** Force a run out-of-band (returns counts). Exposed for tests. */
  readonly runOnce: () => Promise<RetentionRunReport>;
}

export interface RetentionRunReport {
  readonly orgsScanned: number;
  readonly artifactsDeleted: number;
  readonly eventsDeleted: number;
}

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

const PURGE_KINDS = ['snapshot', 'recording'] as const;

export function startRetentionWorker(opts: RetentionWorkerOptions): RetentionWorker {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  let stopped = false;

  const runOnce = async (): Promise<RetentionRunReport> => {
    const orgs = await opts.db
      .select({ id: schema.organizations.id, retentionDays: schema.organizations.retentionDays })
      .from(schema.organizations)
      .where(isNotNull(schema.organizations.retentionDays));

    let artifactsDeleted = 0;
    let eventsDeleted = 0;

    for (const org of orgs) {
      const days = org.retentionDays;
      if (!days || days <= 0) continue;
      try {
        // Delete expired artifacts (snapshots + recordings only) for projects
        // owned by this org. Drizzle doesn't compose DELETE...FROM...JOIN
        // portably, so we scope via a project id subquery.
        const projectIds = (
          await opts.db
            .select({ id: schema.projects.id })
            .from(schema.projects)
            .where(eq(schema.projects.orgId, org.id))
        ).map((r) => r.id);

        if (projectIds.length > 0) {
          const cutoff = sql`now() - (${days}::int * interval '1 day')`;
          const deletedArtifacts = await opts.db
            .delete(schema.artifacts)
            .where(
              and(
                inArray(schema.artifacts.projectId, projectIds),
                inArray(schema.artifacts.kind, [...PURGE_KINDS]),
                lt(schema.artifacts.createdAt, cutoff as unknown as Date),
              ),
            )
            .returning({ id: schema.artifacts.id });
          artifactsDeleted += deletedArtifacts.length;
        }

        const cutoffEvents = sql`now() - (${days}::int * interval '1 day')`;
        const deletedEvents = await opts.db
          .delete(schema.events)
          .where(
            and(
              eq(schema.events.orgId, org.id),
              lt(schema.events.createdAt, cutoffEvents as unknown as Date),
            ),
          )
          .returning({ id: schema.events.id });
        eventsDeleted += deletedEvents.length;
      } catch (err) {
        opts.logger.warn('retention.org_failed', {
          orgId: org.id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const report: RetentionRunReport = {
      orgsScanned: orgs.length,
      artifactsDeleted,
      eventsDeleted,
    };
    opts.logger.info('retention.run', { ...report });
    return report;
  };

  if (!opts.skipInitialRun) {
    void runOnce().catch((err: unknown) => {
      opts.logger.warn('retention.run_failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    });
  }

  const timer = setInterval(() => {
    if (stopped) return;
    void runOnce().catch((err: unknown) => {
      opts.logger.warn('retention.run_failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    });
  }, intervalMs);
  // Never let the retention timer keep the process alive on its own.
  if (typeof timer.unref === 'function') timer.unref();

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
    runOnce,
  };
}
