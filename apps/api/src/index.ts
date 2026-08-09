import { createLogger } from '@carbon/core';
import { createDatabase } from '@carbon/database';
import { FsStorage, S3Storage, type Storage } from '@carbon/storage';
import { createIngestionPipeline } from '@carbon/ingestion';
import { createDefaultParserRegistry } from '@carbon/parser';
import { createIngestionQueue, createRedisConnection } from '@carbon/workers';
import { AiCapabilities, AiJudge, OpenRouterProvider } from '@carbon/ai';
import { loadEnv } from './env.js';
import { buildServer } from './server.js';
import type { AppContext } from './context.js';
import { createEmulatorRegistry } from './services/emulator-registry.js';
import { createJobService } from './services/jobs.js';
import { resolvePlan } from './services/billing.js';
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
    statementTimeoutMs: env.CARBON_DB_STATEMENT_TIMEOUT_MS,
  });
  const storage = buildStorage(env);
  let redis = env.REDIS_URL ? createRedisConnection(env.REDIS_URL) : undefined;
  if (redis) {
    // ioredis auto-reconnects forever by default. When the URL is set but the
    // server is unreachable at boot (dev laptop with no local Redis, ops-day
    // outage, misconfigured env), we get a flood of "connection refused" lines
    // that drown out every other log message. Wait up to 3s for the first
    // connect; if it doesn't come, log one warning and drop the handle.
    const bootDeadlineMs = 3000;
    let firstErrorLogged = false;
    const bootOk = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), bootDeadlineMs);
      redis!.once('ready', () => {
        clearTimeout(timer);
        resolve(true);
      });
      redis!.once('error', () => {
        // Don't resolve here — keep waiting for either `ready` or the timeout,
        // so a transient early error doesn't disable Redis when it would have
        // been usable a moment later.
      });
    });
    if (!bootOk) {
      logger.warn('redis.unreachable', {
        message: 'redis unreachable, disabling redis-dependent features',
      });
      // Detach handlers and quit the client so it stops trying to reconnect.
      try {
        redis.disconnect();
      } catch {
        /* best-effort */
      }
      redis = undefined;
    } else {
      // Post-boot transient errors: log the first at warn, everything after
      // at debug to avoid the log flood the audit called out.
      redis.on('error', (err) => {
        if (!firstErrorLogged) {
          firstErrorLogged = true;
          logger.warn('redis.error', { message: err.message });
        } else {
          logger.debug('redis.error', { message: err.message });
        }
      });
    }
  }
  const parsers = createDefaultParserRegistry();

  const aiProvider = env.CARBON_AI_API_KEY
    ? new OpenRouterProvider({
        apiKey: env.CARBON_AI_API_KEY,
        defaultModel: env.CARBON_AI_MODEL,
        logger,
        // Structured usage record for billing / cost-attribution. Emitted as
        // a `usage.ai.call` log line for now; a log-shipping pipeline picks
        // it up and rolls it into the org's usage bucket.
        onUsage: (evt) => {
          logger.info('usage.ai.call', {
            provider: evt.provider,
            model: evt.model,
            promptTokens: evt.usage.promptTokens,
            completionTokens: evt.usage.completionTokens,
            totalTokens: evt.usage.totalTokens,
            latencyMs: evt.latencyMs,
          });
        },
      })
    : undefined;
  const ai = aiProvider ? new AiCapabilities(aiProvider) : undefined;
  const judge = aiProvider
    ? new AiJudge({ provider: aiProvider, threshold: env.CARBON_AI_JUDGE_THRESHOLD })
    : undefined;

  const ingestion = createIngestionPipeline({ parsers, storage, logger, ai, judge });
  const emulators = createEmulatorRegistry({
    storage,
    logger,
    maxEmulators: env.CARBON_MAX_EMULATORS,
    maxEmulatorsPerOrg: env.CARBON_MAX_EMULATORS_PER_ORG,
    resolvePlan: async (orgId) => (await resolvePlan(orgId, db)).plan,
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
          judgeThreshold: env.CARBON_AI_JUDGE_THRESHOLD,
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
