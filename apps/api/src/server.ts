import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import type { IncomingMessage } from 'node:http';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import compress from '@fastify/compress';
import sensible from '@fastify/sensible';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { createLogger, isCarbonError, type CarbonError, type Logger } from '@carbon/core';
import { registerHealthRoutes } from './routes/health.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerIngestRoutes } from './routes/ingest.js';
import { registerEmulatorRoutes } from './routes/emulators.js';
import { registerSnapshotRoutes } from './routes/snapshots.js';
import { registerApiKeyRoutes } from './routes/api-keys.js';
import { registerArtifactRoutes } from './routes/artifacts.js';
import { registerRecordingRoutes } from './routes/recordings.js';
import { registerJobRoutes } from './routes/jobs.js';
import { registerEventRoutes } from './routes/events.js';
import { registerOrganizationRoutes } from './routes/organizations.js';
import { registerBillingRoutes } from './routes/billing.js';
import { registerScimRoutes } from './routes/scim.js';
import { registerChaosPresetRoutes } from './routes/chaos-presets.js';
import { registerContractRoutes } from './routes/contract.js';
import { registerAssertionRoutes } from './routes/assertions.js';
import { registerGraphRoutes } from './routes/graphs.js';
import { registerCliAuthRoutes, CLI_AUTH_PUBLIC_PATHS } from './routes/cli-auth.js';
import { registerMeRoutes } from './routes/me.js';
import { registerAiQualityRoutes } from './routes/ai-quality.js';
import { registerUsageRoutes } from './routes/usage.js';
import { registerSsoRoutes } from './routes/sso.js';
import { registerExportRoutes } from './routes/export.js';
import { registerSearchRoutes } from './routes/search.js';
import { registerFeatureFlagRoutes } from './routes/feature-flags.js';
import { registerLeadsRoutes, LEADS_PUBLIC_PATHS } from './routes/leads.js';
import { registerSampleRoutes } from './routes/samples.js';
import { registerApiKeyAuth, type ApiKeyPluginOptions } from './plugins/api-key.js';
import { registerSessionAuth } from './plugins/session-auth.js';
import { registerIdempotency } from './plugins/idempotency.js';
import { registerControlPlaneRateLimit } from './plugins/rate-limit.js';
import { registerAccessLog } from './plugins/access-log.js';
import { registerDocs } from './plugins/docs.js';
import { recordErrorResult, registerMetrics, type IngestMetrics } from './plugins/metrics.js';
import { isTransient, mapDriverError } from './errors.js';
import { AlwaysReady, type Lifecycle } from './lifecycle.js';
import type { Redis } from 'ioredis';
import type { AppContext } from './context.js';

/**
 * Paths served without an API key.
 *
 * `/health` and `/ready` must answer for the load balancer. `/metrics` is
 * scraped by Prometheus, which has no Carbon key — gate it with
 * `CARBON_METRICS_TOKEN` if the endpoint is internet-reachable. `/docs`,
 * `/openapi.json` and `/v1/version` are public documentation: requiring a key
 * to read the API reference means nobody can find out how to get a key.
 *
 * A trailing `/*` matches everything under the prefix (Scalar serves its
 * assets from under `/docs`).
 */
/** Operational endpoints — always public. */
const OPERATIONAL_PUBLIC_PATHS: readonly string[] = [
  '/health',
  '/v1/health/live',
  '/ready',
  '/metrics',
  '/v1/version',
];

/** Documentation endpoints — public only when `CARBON_PUBLIC_DOCS` is on. */
const DOCS_PUBLIC_PATHS: readonly string[] = ['/openapi.json', '/docs', '/docs/*'];

/**
 * Paths served without an API key.
 *
 * `/health` and `/ready` must answer for the load balancer. `/metrics` is
 * scraped by Prometheus, which has no Carbon key — gate it with
 * `CARBON_METRICS_TOKEN` if the endpoint is internet-reachable. `/docs`,
 * `/openapi.json` and `/v1/version` are public documentation: requiring a key
 * to read the API reference means nobody can find out how to get a key.
 *
 * When `publicDocs` is false the docs endpoints are dropped from this list,
 * so they require the same API key as every other route.
 */
