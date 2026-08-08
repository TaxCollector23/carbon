import type { FastifyInstance, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import type { AppContext } from '../context.js';
import type { IngestMetricsSink } from '@carbon/workers';

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
 *   - carbon_idempotency_result_total{outcome}
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
  /**
   * Optional ingest metrics collector. When provided, its series are folded
   * into `/metrics` output and its background polling is stopped on server
   * shutdown. Wire via `createIngestMetrics()`.
   */
  readonly ingest?: IngestMetrics;
}

export async function registerMetrics(
  app: FastifyInstance,
  ctx: AppContext,
  opts: MetricsOptions = {},
): Promise<void> {
  const state = createMetricsState();
  const lag = startEventLoopLagSampler();
  const ingest = opts.ingest;
  app.addHook('onClose', async () => {
    lag.stop();
    // Stop the queue-depth poller too — otherwise vitest's test runner sees a
    // handle still open and hangs at teardown.
    ingest?.stop();
  });

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
    return state.render(lag.currentMs()) + (ingest ? ingest.render() : '');
  });

  ctx.logger.debug('metrics.registered', { authenticated: Boolean(opts.token) });
}

// ────────────────────────────────────────────────────────────────────────────
// Idempotency outcome counter
// ────────────────────────────────────────────────────────────────────────────

/**
 * The idempotency plugin bumps this counter as it decides what to do with a
 * request. Kept as a module-level singleton because the metrics registry is
 * itself a module-level singleton — a shared registry object would be tidier
 * but is not worth the wiring for a single counter.
 */
export type IdempotencyOutcome = 'miss' | 'hit' | 'conflict' | 'skipped_stream';

const IDEMPOTENCY_OUTCOMES: readonly IdempotencyOutcome[] = [
  'miss',
  'hit',
  'conflict',
  'skipped_stream',
];

const idempotencyCounters: Record<IdempotencyOutcome, number> = {
  miss: 0,
  hit: 0,
  conflict: 0,
  skipped_stream: 0,
};

export function recordIdempotencyOutcome(outcome: IdempotencyOutcome): void {
  idempotencyCounters[outcome] += 1;
}

