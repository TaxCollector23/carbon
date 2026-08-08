import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from './api-key.js';

/**
 * Structured access logging.
 *
 * Fastify's built-in request logging is disabled (`disableRequestLogging`)
 * because its shape is noisy and it emits two lines per request. This emits
 * exactly one line per completed request, at a level chosen by status class:
 *
 *   5xx → error, 4xx → warn, everything else → info
 *
 * so an operator can alert on `level>=50` without a parsing rule. Probe
 * traffic (`/health`, `/ready`, `/metrics`) is excluded by default — at a 1s
 * probe interval it would be 86k lines a day that say nothing.
 */
export interface AccessLogOptions {
  /** Paths excluded from logging. Defaults to the probe endpoints. */
  readonly ignorePaths?: Iterable<string>;
  /** Log slow requests at `warn` even when they succeed. Default 2000ms. */
  readonly slowRequestMs?: number;
}

const DEFAULT_IGNORED = ['/health', '/ready', '/metrics'];

const START_KEY = Symbol('carbon.accessLogStart');

interface TimedRequest extends FastifyRequest {
  [START_KEY]?: bigint;
}

export async function registerAccessLog(
  app: FastifyInstance,
  ctx: AppContext,
  opts: AccessLogOptions = {},
): Promise<void> {
  const ignored = new Set(opts.ignorePaths ?? DEFAULT_IGNORED);
  const slowMs = opts.slowRequestMs ?? 2000;

  app.addHook('onRequest', async (req) => {
    (req as TimedRequest)[START_KEY] = process.hrtime.bigint();
  });

  app.addHook('onResponse', async (req, reply) => {
    if (ignored.has(pathname(req.url))) return;
    const status = reply.statusCode;
    const durationMs = elapsedMs(req);
    const fields = {
      method: req.method,
      // The matched route pattern, not the concrete URL — `/v1/projects/:id`
      // rather than `/v1/projects/prj_abc`. Keeps IDs out of the log index
      // while staying groupable.
      route: req.routeOptions?.url ?? 'unmatched',
      url: pathname(req.url),
      status,
      durationMs: Number(durationMs.toFixed(2)),
      reqId: String(req.id),
      ip: req.ip,
      key: (req as AuthenticatedRequest).apiKey?.prefix,
    };

    if (status >= 500) ctx.logger.error('api.access', fields);
    else if (status >= 400 || durationMs >= slowMs) ctx.logger.warn('api.access', fields);
    else ctx.logger.info('api.access', fields);
  });

  // A client that hangs up mid-request never reaches `onResponse`, so without
  // this the slowest requests in the system are the ones that never get
  // logged — exactly the ones worth seeing.
  app.addHook('onRequestAbort', async (req) => {
    if (ignored.has(pathname(req.url))) return;
    ctx.logger.warn('api.access_aborted', {
      method: req.method,
      route: req.routeOptions?.url ?? 'unmatched',
      url: pathname(req.url),
      durationMs: Number(elapsedMs(req).toFixed(2)),
      reqId: String(req.id),
    });
  });
}

function elapsedMs(req: FastifyRequest): number {
  const start = (req as TimedRequest)[START_KEY];
  if (start === undefined) return 0;
  return Number(process.hrtime.bigint() - start) / 1e6;
}

function pathname(url: string): string {
  return url.split('?')[0] ?? url;
}