export function buildPublicPaths(publicDocs: boolean): readonly string[] {
  const base = [...OPERATIONAL_PUBLIC_PATHS, ...CLI_AUTH_PUBLIC_PATHS, ...LEADS_PUBLIC_PATHS];
  return publicDocs ? [...base, ...DOCS_PUBLIC_PATHS] : base;
}

/** Backwards-compatible default: docs are public (matches dev behaviour). */
export const PUBLIC_PATHS: readonly string[] = buildPublicPaths(true);

export interface BuildServerOptions {
  readonly auth?: ApiKeyPluginOptions;
  /** Comma-separated origin list, or `*` to allow all. */
  readonly allowedOrigins?: string;
  readonly release?: string;
  /** If provided, enables Idempotency-Key dedup for POST/PATCH/DELETE. */
  readonly redis?: Redis;
  readonly rateLimit?: { max: number; windowMs: number };
  /** When set, `/metrics` requires `Authorization: Bearer <token>`. */
  readonly metricsToken?: string;
  /** Optional ingest queue metrics collector, from `createIngestMetrics()`. */
  readonly ingestMetrics?: IngestMetrics;
  /** Drives `/ready` during shutdown. Defaults to a never-draining stub. */
  readonly lifecycle?: Lifecycle;
  /** Hard ceiling on a single request, in ms. Default 30s. */
  readonly requestTimeoutMs?: number;
  /** Max request body size in bytes. Default 10MB. */
  readonly bodyLimitBytes?: number;
  /**
   * How many reverse-proxy hops to trust for `X-Forwarded-For`. `0` (the
   * default) ignores XFF entirely so an anonymous caller cannot rotate the
   * header to reset a rate-limit bucket. Set to the actual number of proxies
   * in front of the API in production.
   */
  readonly trustedProxyHops?: number;
  /**
   * Whether to serve `/docs` and `/openapi.json` without an API key. When
   * false the docs endpoints exist but require the same key as any other
   * route. Defaults to true to preserve dev behaviour.
   */
  readonly publicDocs?: boolean;
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
  const log =
    logger ??
    createLogger({
      level: 'info',
      pretty: process.env.NODE_ENV !== 'production',
      name: 'api',
    });
  const lifecycle = options.lifecycle ?? AlwaysReady;
  const requestTimeout = options.requestTimeoutMs ?? 30_000;
  const trustedHops = options.trustedProxyHops ?? 0;
  const publicDocs = options.publicDocs ?? true;
  const publicPaths = buildPublicPaths(publicDocs);

  const app = Fastify({
    // No Fastify logger at all — `registerAccessLog` owns request logging and
    // emits one structured line per request instead of Fastify's two.
    // (`disableRequestLogging` is deprecated in Fastify 5 and redundant here.)
    logger: false,
    // 0 → ignore XFF entirely (`req.ip` is the socket peer). Any other value
    // trusts that many hops of the header, so upstream proxies must strip
    // client-supplied XFF beyond their own append. Trusting XFF unconditionally
    // would let an anonymous caller rotate the header to reset rate limits.
    trustProxy: trustedHops === 0 ? false : trustedHops,
    // 10MB — big enough for large OpenAPI docs, small enough to reject abuse.
    // /v1/ingest raises this for itself.
    bodyLimit: options.bodyLimitBytes ?? 10 * 1024 * 1024,
    // Without these, a client that opens a socket and dribbles bytes holds a
    // connection open forever (slow loris). Node's defaults are effectively
    // unbounded for requestTimeout.
    requestTimeout,
    connectionTimeout: 60_000,
    // Must exceed the upstream idle timeout or the proxy will reuse a socket
    // we are closing and surface a spurious 502. 72s clears AWS ALB's 60s.
    keepAliveTimeout: 72_000,
    genReqId: (req) => inboundRequestId(req) ?? randomUUID(),
  });

