import { and, eq } from 'drizzle-orm';
import { createLogger, makeId, type Logger } from '@carbon/core';
import { createIngestionPipeline } from '@carbon/ingestion';
import { AiCapabilities, AiJudge, OpenRouterProvider } from '@carbon/ai';
import { createDefaultParserRegistry } from '@carbon/parser';
import { FsStorage, S3Storage, StorageKeys, type Storage } from '@carbon/storage';
import {
  createIngestionQueue,
  createRedisConnection,
  createRedisIngestJobStatusWriter,
  type IngestCompletionHookInput,
  QueueRegistry,
  Queues,
  redactRedisUrl,
  registerIngestWorker,
} from '@carbon/workers';
import { createDatabase, schema, type Database } from '@carbon/database';
import { deliverWebhook, startEventNotifier, type EventNotifier } from './handlers/webhook.js';
import { loadEnv } from './env.js';
import { startRetentionWorker, type RetentionWorker } from './retention-worker.js';
import { startAnomalyWorker, type AnomalyWorker } from './anomaly-worker.js';
import { startDriftWorker, type DriftWorkerHandle } from './drift-worker.js';
import { startJobRetryWorker, type JobRetryWorkerHandle } from './job-retry-worker.js';

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
  const database = env.DATABASE_URL
    ? createDatabase({
        url: env.DATABASE_URL,
        prepare: env.DATABASE_PREPARE,
      })
    : undefined;

  const registry = new QueueRegistry({ redis, logger });
  registry.handle(Queues.webhookDelivery, async (job) =>
    deliverWebhook({ ...job.data, attempt: (job.attemptsMade ?? 0) + 1 }, { logger }),
  );

  const parsers = createDefaultParserRegistry();
  const aiProvider = env.CARBON_AI_API_KEY
    ? new OpenRouterProvider({
        apiKey: env.CARBON_AI_API_KEY,
        defaultModel: env.CARBON_AI_MODEL,
        logger,
      })
    : undefined;
  const ai = aiProvider ? new AiCapabilities(aiProvider) : undefined;
  const judge = aiProvider
    ? new AiJudge({ provider: aiProvider, threshold: env.CARBON_AI_JUDGE_THRESHOLD })
    : undefined;
  const ingestion = createIngestionPipeline({ parsers, storage, logger, ai, judge });
  const jobs = createRedisIngestJobStatusWriter({ redis });
  const ingestWorker = registerIngestWorker({
    connection: redis,
    ingestion,
    jobs,
    logger,
    concurrency: env.CARBON_INGEST_CONCURRENCY,
    redisUrl: env.REDIS_URL,
    judgeThreshold: env.CARBON_AI_JUDGE_THRESHOLD,
    onCompletedIngest: database
      ? (input) =>
          persistAsyncAiQualityReport({
            db: database.db,
            logger,
            judgeThreshold: env.CARBON_AI_JUDGE_THRESHOLD,
            input,
          })
      : undefined,
  });

  // Producer-side handle onto the ingest queue for the retry poller. Sharing
  // the Redis connection is fine — BullMQ multiplexes commands over it.
  const ingestQueueProducer = createIngestionQueue({ connection: redis });
  const jobRetry: JobRetryWorkerHandle = startJobRetryWorker({
    redis,
    ingestionQueue: ingestQueueProducer,
    logger,
  });
  logger.info('job_retry.enabled', {});

  let retention: RetentionWorker | undefined;
  let anomaly: AnomalyWorker | undefined;
  let notifier: EventNotifier | undefined;
  let drift: DriftWorkerHandle | undefined;
  if (database) {
    const { db } = database;
    retention = startRetentionWorker({
      db,
      logger,
      intervalMs: env.CARBON_RETENTION_INTERVAL_MS,
    });
    logger.info('retention.enabled', { intervalMs: env.CARBON_RETENTION_INTERVAL_MS });
    anomaly = startAnomalyWorker({ db, logger });
    logger.info('anomaly.enabled', {});
    notifier = startEventNotifier({ db, logger });
    logger.info('notifier.enabled', {});
    drift = startDriftWorker({
      databaseUrl: env.DATABASE_URL,
      intervalMinutes: env.DRIFT_INTERVAL_MINUTES,
      sampleSize: env.DRIFT_SAMPLE_SIZE,
      logger,
      storage,
    });
  } else {
    logger.info('retention.disabled', { reason: 'DATABASE_URL not set' });
    drift = startDriftWorker({ logger });
  }

  const shutdown = async (signal: string) => {
    logger.info('workers.shutdown', { signal });
    retention?.stop();
    anomaly?.stop();
    notifier?.stop();
    if (drift) await drift.stop();
    jobRetry.stop();
    await ingestQueueProducer.close();
    await ingestWorker.close();
    await registry.close();
    if (database) {
      try {
        await database.sql.end({ timeout: 5 });
      } catch (err) {
        logger.warn('workers.db_drain_error', { message: (err as Error).message });
      }
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  logger.info('workers.ready');
}

function describeRedisUrl(raw: string): string {
  return redactRedisUrl(raw) ?? 'invalid-url';
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

async function persistAsyncAiQualityReport(deps: {
  db: Database;
  logger: Logger;
  judgeThreshold: number;
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
        projectSlug: payload.publicSlug ?? publicProjectSlug(payload.projectSlug),
      });
      return;
    }

    const { resources, relationships } = result.judge;
    const minScore = Math.min(resources.score, relationships.score);
    const needsReview = minScore < deps.judgeThreshold;
    const issues = [
      ...resources.issues.map((issue) => ({ ...issue, pass: 'resources' as const })),
      ...relationships.issues.map((issue) => ({ ...issue, pass: 'relationships' as const })),
    ];

    await deps.db.insert(schema.aiQualityReports).values({
      id: makeId('aiq'),
      projectId,
      irKey: StorageKeys.ir(payload.projectSlug, result.irId),
      resourcesScore: resources.score.toFixed(4),
      relationshipsScore: relationships.score.toFixed(4),
      minScore: minScore.toFixed(4),
      issues,
      needsReview,
      model: resources.model ?? relationships.model ?? null,
    });
  } catch (err) {
    deps.logger.warn('ai_quality.persist_failed', {
      statusJobId: payload.statusJobId,
      projectSlug: payload.publicSlug ?? publicProjectSlug(payload.projectSlug),
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

async function lookupProjectId(
  db: Database,
  payload: IngestCompletionHookInput['payload'],
): Promise<string | undefined> {
  if (!payload.orgId) return undefined;
  const [row] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.orgId, payload.orgId),
        eq(schema.projects.slug, payload.publicSlug ?? publicProjectSlug(payload.projectSlug)),
      ),
    )
    .limit(1);
  return row?.id;
}

function publicProjectSlug(storageSlug: string): string {
  const slash = storageSlug.indexOf('/');
  return slash === -1 ? storageSlug : storageSlug.slice(slash + 1);
}

main().catch((err) => {
  console.error('Fatal worker boot error:', err);
  process.exit(1);
});
