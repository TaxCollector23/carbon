import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';

/**
 * Minimal Prometheus text-format exposition.
 *
 * Deliberately not using prom-client — we only need four series, and the
 * exposition format is stable and tiny. Adding prom-client and its default
 * metric collector pulls in ~30 series and 100 KB we do not need.
 *
 * Exposed:
 *   - carbon_http_requests_total{method,status_class}
 *   - carbon_http_request_duration_ms_bucket{le=...} (histogram)
 *   - carbon_http_request_duration_ms_count
 *   - carbon_http_request_duration_ms_sum
 *   - carbon_process_uptime_seconds
 *   - carbon_process_resident_memory_bytes
 *
 * `/metrics` is intentionally unauthenticated so a Prometheus scrape can hit
 * it. In a hardened deploy, put this endpoint behind your infra's network
 * ACL or add a shared bearer via a reverse proxy.
 */
export async function registerMetrics(app: FastifyInstance, _ctx: AppContext): Promise<void> {
  const state = createMetricsState();

  app.addHook('onRequest', async (req) => {
    (req as { _mStart?: number })._mStart = performance.now();
  });

  app.addHook('onResponse', async (req, reply) => {
    if (req.url === '/metrics') return;
    const start = (req as { _mStart?: number })._mStart;
    const duration = start !== undefined ? performance.now() - start : 0;
    state.observe(req.method, reply.statusCode, duration);
  });

  app.get('/metrics', async (_req, reply) => {
    reply.header('content-type', 'text/plain; version=0.0.4');
    return state.render();
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Metrics state
// ────────────────────────────────────────────────────────────────────────────

const HISTOGRAM_BUCKETS_MS = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000] as const;

interface Counter {
  value: number;
}

interface Histogram {
  buckets: number[]; // cumulative counts, aligned with HISTOGRAM_BUCKETS_MS + inf
  sum: number;
  count: number;
}

function createMetricsState() {
  // Keyed by `method|status_class` e.g. "GET|2xx"
  const requestCounters = new Map<string, Counter>();
  const histogram: Histogram = {
    buckets: new Array<number>(HISTOGRAM_BUCKETS_MS.length + 1).fill(0),
    sum: 0,
    count: 0,
  };

  function observe(method: string, status: number, durationMs: number): void {
    const key = `${method}|${statusClass(status)}`;
    const c = requestCounters.get(key) ?? { value: 0 };
    c.value += 1;
    requestCounters.set(key, c);

    histogram.count += 1;
    histogram.sum += durationMs;
    let placed = false;
    for (let i = 0; i < HISTOGRAM_BUCKETS_MS.length; i++) {
      if (durationMs <= HISTOGRAM_BUCKETS_MS[i]!) {
        histogram.buckets[i]! += 1;
        placed = true;
      }
    }
    if (!placed) histogram.buckets[HISTOGRAM_BUCKETS_MS.length]! += 1;
    else histogram.buckets[HISTOGRAM_BUCKETS_MS.length]! += 1; // +Inf always increments
  }

  function render(): string {
    const lines: string[] = [];
    lines.push('# HELP carbon_http_requests_total Total HTTP requests handled.');
    lines.push('# TYPE carbon_http_requests_total counter');
    for (const [key, counter] of requestCounters) {
      const [method, cls] = key.split('|');
      lines.push(
        `carbon_http_requests_total{method="${method}",status_class="${cls}"} ${counter.value}`,
      );
    }

    lines.push('');
    lines.push('# HELP carbon_http_request_duration_ms HTTP request latency in milliseconds.');
    lines.push('# TYPE carbon_http_request_duration_ms histogram');
    for (let i = 0; i < HISTOGRAM_BUCKETS_MS.length; i++) {
      lines.push(
        `carbon_http_request_duration_ms_bucket{le="${HISTOGRAM_BUCKETS_MS[i]}"} ${histogram.buckets[i]}`,
      );
    }
    lines.push(`carbon_http_request_duration_ms_bucket{le="+Inf"} ${histogram.count}`);
    lines.push(`carbon_http_request_duration_ms_sum ${histogram.sum.toFixed(3)}`);
    lines.push(`carbon_http_request_duration_ms_count ${histogram.count}`);

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

  return { observe, render };
}

function statusClass(status: number): string {
  if (status >= 500) return '5xx';
  if (status >= 400) return '4xx';
  if (status >= 300) return '3xx';
  if (status >= 200) return '2xx';
  return '1xx';
}