  const origins = parseOrigins(options.allowedOrigins);
  // Since Phase 2 (Better Auth consolidation) the API now reads a session
  // cookie set by the dashboard, so we MUST allow credentialed CORS from an
  // explicit origin allow-list. `origin: true` reflects arbitrary origins —
  // combined with `credentials: true` that's the classic CSRF footgun, so
  // when ALLOWED_ORIGINS=* we deliberately drop credentials (public API
  // callers must send `x-carbon-key` on every request instead). API-key
  // callers keep working in both modes since the key is a header, not a
  // cookie.
  const allowCreds = origins !== '*';
  await app.register(cors, {
    origin: origins === '*' ? true : origins,
    credentials: allowCreds,
    exposedHeaders: [
      'x-request-id',
      'x-carbon-key-prefix',
      'x-ratelimit-limit',
      'x-ratelimit-remaining',
      'retry-after',
      'idempotent-replay',
    ],
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

  // Echo the request id on every response, including errors. It was already
  // in the CORS allow-list but nothing ever set it, so clients had no id to
  // quote in a bug report.
  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', String(req.id));
  });

  // Docs BEFORE routes: @fastify/swagger snapshots the route table at
  // ready-time, so we need every subsequent register() call to be visible.
  await registerDocs(app, options.release ?? 'dev');

  // Metrics and access logging register their timing hooks first so they
  // measure the *whole* request, auth and rate limiting included — otherwise
  // every rejected request looks free.
  // Attach the ingest queue depth poller now that we have a live queue handle.
  // Poller cleanup is chained to the metrics plugin's onClose hook.
  if (options.ingestMetrics && ctx.ingestionQueue) {
    options.ingestMetrics.attachQueue(ctx.ingestionQueue);
  }
  await registerMetrics(app, ctx, {
    token: options.metricsToken,
    ingest: options.ingestMetrics,
  });
  await registerAccessLog(app, ctx);

  if (options.auth) {
    await registerApiKeyAuth(app, ctx, {
      publicPaths: options.auth.publicPaths ?? publicPaths,
      mode: options.auth.mode,
      headerName: options.auth.headerName,
    });
  }

  // Registered *after* the api-key hook so that when both would accept a
  // request the api-key path runs first — deterministic ordering matters when
  // an ambiguous Bearer token is presented. Human/browser auth is Better
  // Auth session cookies (or bearer session tokens) resolved against the
  // shared Postgres.
  await registerSessionAuth(app, ctx);

  if (options.redis) {
    if (options.rateLimit) {
      await registerControlPlaneRateLimit(app, ctx, {
        redis: options.redis,
        max: options.rateLimit.max,
        windowMs: options.rateLimit.windowMs,
        exemptPaths: publicPaths,
      });
    }
    await registerIdempotency(app, ctx, { redis: options.redis });
  }

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({
      error: {
        code: 'CARBON_NOT_FOUND',
        message: `Route ${req.method} ${req.url.split('?')[0]} not found`,
      },
    });
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      recordErrorResult('CARBON_INVALID_INPUT');
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

    // Fastify's own body-limit / malformed-JSON errors carry a statusCode and
    // are the client's fault; returning 500 for them is misleading and makes
    // the 5xx rate useless as an alerting signal.
    const fastifyStatus = clientErrorStatus(err);
    if (fastifyStatus) {
      const code = fastifyErrorCode(fastifyStatus);
      recordErrorResult(code);
      reply.status(fastifyStatus).send({
        error: { code, message: errorMessage(err) },
      });
      return;
    }

    const carbon = isCarbonError(err) ? err : mapDriverError(err);
    if (carbon) {
      recordErrorResult(carbon.code);
      sendCarbonError(reply, carbon);
      if (statusFor(carbon.code) >= 500) {
        log.error('api.internal_error', {
          message: carbon.message,
          code: carbon.code,
          url: req.url,
          method: req.method,
          reqId: String(req.id),
        });
      }
      return;
    }

