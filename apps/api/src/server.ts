import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import compress from '@fastify/compress';
import sensible from '@fastify/sensible';
import { ZodError } from 'zod';
import { createLogger, isCarbonError, type Logger } from '@carbon/core';
import { registerHealthRoutes } from './routes/health.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerIngestRoutes } from './routes/ingest.js';
import { registerEmulatorRoutes } from './routes/emulators.js';
import { registerSnapshotRoutes } from './routes/snapshots.js';
import { registerApiKeyRoutes } from './routes/api-keys.js';
import { registerArtifactRoutes } from './routes/artifacts.js';
import { registerJobRoutes } from './routes/jobs.js';
import { registerApiKeyAuth, type ApiKeyPluginOptions } from './plugins/api-key.js';
import { registerIdempotency } from './plugins/idempotency.js';
import { registerControlPlaneRateLimit } from './plugins/rate-limit.js';
import { registerDocs } from './plugins/docs.js';
import { registerMetrics } from './plugins/metrics.js';
import type { Redis } from 'ioredis';
import type { AppContext } from './context.js';

export interface BuildServerOptions {
  readonly auth?: ApiKeyPluginOptions;
  /** Comma-separated origin list, or `*` to allow all. */
  readonly allowedOrigins?: string;
  readonly release?: string;
  /** If provided, enables Idempotency-Key dedup for POST/PATCH/DELETE. */
  readonly redis?: Redis;
  readonly rateLimit?: { max: number; windowMs: number };
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

  const origins = parseOrigins(options.allowedOrigins);
  await app.register(cors, {
    origin: origins === '*' ? true : origins,
    credentials: true,
    exposedHeaders: ['x-request-id', 'x-carbon-key-prefix', 'x-ratelimit-limit', 'x-ratelimit-remaining'],
  });
  await app.register(helmet, {
    // The API serves JSON; we don't need Helmet's HTML-oriented CSP. Turn it
    // off so the response is not weighed down by unused directives.
    contentSecurityPolicy: false,
    // API responses are same-origin from the dashboard, cross-origin from
    // SDKs. crossOriginResourcePolicy 'cross-origin' is the correct posture.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
  await app.register(compress, { global: true, threshold: 1024 });
  await app.register(sensible);
  app.setGenReqId(() => cryptoRandomId());

  // Docs BEFORE routes: @fastify/swagger snapshots the route table at
  // ready-time, so we need every subsequent register() call to be visible.
  await registerDocs(app, options.release ?? 'dev');

  if (options.auth) {
    await registerApiKeyAuth(app, ctx, options.auth);
  }

  if (options.redis) {
    if (options.rateLimit) {
      await registerControlPlaneRateLimit(app, ctx, {
        redis: options.redis,
        max: options.rateLimit.max,
        windowMs: options.rateLimit.windowMs,
      });
    }
    await registerIdempotency(app, ctx, { redis: options.redis });
  }

  app.addHook('onRequest', async (req) => {
    log.debug('api.request', { method: req.method, url: req.url, id: req.id });
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      reply.status(400).send({
        error: {
          code: 'CARBON_INVALID_INPUT',
          message: 'Request validation failed',
          issues: err.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
            code: i.code,
          })),
        },
      });
      return;
    }
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
    log.error('api.internal_error', {
      message: err.message,
      name: err.name,
      url: req.url,
      method: req.method,
    });
    reply.status(500).send({ error: { code: 'CARBON_INTERNAL', message: 'Internal error' } });
  });

  await registerMetrics(app, ctx);
  await registerHealthRoutes(app, ctx, { release: options.release });
  await registerProjectRoutes(app, ctx);
  await registerIngestRoutes(app, ctx);
  await registerEmulatorRoutes(app, ctx);
  await registerSnapshotRoutes(app, ctx);
  await registerApiKeyRoutes(app, ctx);
  await registerArtifactRoutes(app, ctx);
  await registerJobRoutes(app, ctx);

  return app;
}

function parseOrigins(raw: string | undefined): '*' | string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (trimmed === '*') return '*';
  return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
}

function cryptoRandomId(): string {
  // Web crypto is available in Node 20+, avoids a Node-specific import.
  return crypto.randomUUID();
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
