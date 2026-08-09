import { makeId } from '@carbon/core';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';

export interface RecordUsageInput {
  readonly orgId: string;
  readonly kind: string;
  readonly amount?: number;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Append a metered usage event. Feeds `/v1/usage` aggregates and the future
 * nightly per-org rollup.
 *
 * NEVER throws — a metering failure must not break the caller's write path.
 * This mirrors `recordEvent` in `services/events.ts`.
 */
export async function recordUsage(ctx: AppContext, input: RecordUsageInput): Promise<void> {
  try {
    await ctx.db.insert(schema.usageEvents).values({
      id: makeId('use'),
      orgId: input.orgId,
      kind: input.kind,
      amount: input.amount ?? 1,
      metadata: input.metadata ?? {},
    });
  } catch (err) {
    ctx.logger.warn('usage.record_failed', {
      kind: input.kind,
      orgId: input.orgId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