    recordErrorResult('CARBON_INTERNAL');
    log.error('api.internal_error', {
      message: errorMessage(err),
      name: errorName(err),
      stack: err instanceof Error ? err.stack : undefined,
      url: req.url,
      method: req.method,
      reqId: String(req.id),
    });
    reply.status(500).send({ error: { code: 'CARBON_INTERNAL', message: 'Internal error' } });
  });

  await registerHealthRoutes(app, ctx, { release: options.release, lifecycle });
  await registerProjectRoutes(app, ctx);
  await registerIngestRoutes(app, ctx);
  await registerEmulatorRoutes(app, ctx);
  await registerSnapshotRoutes(app, ctx);
  await registerApiKeyRoutes(app, ctx);
  await registerArtifactRoutes(app, ctx);
  await registerRecordingRoutes(app, ctx);
  await registerJobRoutes(app, ctx);
  await registerEventRoutes(app, ctx);
  await registerOrganizationRoutes(app, ctx);
  await registerBillingRoutes(app, ctx);
  await registerScimRoutes(app, ctx);
  await registerChaosPresetRoutes(app, ctx);
  await registerContractRoutes(app, ctx);
  await registerAssertionRoutes(app, ctx);
  await registerGraphRoutes(app, ctx);
  await registerCliAuthRoutes(app, ctx);
  await registerMeRoutes(app, ctx);
  await registerAiQualityRoutes(app, ctx);
  await registerUsageRoutes(app, ctx);
  await registerSsoRoutes(app, ctx);
  await registerExportRoutes(app, ctx);
  await registerSearchRoutes(app, ctx);
  await registerFeatureFlagRoutes(app, ctx);
  await registerLeadsRoutes(app, ctx);
  await registerSampleRoutes(app, ctx);

  return app;
}

function sendCarbonError(reply: FastifyReply, err: CarbonError): void {
  const status = statusFor(err.code);
  if (isTransient(err)) reply.header('retry-after', '2');
  reply.status(status).send({
    error: {
      code: err.code,
      message: err.expose ? err.message : 'Internal error',
      details: err.expose && Object.keys(err.details).length > 0 ? err.details : undefined,
      // A stable docs URL is safe to surface even when the message is
      // redacted — the code alone is what determines the link, and the code
      // is already in the response.
      help: err.help,
    },
  });
}

/**
 * Fastify tags its own 4xx errors (body too large, malformed JSON, unsupported
 * media type) with a `statusCode`. Anything it marks 5xx is a real failure and
 * falls through to the generic handler.
 */
function clientErrorStatus(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const status = (err as { statusCode?: unknown }).statusCode;
  if (typeof status !== 'number') return null;
  return status >= 400 && status < 500 ? status : null;
}

function fastifyErrorCode(status: number): string {
  if (status === 413) return 'CARBON_INVALID_INPUT';
  if (status === 415) return 'CARBON_INVALID_INPUT';
  if (status === 408) return 'CARBON_INVALID_INPUT';
  if (status === 404) return 'CARBON_NOT_FOUND';
  return 'CARBON_INVALID_INPUT';
}

/**
 * Honours an inbound `x-request-id` so a trace survives across the proxy, the
 * dashboard, and the API. Rejects anything unreasonable — the id lands in log
 * output, so an unbounded or newline-bearing value is a log-injection vector.
 */
function inboundRequestId(req: IncomingMessage): string | undefined {
  const raw = req.headers['x-request-id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return undefined;
  return /^[A-Za-z0-9._:-]{8,128}$/.test(value) ? value : undefined;
}

function parseOrigins(raw: string | undefined): '*' | string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (trimmed === '*') return '*';
  return trimmed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : 'UnknownError';
}

export function statusFor(code: string): number {
  switch (code) {
    case 'CARBON_NOT_FOUND':
      return 404;
    case 'CARBON_INVALID_INPUT':
    case 'CARBON_PARSE_FAILED':
      return 400;
    case 'CARBON_CONFLICT':
      return 409;
    case 'CARBON_UNAUTHENTICATED':
      return 401;
    case 'CARBON_FORBIDDEN':
      return 403;
    case 'CARBON_STATE_VIOLATION':
      return 422;
    case 'CARBON_RUNTIME_UNAVAILABLE':
    case 'CARBON_DEPENDENCY_UNAVAILABLE':
      return 503;
    case 'CARBON_TIMEOUT':
      return 504;
    case 'CARBON_RATE_LIMITED':
      return 429;
    case 'CARBON_JOB_FAILED':
      return 500;
    default:
      return 500;
  }
}
