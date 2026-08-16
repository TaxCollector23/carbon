import { createHmac } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { CarbonError, type Logger } from '@carbon/core';
import { schema, type Database } from '@carbon/database';
import { StorageKeys } from '@carbon/storage';
import {
  QueueRegistry,
  Queues,
  registerIngestWorker,
  type IngestCompletionHookInput,
  type IngestionRunner,
  type IngestJobStatusWriter,
  type IngestMetricsSink,
  type WebhookDeliveryPayload,
} from '@carbon/workers';
import type { Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { recordAiQualityReport } from './services/ai-quality.js';

/**
 * Embedded workers.
 *
 * When EMBED_WORKERS=true, the API process also runs BullMQ workers so we
 * don't need a second worker process. This is the right shape for early scale
 * — the workers are I/O-bound (fetch, DB writes) and don't compete
 * meaningfully with request handling.
 *
 * Once webhook volume climbs, extract to `apps/workers` (already exists) as
 * its own service. The handlers here are intentionally a subset — webhooks
 * only — so an operator can start there and add more without duplicating logic.
 */
export function startEmbeddedWorkers(deps: {
  redis: Redis;
  logger: Logger;
  db: Database;
  ingestion: IngestionRunner;
  jobs: IngestJobStatusWriter;
  ingestConcurrency?: number;
  ingestMetrics?: IngestMetricsSink;
  /** Raw REDIS_URL, redacted before logging. */
  redisUrl?: string;
  /** Minimum judge score before ingest jobs go to `needs_review`. */
  judgeThreshold?: number;
}): { close: () => Promise<void> } {
  const registry = new QueueRegistry({ redis: deps.redis, logger: deps.logger });

  registry.handle(Queues.webhookDelivery, async (job) =>
    deliverWebhook({ ...job.data, attempt: (job.attemptsMade ?? 0) + 1 }, { logger: deps.logger }),
  );

  const ingestWorker: Worker = registerIngestWorker({
    connection: deps.redis,
    ingestion: deps.ingestion,
    jobs: deps.jobs,
    logger: deps.logger,
    concurrency: deps.ingestConcurrency,
    metrics: deps.ingestMetrics,
    redisUrl: deps.redisUrl,
    judgeThreshold: deps.judgeThreshold,
    onCompletedIngest: (input) =>
      persistAsyncAiQualityReport({
        db: deps.db,
        logger: deps.logger,
        judgeThreshold: deps.judgeThreshold,
        input,
      }),
  });

  deps.logger.info('workers.embedded_ready', {
    queues: ['carbon.webhook.delivery', 'carbon.ingest'],
  });
  return {
    close: async () => {
      await ingestWorker.close();
      await registry.close();
    },
  };
}

async function persistAsyncAiQualityReport(deps: {
  db: Database;
  logger: Logger;
  judgeThreshold?: number;
  input: IngestCompletionHookInput;
}): Promise<void> {
  const { payload, result } = deps.input;
  if (!result.judge || !payload.orgId) return;

  try {
    const projectId = payload.projectId ?? (await lookupProjectId(deps.db, payload));
    if (!projectId) {
      deps.logger.warn('ai_quality.persist_skipped', {
        reason: 'project_not_found',
        statusJobId: payload.statusJobId,
        orgId: payload.orgId,
        projectSlug: payload.publicSlug ?? payload.projectSlug,
      });
      return;
    }

    await recordAiQualityReport(
      { db: deps.db },
      {
        projectId,
        irKey: StorageKeys.ir(payload.projectSlug, result.irId),
        verdicts: result.judge,
        threshold: deps.judgeThreshold ?? 0.75,
      },
    );
  } catch (err) {
    deps.logger.warn('ai_quality.persist_failed', {
      statusJobId: payload.statusJobId,
      projectSlug: payload.publicSlug ?? payload.projectSlug,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

async function lookupProjectId(
  db: Database,
  payload: IngestCompletionHookInput['payload'],
): Promise<string | undefined> {
  if (!payload.orgId) return undefined;
  const publicSlug =
    payload.publicSlug ?? payload.projectSlug.slice(payload.projectSlug.indexOf('/') + 1);
  const [row] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.orgId, payload.orgId), eq(schema.projects.slug, publicSlug)))
    .limit(1);
  return row?.id;
}

interface DeliverOpts {
  logger: Logger;
  timeoutMs?: number;
}

/**
 * Attempt a single delivery. Throws on 5xx / 429 / network error so BullMQ
 * re-enqueues the job under its configured attempts + exponential backoff —
 * we no longer sleep up to 30s inside the handler holding a worker slot.
 * The AbortController + clearTimeout wiring is preserved so a slow upstream
 * cannot leak timers or sockets.
 */
async function deliverWebhook(
  payload: WebhookDeliveryPayload,
  opts: DeliverOpts,
): Promise<{ status: number }> {
  const logger = opts.logger.child({ event: payload.event, url: payload.url });
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const body = JSON.stringify(payload.body);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': 'Carbon-Webhooks/1.0',
    'x-carbon-event': payload.event,
    'x-carbon-attempt': String(payload.attempt ?? 1),
  };
  if (payload.secret) {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac('sha256', payload.secret)
      .update(`${timestamp}.${body}`)
      .digest('hex');
    headers['x-carbon-signature'] = `t=${timestamp},v1=${signature}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(payload.url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });
    if (res.status < 500 && res.status !== 429) {
      logger.info('webhook.delivered', { status: res.status });
      return { status: res.status };
    }
    // Throw so BullMQ retries — do not sleep inside the handler.
    throw new CarbonError({
      code: 'CARBON_INTERNAL',
      message: `Webhook delivery failed: HTTP ${res.status}`,
    });
  } catch (err) {
    if (err instanceof CarbonError) throw err;
    throw new CarbonError({
      code: 'CARBON_INTERNAL',
      message: `Webhook delivery failed: ${(err as Error).message}`,
    });
  } finally {
    clearTimeout(timer);
  }
}
