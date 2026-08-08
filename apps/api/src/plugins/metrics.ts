import type { FastifyInstance, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import type { AppContext } from '../context.js';

/**
 * Minimal Prometheus text-format exposition.
 *
 * Deliberately not using prom-client — we only need a handful of series, and
 * the exposition format is stable and tiny. Adding prom-client and its default
 * metric collector pulls in ~30 series and 100 KB we do not need.
 *
 * Exposed:
 *   - carbon_http_requests_total{method,route,status_class}
 *   - carbon_http_request_duration_ms_bucket{route,le=...} (histogram)
 *   - carbon_http_request_duration_ms_{sum,count}{route}
 *   - carbon_http_requests_in_flight
 *   - carbon_http_series_dropped_total
 *   - carbon_process_uptime_seconds
 *   - carbon_process_resident_memory_bytes
 *   - carbon_nodejs_eventloop_lag_ms
 *
 * `/metrics` is unauthenticated by default so a Prometheus scrape can reach it
 * without a Carbon API key — see PUBLIC_PATHS in server.ts. Set
 * CARBON_METRICS_TOKEN to require `Authorization: Bearer <token>` instead.
 */
export interface MetricsOptions {
  /** When set, `/metrics` requires `Authorization: Bearer <token>`. */
  readonly token?: string;
}

export async function registerMetrics(
  app: FastifyInstance,
  ctx: AppContext,
  opts: MetricsOptions = {},
): Promise<void> {
  const state = createMetricsState();
  const lag = startEventLoopLagSampler();
  app.addHook('onClose', async () => lag.stop());

  // The scrape is excluded from every series, including the in-flight gauge:
  // a request that is always in flight at render time would report a constant
  // floor of 1 and mask an idle server.
  app.addHook('onRequest', async (req) => {
    if (isScrape(req)) return;
    (req as TimedRequest)[START_KEY] = performance.now();
    state.enter();
  });

  // `onResponse` does not fire when the client hangs up first, so the in-flight
  // gauge is decremented from both hooks with a per-request guard against
  // double-counting.
  app.addHook('onResponse', async (req, reply) => {
    if (isScrape(req) || !leave(req, state)) return;
    state.observe(req.method, routeLabel(req), reply.statusCode, elapsed(req));
  });
  app.addHook('onRequestAbort', async (req) => {
    if (isScrape(req) || !leave(req, state)) return;
    // 499 is nginx's convention for "client closed request". Recording it keeps
    // aborted work visible in the same series as everything else.
    state.observe(req.method, routeLabel(req), 499, elapsed(req));
  });

  app.get('/metrics', async (req, reply) => {
    if (opts.token && !hasValidToken(req, opts.token)) {
      reply.header('www-authenticate', 'Bearer');
      reply.status(401);
      return { error: { code: 'CARBON_UNAUTHENTICATED', message: 'Invalid metrics token' } };
    }
    reply.header('content-type', 'text/plain; version=0.0.4');
    reply.header('cache-control', 'no-store');
    return state.render(lag.currentMs());
  });

  ctx.logger.debug('metrics.registered', { authenticated: Boolean(opts.token) });
}

// ────────────────────────────────────────────────────────────────────────────
// Request timing
// ────────────────────────────────────────────────────────────────────────────

const START_KEY = Symbol('carbon.metricsStart');
const COUNTED_KEY = Symbol('carbon.metricsCounted');

interface TimedRequest extends FastifyRequest {
  [START_KEY]?: number;
  [COUNTED_KEY]?: boolean;
}

/** Returns false if this request was already accounted for. */
function leave(req: FastifyRequest, state: MetricsState): boolean {
  const timed = req as TimedRequest;
  if (timed[COUNTED_KEY]) return false;
  timed[COUNTED_KEY] = true;
  state.exit();
  return true;
}

function elapsed(req: FastifyRequest): number {
  const start = (req as TimedRequest)[START_KEY];
  return start === undefined ? 0 : performance.now() - start;
}

/**
 * The matched route *pattern*, never the concrete URL. `/v1/projects/:id`
 * has bounded cardinality; `/v1/projects/prj_abc` does not, and a scan of
 * random IDs would otherwise blow up the series count.
 */
function routeLabel(req: FastifyRequest): string {
  return req.routeOptions?.url ?? 'unmatched';
}

function isScrape(req: FastifyRequest): boolean {
  return (req.url.split('?')[0] ?? req.url) === '/metrics';
}

function hasValidToken(req: FastifyRequest, expected: string): boolean {
  const raw = req.headers.authorization;
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (!header?.startsWith('Bearer ')) return false;
  const presented = Buffer.from(header.slice(7));
  const secret = Buffer.from(expected);
  return presented.length === secret.length && timingSafeEqual(presented, secret);
}

// ────────────────────────────────────────────────────────────────────────────
// Metrics state
// ────────────────────────────────────────────────────────────────────────────

const HISTOGRAM_BUCKETS_MS = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000] as const;

