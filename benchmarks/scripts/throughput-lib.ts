/**
 * Shared, dependency-free throughput runner. Reused by:
 *   - the `bench:throughput` CLI (previously autocannon-based)
 *   - the control-plane `/v1/emulators/:id/load-test` route
 *
 * Native http.Agent + keep-alive is enough to saturate an in-process runtime
 * for a benchmark's-worth of seconds. Autocannon is nicer for a shell prompt,
 * but not worth the transitive dependency on apps/api.
 */
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';

export interface ThroughputOptions {
  readonly url: string;
  readonly concurrency: number;
  readonly durationMs: number;
  /** GET by default. */
  readonly method?: string;
  /** Extra request headers, e.g. an auth token. */
  readonly headers?: Record<string, string>;
  /** Optional JSON body — stringified for you. */
  readonly body?: unknown;
}

export interface ThroughputResult {
  readonly rps: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly mean: number;
  readonly errorRate: number;
  readonly totalRequests: number;
  readonly errors: number;
  readonly durationMs: number;
}

/**
 * Fire concurrent requests until `durationMs` elapses. Each worker keeps its
 * own keep-alive socket, so we measure the runtime's response time rather
 * than TCP handshake latency.
 */
export async function runThroughput(opts: ThroughputOptions): Promise<ThroughputResult> {
  const concurrency = Math.max(1, opts.concurrency | 0);
  const durationMs = Math.max(50, opts.durationMs | 0);
  const target = new URL(opts.url);
  const isHttps = target.protocol === 'https:';
  const doRequest = isHttps ? httpsRequest : httpRequest;
  const agent = isHttps
    ? new HttpsAgent({ keepAlive: true, maxSockets: concurrency })
    : new HttpAgent({ keepAlive: true, maxSockets: concurrency });
  const bodyStr = opts.body === undefined ? null : JSON.stringify(opts.body);
  const method = (opts.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = {
    'user-agent': 'carbon-throughput/0.1',
    ...(opts.headers ?? {}),
  };
  if (bodyStr !== null) {
    headers['content-type'] = headers['content-type'] ?? 'application/json';
    headers['content-length'] = String(Buffer.byteLength(bodyStr));
  }

  const start = Date.now();
  const deadline = start + durationMs;
  const latencies: number[] = [];
  let errors = 0;

  async function worker(): Promise<void> {
    while (Date.now() < deadline) {
      const t0 = Date.now();
      try {
        await new Promise<void>((resolve, reject) => {
          const req = doRequest(
            {
              method,
              protocol: target.protocol,
              hostname: target.hostname,
              port: target.port || (isHttps ? 443 : 80),
              path: `${target.pathname}${target.search}`,
              headers,
              agent,
            },
            (res: IncomingMessage) => {
              // Consume the body so keep-alive can reuse the socket.
              res.on('data', () => {});
              res.on('end', () => {
                if (!res.statusCode || res.statusCode >= 500) {
                  reject(new Error(`status ${res.statusCode ?? 'unknown'}`));
                  return;
                }
                resolve();
              });
              res.on('error', reject);
            },
          );
          req.setTimeout(Math.min(durationMs, 10_000), () => req.destroy(new Error('timeout')));
          req.on('error', reject);
          if (bodyStr !== null) req.write(bodyStr);
          req.end();
        });
        latencies.push(Date.now() - t0);
      } catch {
        errors += 1;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  agent.destroy();

  const elapsed = Date.now() - start;
  const total = latencies.length + errors;
  const sorted = latencies.slice().sort((a, b) => a - b);
  const pct = (p: number): number => {
    if (sorted.length === 0) return 0;
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx] ?? 0;
  };
  const mean = sorted.length === 0 ? 0 : sorted.reduce((a, b) => a + b, 0) / sorted.length;

  return {
    rps: elapsed === 0 ? 0 : (latencies.length * 1000) / elapsed,
    p50: pct(50),
    p95: pct(95),
    p99: pct(99),
    mean,
    errorRate: total === 0 ? 0 : errors / total,
    totalRequests: total,
    errors,
    durationMs: elapsed,
  };
}
