import IORedis from 'ioredis';
import { createLogger } from '@carbon/core';
import { createDatabase } from '@carbon/database';
import { FsStorage } from '@carbon/storage';
import {
  createIngestionPipeline,
} from '@carbon/ingestion';
import {
  HarParser,
  OpenApiParser,
  ParserRegistry,
  PostmanParser,
} from '@carbon/parser';
import { AiCapabilities, OpenRouterProvider } from '@carbon/ai';
import { loadEnv } from './env.js';
import { buildServer } from './server.js';
import type { AppContext } from './context.js';
import { createEmulatorRegistry } from './services/emulator-registry.js';
import { startEmbeddedWorkers } from './workers.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger({ level: env.LOG_LEVEL, pretty: env.NODE_ENV !== 'production', name: 'api' });

  logger.info('api.boot', { env: env.NODE_ENV, port: env.API_PORT });

  const { db } = createDatabase({
    url: env.DATABASE_URL,
    ssl: env.NODE_ENV === 'production',
  });
  const storage = new FsStorage(env.STORAGE_ROOT);
  const redis = env.REDIS_URL ? new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null }) : undefined;
  const parsers = new ParserRegistry()
    .register(new OpenApiParser())
    .register(new HarParser())
    .register(new PostmanParser());

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
  const emulators = createEmulatorRegistry({ storage, logger });

  const workers = env.EMBED_WORKERS && redis
    ? startEmbeddedWorkers({ redis, logger })
    : null;
  if (env.EMBED_WORKERS && !redis) {
    logger.warn('api.embedded_workers_skipped', {
      reason: 'REDIS_URL not set — set it to enable webhook delivery',
    });
  }

  const ctx: AppContext = { logger, db, storage, ingestion, emulators };
  const server = await buildServer(ctx, logger, {
    auth: { mode: env.CARBON_AUTH_MODE },
    allowedOrigins: env.ALLOWED_ORIGINS,
    release: env.CARBON_RELEASE,
    redis,
  });

  const address = await server.listen({ host: env.API_HOST, port: env.API_PORT });
  logger.info('api.listening', { address });

  const shutdown = (signal: string) => {
    logger.info('api.shutdown', { signal });
    const forceKill = setTimeout(() => {
      logger.error('api.shutdown_timeout', {
        message: 'Force exit after 15s — inflight work was dropped',
      });
      process.exit(1);
    }, 15_000);
    forceKill.unref();
    (async () => {
      try {
        await server.close();
        await emulators.shutdown();
        if (workers) await workers.close();
        if (redis) await redis.quit();
        clearTimeout(forceKill);
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

main().catch((err) => {
  console.error('Fatal boot error:', err);
  process.exit(1);
});