/**
 * A hard ceiling on distinct label combinations. Cardinality explosion is the
 * classic way a metrics endpoint takes down the process it is meant to observe;
 * past this point new series are folded into `route="__other__"` and the drop
 * is itself exported so the gap is visible rather than silent.
 */
const MAX_SERIES = 500;
const OVERFLOW_ROUTE = '__other__';

interface Histogram {
  /** Non-cumulative per-bucket counts; converted to cumulative at render. */
  buckets: number[];
  sum: number;
  count: number;
}

interface MetricsState {
  enter(): void;
  exit(): void;
  observe(method: string, route: string, status: number, durationMs: number): void;
  render(eventLoopLagMs: number): string;
}

function createMetricsState(): MetricsState {
  // Keyed by `method|route|status_class`, e.g. "GET|/v1/projects|2xx"
  const requestCounters = new Map<string, number>();
  // Keyed by route.
  const histograms = new Map<string, Histogram>();
  let inFlight = 0;
  let droppedSeries = 0;

  function newHistogram(): Histogram {
    return {
      buckets: new Array<number>(HISTOGRAM_BUCKETS_MS.length + 1).fill(0),
      sum: 0,
      count: 0,
    };
  }

  function observe(method: string, route: string, status: number, durationMs: number): void {
    const safeRoute =
      histograms.has(route) || histograms.size < MAX_SERIES ? route : OVERFLOW_ROUTE;
    if (safeRoute !== route) droppedSeries += 1;

    const counterKey = `${method}|${safeRoute}|${statusClass(status)}`;
    if (requestCounters.has(counterKey) || requestCounters.size < MAX_SERIES) {
      requestCounters.set(counterKey, (requestCounters.get(counterKey) ?? 0) + 1);
    } else {
      droppedSeries += 1;
    }

    let histogram = histograms.get(safeRoute);
    if (!histogram) {
      histogram = newHistogram();
      histograms.set(safeRoute, histogram);
    }
    histogram.count += 1;
    histogram.sum += durationMs;
    histogram.buckets[bucketIndex(durationMs)]! += 1;
  }

  function render(eventLoopLagMs: number): string {
    const lines: string[] = [];

    lines.push('# HELP carbon_http_requests_total Total HTTP requests handled.');
    lines.push('# TYPE carbon_http_requests_total counter');
    for (const [key, value] of requestCounters) {
      const [method = '', route = '', cls = ''] = key.split('|');
      lines.push(
        `carbon_http_requests_total{method="${escapeLabel(method)}",route="${escapeLabel(route)}",status_class="${cls}"} ${value}`,
      );
    }

    lines.push('');
    lines.push('# HELP carbon_http_request_duration_ms HTTP request latency in milliseconds.');
    lines.push('# TYPE carbon_http_request_duration_ms histogram');
    for (const [route, histogram] of histograms) {
      const label = escapeLabel(route);
      // Prometheus histogram buckets are cumulative: each `le` reports every
      // observation at or below it.
      let cumulative = 0;
      for (let i = 0; i < HISTOGRAM_BUCKETS_MS.length; i++) {
        cumulative += histogram.buckets[i]!;
        lines.push(
          `carbon_http_request_duration_ms_bucket{route="${label}",le="${HISTOGRAM_BUCKETS_MS[i]}"} ${cumulative}`,
        );
      }
      lines.push(
        `carbon_http_request_duration_ms_bucket{route="${label}",le="+Inf"} ${histogram.count}`,
      );
      lines.push(
        `carbon_http_request_duration_ms_sum{route="${label}"} ${histogram.sum.toFixed(3)}`,
      );
      lines.push(`carbon_http_request_duration_ms_count{route="${label}"} ${histogram.count}`);
    }

    lines.push('');
    lines.push('# HELP carbon_http_requests_in_flight Requests currently being handled.');
    lines.push('# TYPE carbon_http_requests_in_flight gauge');
    lines.push(`carbon_http_requests_in_flight ${inFlight}`);

    lines.push('');
    lines.push('# HELP carbon_http_series_dropped_total Observations folded in at the series cap.');
    lines.push('# TYPE carbon_http_series_dropped_total counter');
    lines.push(`carbon_http_series_dropped_total ${droppedSeries}`);

    lines.push('');
    lines.push('# HELP carbon_nodejs_eventloop_lag_ms Event loop delay over the last second.');
    lines.push('# TYPE carbon_nodejs_eventloop_lag_ms gauge');
    lines.push(`carbon_nodejs_eventloop_lag_ms ${eventLoopLagMs.toFixed(3)}`);

    lines.push('');
    lines.push('# HELP carbon_process_uptime_seconds Time since process boot.');
    lines.push('# TYPE carbon_process_uptime_seconds gauge');
    lines.push(`carbon_process_uptime_seconds ${process.uptime().toFixed(0)}`);

    lines.push('');
    lines.push('# HELP carbon_process_resident_memory_bytes RSS memory.');
    lines.push('# TYPE carbon_process_resident_memory_bytes gauge');
    lines.push(`carbon_process_resident_memory_bytes ${process.memoryUsage().rss}`);

    return lines.join('\n') + '\n';
  }

  return {
    enter: () => void (inFlight += 1),
    exit: () => void (inFlight = Math.max(0, inFlight - 1)),
    observe,
    render,
  };
}

