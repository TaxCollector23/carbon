import { createLogger } from '@carbon/core';
import { FsStorage } from '@carbon/storage';
import { QueueRegistry, Queues } from '@carbon/workers';
import { deliverWebhook } from './handlers/webhook.js';
import { makeIngestHandler } from './handlers/ingest.js';
import { loadEnv } from './env.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger({ level: env.LOG_LEVEL, pretty: true, name: 'workers' });
  logger.info('workers.boot', { redis: env.REDIS_URL, storage: env.STORAGE_ROOT });

  const storage = new FsStorage(env.STORAGE_ROOT);
  const registry = new QueueRegistry({ redis: env.REDIS_URL, logger });

  registry.handle(Queues.webhookDelivery, async (job) =>
    deliverWebhook(job.data, { logger }),
  );

  const ingestHandler = makeIngestHandler({ storage, logger });
  registry.handle(Queues.ingest, async (job) => {
    await ingestHandler(job.data);
  });

  const shutdown = async (signal: string) => {
    logger.info('workers.shutdown', { signal });
    await registry.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  logger.info('workers.ready');
}

main().catch((err) => {
  console.error('Fatal worker boot error:', err);
  process.exit(1);
});