/** Test-only: reset the module-level counters. */
export function resetIdempotencyCountersForTest(): void {
  for (const outcome of IDEMPOTENCY_OUTCOMES) idempotencyCounters[outcome] = 0;
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
    lines.push('# HELP carbon_idempotency_result_total Outcomes of the idempotency middleware.');
    lines.push('# TYPE carbon_idempotency_result_total counter');
    for (const outcome of IDEMPOTENCY_OUTCOMES) {
      lines.push(
        `carbon_idempotency_result_total{outcome="${outcome}"} ${idempotencyCounters[outcome]}`,
      );
    }

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

// ────────────────────────────────────────────────────────────────────────────
// Ingest queue metrics
// ────────────────────────────────────────────────────────────────────────────

const INGEST_DURATION_BUCKETS_MS = [100, 500, 1_000, 5_000, 15_000, 60_000, 300_000] as const;

/** BullMQ queue states we surface as `carbon_ingest_queue_depth{state=...}`. */
type QueueState = 'waiting' | 'active' | 'delayed' | 'failed' | 'completed';
const QUEUE_STATES: readonly QueueState[] = [
  'waiting',
  'active',
  'delayed',
  'failed',
  'completed',
];

/**
 * A very small subset of BullMQ's `Queue`. Kept structural so tests don't have
 * to spin up a real Redis-backed queue to exercise the poller.
 */
export interface JobCountsSource {
  getJobCounts(...types: string[]): Promise<Record<string, number>>;
}

export interface IngestMetricsPollerLogger {
  warn(event: string, fields: Record<string, unknown>): void;
}

export interface CreateIngestMetricsOptions {
  readonly pollIntervalMs?: number;
  readonly logger?: IngestMetricsPollerLogger;
}

/**
 * Prom-exposition renderer + `IngestMetricsSink` implementation for the
 * ingest queue. The API constructs one of these at boot; both the embedded
 * worker (in-process) and the metrics plugin (for polling depth + rendering)
 * share the same instance.
 *
 * Kept as a plain object so `packages/workers` does not need to know about
 * prom-client or fastify — it only sees {@link IngestMetricsSink}.
 */
export interface IngestMetrics {
  readonly sink: IngestMetricsSink;
  /**
   * Begin polling `queue.getJobCounts()` at `pollIntervalMs` (default 10s).
   * Safe to call multiple times; only the first call has effect.
   */
  attachQueue(queue: JobCountsSource): void;
  render(): string;
  /** Idempotent — clears polling timers so tests + shutdown don't hang. */
  stop(): void;
}

export function createIngestMetrics(opts: CreateIngestMetricsOptions = {}): IngestMetrics {
  const pollIntervalMs = opts.pollIntervalMs ?? 10_000;
  const logger = opts.logger;

  // Queue depth is populated by the poller — a zero here means "we haven't
  // heard from the queue yet", not "there are zero jobs". Rendering treats
  // missing values as absent series so a broken poll is visible as a gap.
  const depth = new Map<QueueState, number>();
  let hasDepth = false;

  const durationBuckets = new Array<number>(INGEST_DURATION_BUCKETS_MS.length + 1).fill(0);
  let durationSum = 0;
  let durationCount = 0;

  let succeeded = 0;
  let failed = 0;
  let activeGauge = 0;

  let timer: ReturnType<typeof setInterval> | undefined;
  let attached: JobCountsSource | undefined;
  let polling = false;

  async function poll(): Promise<void> {
    if (!attached || polling) return;
    polling = true;
    try {
      const counts = await attached.getJobCounts(...QUEUE_STATES);
      for (const state of QUEUE_STATES) {
        depth.set(state, Number(counts[state] ?? 0));
      }
      hasDepth = true;
    } catch (err) {
      logger?.warn('ingest.metrics.poll_failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      polling = false;
    }
  }

  function bucketIdx(durationMs: number): number {
    for (let i = 0; i < INGEST_DURATION_BUCKETS_MS.length; i++) {
      if (durationMs <= INGEST_DURATION_BUCKETS_MS[i]!) return i;
    }
    return INGEST_DURATION_BUCKETS_MS.length;
  }

  const sink: IngestMetricsSink = {
    onActiveDelta(delta) {
      activeGauge = Math.max(0, activeGauge + delta);
    },
    onJobResult({ outcome, durationMs }) {
      const safe = Math.max(0, Number.isFinite(durationMs) ? durationMs : 0);
      durationBuckets[bucketIdx(safe)]! += 1;
      durationSum += safe;
      durationCount += 1;
      if (outcome === 'succeeded') succeeded += 1;
      else failed += 1;
    },
  };

  return {
    sink,
    attachQueue(queue) {
      if (attached) return;
      attached = queue;
      // Kick off an initial poll immediately so `/metrics` doesn't return zero
      // depth for the first pollIntervalMs after boot.
      void poll();
      timer = setInterval(() => void poll(), pollIntervalMs);
      timer.unref();
    },
    render() {
      const lines: string[] = [''];

      lines.push('# HELP carbon_ingest_queue_depth BullMQ ingest queue jobs by state.');
      lines.push('# TYPE carbon_ingest_queue_depth gauge');
      if (hasDepth) {
        for (const state of QUEUE_STATES) {
          lines.push(`carbon_ingest_queue_depth{state="${state}"} ${depth.get(state) ?? 0}`);
        }
      }

      lines.push('');
      lines.push('# HELP carbon_ingest_job_duration_ms Ingest job wall time in ms.');
      lines.push('# TYPE carbon_ingest_job_duration_ms histogram');
      let cumulative = 0;
      for (let i = 0; i < INGEST_DURATION_BUCKETS_MS.length; i++) {
        cumulative += durationBuckets[i]!;
        lines.push(
          `carbon_ingest_job_duration_ms_bucket{le="${INGEST_DURATION_BUCKETS_MS[i]}"} ${cumulative}`,
        );
      }
      lines.push(`carbon_ingest_job_duration_ms_bucket{le="+Inf"} ${durationCount}`);
      lines.push(`carbon_ingest_job_duration_ms_sum ${durationSum.toFixed(3)}`);
      lines.push(`carbon_ingest_job_duration_ms_count ${durationCount}`);

      lines.push('');
      lines.push('# HELP carbon_ingest_job_result_total Ingest jobs by terminal outcome.');
      lines.push('# TYPE carbon_ingest_job_result_total counter');
      lines.push(`carbon_ingest_job_result_total{outcome="succeeded"} ${succeeded}`);
      lines.push(`carbon_ingest_job_result_total{outcome="failed"} ${failed}`);

      lines.push('');
      lines.push('# HELP carbon_ingest_worker_active Ingest jobs currently running in-process.');
      lines.push('# TYPE carbon_ingest_worker_active gauge');
      lines.push(`carbon_ingest_worker_active ${activeGauge}`);

      return lines.join('\n') + '\n';
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
      attached = undefined;
    },
  };
}