function bucketIndex(durationMs: number): number {
  for (let i = 0; i < HISTOGRAM_BUCKETS_MS.length; i++) {
    if (durationMs <= HISTOGRAM_BUCKETS_MS[i]!) return i;
  }
  return HISTOGRAM_BUCKETS_MS.length; // the +Inf overflow slot
}

function statusClass(status: number): string {
  if (status >= 500) return '5xx';
  if (status >= 400) return '4xx';
  if (status >= 300) return '3xx';
  if (status >= 200) return '2xx';
  return '1xx';
}

/** Escapes per the Prometheus exposition format: backslash, quote, newline. */
function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/**
 * Event loop lag: schedule a timer for 1s and measure how late it actually
 * fires. A saturated event loop is the single most common cause of latency in
 * a Node service and is invisible in request timings alone.
 */
function startEventLoopLagSampler(): { currentMs: () => number; stop: () => void } {
  const INTERVAL_MS = 1000;
  let lagMs = 0;
  let expected = Date.now() + INTERVAL_MS;
  const timer = setInterval(() => {
    const now = Date.now();
    lagMs = Math.max(0, now - expected);
    expected = now + INTERVAL_MS;
  }, INTERVAL_MS);
  // Never hold the process open for a metrics sampler.
  timer.unref();
  return { currentMs: () => lagMs, stop: () => clearInterval(timer) };
}
