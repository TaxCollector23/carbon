import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import { URL } from 'node:url';
import { makeId, NoopLogger, type Logger } from '@carbon/core';
import type { HttpMethod, Recording, RecordedExchange } from '@carbon/types';
import {
  DEFAULT_REDACT_HEADERS,
  type ProxyHandle,
  type ProxyStartOptions,
  type RecordingProxy,
} from './types.js';

const DEFAULT_MAX_BODY = 2 * 1024 * 1024; // 2MB per body

/**
 * Cleartext HTTP recording proxy.
 *
 * Design decisions worth surfacing:
 *   - We proxy at the request level, not the socket level. Simpler code, and
 *     we get parsed headers/bodies for free — which is exactly what we need
 *     to synthesize a Recording.
 *   - The proxy is authoritative for `Host`: the incoming Host header is
 *     replaced with the upstream host so origin-based routing works.
 *   - Redaction happens at capture time. Once redacted, the original value
 *     is gone — we never keep raw secrets in memory or on disk.
 *   - Body capture is bounded (`maxBodyBytes`, default 2MB). Large bodies
 *     still stream to the upstream and back to the caller; only the captured
 *     copy is truncated with an appended marker.
 *
 * TLS interception lives in a separate class (later milestone) so the code
 * paths cannot mix accidentally.
 */
export class HttpRecordingProxy implements RecordingProxy {
  async start(opts: ProxyStartOptions): Promise<ProxyHandle> {
    const logger = opts.logger ?? NoopLogger;
    const target = new URL(opts.target);
    const maxBody = opts.maxBodyBytes ?? DEFAULT_MAX_BODY;
    const redact = new Set(
      (opts.redactHeaders ?? DEFAULT_REDACT_HEADERS).map((h) => h.toLowerCase()),
    );
    const recordingId = makeId('rec');
    const startedAt = Date.now();
    const exchanges: RecordedExchange[] = [];

    const server: Server = createServer((clientReq, clientRes) => {
      const receivedAt = Date.now();
      const clientBody = collectBody(clientReq, maxBody);

      const upstreamUrl = new URL(clientReq.url ?? '/', target);
      const outHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(clientReq.headers)) {
        if (v === undefined) continue;
        outHeaders[k] = Array.isArray(v) ? v.join(', ') : v;
      }
      outHeaders.host = target.host;

      const upstream = httpRequest(
        {
          method: clientReq.method,
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port || defaultPort(target.protocol),
          path: upstreamUrl.pathname + upstreamUrl.search,
          headers: outHeaders,
        },
        (upstreamRes) => {
          clientRes.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
          const captured = tapStream(upstreamRes, clientRes, maxBody);
          upstreamRes.on('end', () => {
            void clientBody.then((reqBody) => {
              void captured.then((resBody) => {
                const sentAt = Date.now();
                const exchange = buildExchange({
                  method: (clientReq.method ?? 'GET').toUpperCase() as HttpMethod,
                  url: upstreamUrl.toString(),
                  requestHeaders: outHeaders,
                  requestBody: reqBody,
                  status: upstreamRes.statusCode ?? 0,
                  responseHeaders: normalizeHeaders(upstreamRes.headers),
                  responseBody: resBody,
                  receivedAt,
                  sentAt,
                  redact,
                });
                exchanges.push(exchange);
                opts.onExchange?.(exchange);
                logger.debug('proxy.exchange', {
                  method: exchange.request.method,
                  url: exchange.request.url,
                  status: exchange.response.status,
                  latencyMs: exchange.latencyMs,
                });
              });
            });
          });
        },
      );

      upstream.on('error', (err) => {
        logger.warn('proxy.upstream_error', { message: err.message });
        if (!clientRes.headersSent) clientRes.writeHead(502);
        clientRes.end();
      });

      clientReq.pipe(upstream);
    });

    const port = opts.port ?? 0;
    const host = opts.host ?? '127.0.0.1';
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => resolve());
    });
    const address = server.address();
    const boundPort = typeof address === 'object' && address ? address.port : port;
    const url = `http://${host}:${boundPort}`;

    logger.info('proxy.listening', { url, target: opts.target, recordingId });

    return {
      url,
      recordingId,
      stop: () =>
        new Promise<Recording>((resolve) => {
          server.close(() => {
            resolve({
              id: recordingId,
              source: 'proxy',
              startedAt,
              endedAt: Date.now(),
              exchanges,
            });
          });
        }),
    };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

interface BuildExchangeArgs {
  method: HttpMethod;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  status: number;
  responseHeaders: Record<string, string>;
  responseBody: string | null;
  receivedAt: number;
  sentAt: number;
  redact: Set<string>;
}

function buildExchange(a: BuildExchangeArgs): RecordedExchange {
  const applied: string[] = [];
  const reqHeaders = redactHeaders(a.requestHeaders, a.redact, applied);
  const resHeaders = redactHeaders(a.responseHeaders, a.redact, applied);
  return {
    id: makeId('xch'),
    request: {
      method: a.method,
      url: a.url,
      headers: reqHeaders,
      body: a.requestBody,
      receivedAt: a.receivedAt,
    },
    response: {
      status: a.status,
      headers: resHeaders,
      body: a.responseBody,
      sentAt: a.sentAt,
    },
    latencyMs: Math.max(0, a.sentAt - a.receivedAt),
    redactions: Array.from(new Set(applied)),
  };
}

function redactHeaders(
  headers: Record<string, string>,
  redact: Set<string>,
  applied: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (redact.has(k.toLowerCase())) {
      out[k] = '[redacted]';
      applied.push(k);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function normalizeHeaders(h: IncomingMessage['headers']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (v === undefined) continue;
    out[k] = Array.isArray(v) ? v.join(', ') : v;
  }
  return out;
}

async function collectBody(stream: IncomingMessage, max: number): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let truncated = false;
    stream.on('data', (chunk: Buffer) => {
      if (truncated) return;
      total += chunk.length;
      if (total <= max) {
        chunks.push(chunk);
      } else {
        const remaining = max - (total - chunk.length);
        if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
        truncated = true;
      }
    });
    stream.on('end', () => {
      if (chunks.length === 0) return resolve(null);
      const body = Buffer.concat(chunks).toString('utf8');
      resolve(truncated ? `${body}[...truncated]` : body);
    });
    stream.on('error', () => resolve(null));
  });
}

/**
 * Pipe a readable to a writable while collecting a bounded copy of the bytes.
 * The client always receives the full stream; the copy is used for recording.
 */
function tapStream(
  source: IncomingMessage,
  sink: NodeJS.WritableStream,
  max: number,
): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let truncated = false;
    source.on('data', (chunk: Buffer) => {
      sink.write(chunk);
      if (truncated) return;
      total += chunk.length;
      if (total <= max) {
        chunks.push(chunk);
      } else {
        const remaining = max - (total - chunk.length);
        if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
        truncated = true;
      }
    });
    source.on('end', () => {
      sink.end();
      if (chunks.length === 0) return resolve(null);
      const body = Buffer.concat(chunks).toString('utf8');
      resolve(truncated ? `${body}[...truncated]` : body);
    });
    source.on('error', () => {
      sink.end();
      resolve(null);
    });
  });
}

function defaultPort(protocol: string): number {
  return protocol === 'https:' ? 443 : 80;
}
