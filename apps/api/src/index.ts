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

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger({ level: env.LOG_LEVEL, pretty: env.NODE_ENV !== 'production', name: 'api' });

  logger.info('api.boot', { env: env.NODE_ENV, port: env.API_PORT });

  const { db } = createDatabase({ url: env.DATABASE_URL });
  const storage = new FsStorage(env.STORAGE_ROOT);
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

  const ctx: AppContext = { logger, db, storage, ingestion };
  const server = await buildServer(ctx, logger);

  const address = await server.listen({ host: env.API_HOST, port: env.API_PORT });
  logger.info('api.listening', { address });

  const shutdown = async (signal: string) => {
    logger.info('api.shutdown', { signal });
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal boot error:', err);
  process.exit(1);
});
