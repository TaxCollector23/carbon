import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { createLogger, isCarbonError, type Logger } from '@carbon/core';
import { registerHealthRoutes } from './routes/health.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerIngestRoutes } from './routes/ingest.js';
import { registerEmulatorRoutes } from './routes/emulators.js';
import { registerSnapshotRoutes } from './routes/snapshots.js';
import { registerApiKeyRoutes } from './routes/api-keys.js';
import { registerApiKeyAuth, type ApiKeyPluginOptions } from './plugins/api-key.js';
import type { AppContext } from './context.js';

export interface BuildServerOptions {
  readonly auth?: ApiKeyPluginOptions;
}

/**
 * Carbon's control-plane HTTP server. Kept intentionally thin: every route is
 * a Zod-validated adapter over a service in the packages/ layer. Business
 * logic never lives inline in a route handler.
 */
export async function buildServer(
  ctx: AppContext,
  logger?: Logger,
  options: BuildServerOptions = {},
): Promise<FastifyInstance> {
  const log = logger ?? createLogger({ level: 'info', pretty: true, name: 'api' });

  const app = Fastify({
    logger: false,
    disableRequestLogging: true,
    trustProxy: true,
    bodyLimit: 10 * 1024 * 1024, // 10MB — big enough for large OpenAPI docs, small enough to reject abuse
  });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(sensible);

  if (options.auth) {
    await registerApiKeyAuth(app, ctx, options.auth);
  }

  app.addHook('onRequest', async (req) => {
    log.debug('api.request', { method: req.method, url: req.url, id: req.id });
  });

  app.setErrorHandler((err, _req, reply) => {
    if (isCarbonError(err)) {
      const status = statusFor(err.code);
      reply.status(status).send({
        error: {
          code: err.code,
          message: err.expose ? err.message : 'Internal error',
          details: err.expose ? err.details : undefined,
        },
      });
      return;
    }
    log.error('api.internal_error', { message: err.message, name: err.name });
    reply.status(500).send({ error: { code: 'CARBON_INTERNAL', message: 'Internal error' } });
  });

  await registerHealthRoutes(app, ctx);
  await registerProjectRoutes(app, ctx);
  await registerIngestRoutes(app, ctx);
  await registerEmulatorRoutes(app, ctx);
  await registerSnapshotRoutes(app, ctx);
  await registerApiKeyRoutes(app, ctx);

  return app;
}

function statusFor(code: string): number {
  switch (code) {
    case 'CARBON_NOT_FOUND':
      return 404;
    case 'CARBON_INVALID_INPUT':
      return 400;
    case 'CARBON_CONFLICT':
      return 409;
    case 'CARBON_UNAUTHENTICATED':
      return 401;
    case 'CARBON_FORBIDDEN':
      return 403;
    case 'CARBON_STATE_VIOLATION':
      return 422;
    default:
      return 500;
  }
}
