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
    deliverWebhook(job.data, { logger: deps.logger }),
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
  maxAttempts?: number;
  timeoutMs?: number;
}

async function deliverWebhook(
  payload: WebhookDeliveryPayload,
  opts: DeliverOpts,
): Promise<{ status: number }> {
  const logger = opts.logger.child({ event: payload.event, url: payload.url });
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxAttempts = opts.maxAttempts ?? 5;
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

  let attempt = 1;
  let lastError: string | null = null;
  while (attempt <= maxAttempts) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(payload.url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.status < 500 && res.status !== 429) {
        logger.info('webhook.delivered', { status: res.status, attempt });
        return { status: res.status };
      }
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      clearTimeout(timer);
      lastError = (err as Error).message;
    }
    const backoff = Math.min(30_000, 500 * 2 ** (attempt - 1));
    logger.warn('webhook.retry', { attempt, backoff, lastError });
    await new Promise((r) => setTimeout(r, backoff));
    attempt++;
  }
  throw new CarbonError({
    code: 'CARBON_INTERNAL',
    message: `Webhook delivery failed after ${maxAttempts} attempts: ${lastError}`,
  });
}
