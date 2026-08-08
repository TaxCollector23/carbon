import { createLogger } from '@carbon/core';
import { createDatabase } from '@carbon/database';
import { FsStorage, S3Storage, type Storage } from '@carbon/storage';
import { createIngestionPipeline } from '@carbon/ingestion';
import { createDefaultParserRegistry } from '@carbon/parser';
import { createIngestionQueue, createRedisConnection } from '@carbon/workers';
import { AiCapabilities, OpenRouterProvider } from '@carbon/ai';
import { loadEnv } from './env.js';
import { buildServer } from './server.js';
import type { AppContext } from './context.js';
import { createEmulatorRegistry } from './services/emulator-registry.js';
import { createJobService } from './services/jobs.js';
import { startEmbeddedWorkers } from './workers.js';
import { createLifecycle } from './lifecycle.js';
import { createIngestMetrics } from './plugins/metrics.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger({
    level: env.LOG_LEVEL,
    pretty: env.NODE_ENV !== 'production',
    name: 'api',
  });

  logger.info('api.boot', { env: env.NODE_ENV, port: env.API_PORT });

  const { db } = createDatabase({
    url: env.DATABASE_URL,
    prepare: env.DATABASE_PREPARE,
    ssl: env.NODE_ENV === 'production' ? true : undefined,
  });
  const storage = buildStorage(env);
  const redis = env.REDIS_URL ? createRedisConnection(env.REDIS_URL) : undefined;
  redis?.on('error', (err) => {
    logger.warn('redis.error', { message: err.message });
  });
  const parsers = createDefaultParserRegistry();

  const ai = env.CARBON_AI_API_KEY
    ? new AiCapabilities(
        new OpenRouterProvider({
          apiKey: env.CARBON_AI_API_KEY,
          defaultModel: env.CARBON_AI_MODEL,
          logger,
        }),
      )
    : undefined;

  const ingestion = createIngestionPipeline({ parsers, storage, logger, ai });
  const emulators = createEmulatorRegistry({
    storage,
    logger,
    maxEmulators: env.CARBON_MAX_EMULATORS,
  });
  const jobs = redis ? createJobService({ redis, logger }) : undefined;
  const ingestionQueue = redis ? createIngestionQueue({ connection: redis }) : undefined;
  // One collector, shared between the metrics endpoint (which polls depth and
  // renders series) and the embedded worker (which reports outcomes into the
  // same sink). Skipped entirely when no queue exists.
  const ingestMetrics = ingestionQueue ? createIngestMetrics({ logger }) : undefined;

  const workers =
    env.EMBED_WORKERS && redis && jobs
      ? startEmbeddedWorkers({
          redis,
          logger,
          ingestion,
          jobs,
          ingestConcurrency: env.CARBON_INGEST_CONCURRENCY,
          ingestMetrics: ingestMetrics?.sink,
          redisUrl: env.REDIS_URL,
        })
      : null;
  if (env.EMBED_WORKERS && !redis) {
    logger.warn('api.embedded_workers_skipped', {
      reason: 'REDIS_URL not set — set it to enable webhook delivery',
    });
  }

  const lifecycle = createLifecycle();
  const ctx: AppContext = {
    logger,
    db,
    storage,
    ingestion,
    emulators,
    jobs,
    ingestionQueue,
    redis,
    emulatorAllowedHosts: env.CARBON_EMULATOR_ALLOWED_HOSTS,
  };
  const server = await buildServer(ctx, logger, {
    auth: { mode: env.CARBON_AUTH_MODE },
    allowedOrigins: env.ALLOWED_ORIGINS,
    release: env.CARBON_RELEASE,
    redis,
    rateLimit: { max: env.CARBON_RATE_LIMIT_MAX, windowMs: env.CARBON_RATE_LIMIT_WINDOW_MS },
    metricsToken: env.CARBON_METRICS_TOKEN,
    ingestMetrics,
    requestTimeoutMs: env.CARBON_REQUEST_TIMEOUT_MS,
    trustedProxyHops: env.CARBON_TRUSTED_PROXY_HOPS,
    publicDocs: env.CARBON_PUBLIC_DOCS,
    lifecycle,
  });

  // An unhandled rejection anywhere in a fire-and-forget path (ingest jobs,
  // webhook delivery) would otherwise terminate the process silently under
  // Node's default `--unhandled-rejections=throw`.
  process.on('unhandledRejection', (reason) => {
    logger.error('api.unhandled_rejection', {
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
  process.on('uncaughtException', (err) => {
    // An uncaught exception leaves the process in an undefined state; log it
    // and let the orchestrator restart us rather than limping on.
    logger.error('api.uncaught_exception', { message: err.message, stack: err.stack });
    process.exit(1);
  });

  const address = await server.listen({ host: env.API_HOST, port: env.API_PORT });
  logger.info('api.listening', { address, authMode: env.CARBON_AUTH_MODE });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    // A second SIGTERM (or an impatient operator) must not restart the
    // sequence and reset the force-kill timer.
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info('api.shutdown', { signal, drainMs: env.CARBON_DRAIN_MS });
    const forceKill = setTimeout(() => {
      logger.error('api.shutdown_timeout', {
        message: 'Force exit after 30s — inflight work was dropped',
      });
      process.exit(1);
    }, 30_000);
    forceKill.unref();

    (async () => {
      try {
        // Fail /ready first and keep serving. The load balancer needs to see
        // at least one failed probe before we stop accepting connections, or
        // requests already in flight toward this instance are reset.
        lifecycle.beginDrain();
        if (env.CARBON_DRAIN_MS > 0) {
          await new Promise((resolve) => setTimeout(resolve, env.CARBON_DRAIN_MS));
        }

        await server.close();
        await emulators.shutdown();
        if (workers) await workers.close();
        if (ingestionQueue) await ingestionQueue.close();
        if (redis) await redis.quit();
        clearTimeout(forceKill);
        logger.info('api.shutdown_complete', { signal });
        process.exit(0);
      } catch (err) {
        logger.error('api.shutdown_error', { message: (err as Error).message });
        process.exit(1);
      }
    })();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

function buildStorage(env: ReturnType<typeof loadEnv>): Storage {
  if (env.STORAGE_BACKEND === 's3') {
    if (!env.S3_BUCKET || !env.S3_ACCESS_KEY || !env.S3_SECRET_KEY) {
      console.error(
        'STORAGE_BACKEND=s3 requires S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY (S3_ENDPOINT for R2/MinIO).',
      );
      process.exit(1);
    }
    return new S3Storage({
      bucket: env.S3_BUCKET,
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY,
      prefix: env.S3_PREFIX,
      forcePathStyle: Boolean(env.S3_ENDPOINT),
    });
  }
  return new FsStorage(env.STORAGE_ROOT);
}

main().catch((err) => {
  console.error('Fatal boot error:', err);
  process.exit(1);
});
