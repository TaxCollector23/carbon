import { createHmac } from 'node:crypto';
import { CarbonError, type Logger } from '@carbon/core';
import {
  QueueRegistry,
  Queues,
  registerIngestWorker,
  type IngestionRunner,
  type IngestJobStatusWriter,
  type IngestMetricsSink,
  type WebhookDeliveryPayload,
} from '@carbon/workers';
import type { Worker } from 'bullmq';
import type { Redis } from 'ioredis';

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
