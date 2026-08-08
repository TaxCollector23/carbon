import { createLogger } from '@carbon/core';
import { createIngestionPipeline } from '@carbon/ingestion';
import { createDefaultParserRegistry } from '@carbon/parser';
import { FsStorage, S3Storage, type Storage } from '@carbon/storage';
import {
  createRedisConnection,
  createRedisIngestJobStatusWriter,
  QueueRegistry,
  Queues,
  registerIngestWorker,
} from '@carbon/workers';
import { deliverWebhook } from './handlers/webhook.js';
import { loadEnv } from './env.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger({ level: env.LOG_LEVEL, pretty: true, name: 'workers' });
  logger.info('workers.boot', {
    redis: describeRedisUrl(env.REDIS_URL),
    storage: env.STORAGE_ROOT,
  });

  const storage = buildStorage(env);
  const redis = createRedisConnection(env.REDIS_URL);
  redis.on('error', (err) => logger.warn('redis.error', { message: err.message }));

  const registry = new QueueRegistry({ redis, logger });
  registry.handle(Queues.webhookDelivery, async (job) => deliverWebhook(job.data, { logger }));

  const parsers = createDefaultParserRegistry();
  const ingestion = createIngestionPipeline({ parsers, storage, logger });
  const jobs = createRedisIngestJobStatusWriter({ redis });
  const ingestWorker = registerIngestWorker({
    connection: redis,
    ingestion,
    jobs,
    logger,
    concurrency: env.CARBON_INGEST_CONCURRENCY,
  });

  const shutdown = async (signal: string) => {
    logger.info('workers.shutdown', { signal });
    await ingestWorker.close();
    await registry.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  logger.info('workers.ready');
}

function describeRedisUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.hostname}:${url.port || '6379'}`;
  } catch {
    return 'invalid-url';
  }
}

function buildStorage(env: ReturnType<typeof loadEnv>): Storage {
  if (env.STORAGE_BACKEND === 's3') {
    return new S3Storage({
      bucket: env.S3_BUCKET!,
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY!,
      secretAccessKey: env.S3_SECRET_KEY!,
      prefix: env.S3_PREFIX,
      forcePathStyle: Boolean(env.S3_ENDPOINT),
    });
  }
  return new FsStorage(env.STORAGE_ROOT);
}

main().catch((err) => {
  console.error('Fatal worker boot error:', err);
  process.exit(1);
});
