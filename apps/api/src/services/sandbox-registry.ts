/**
 * sandbox-registry.ts
 *
 * Short-lived, org-less Carbon runtimes for the public "test drive" console
 * on the marketing site. This is the "browser request builder backed by
 * short-lived sandbox emulators" from the roadmap — a visitor starts a real
 * runtime from a bundled sample spec, pokes it over real HTTP through the
 * API's proxy, rewinds/snapshots its state, and the sandbox evaporates after
 * an idle TTL.
 *
 * Deliberately separate from the Emulator Registry:
 *   - Emulator Registry: org-scoped, IR persisted to storage, project ACLs,
 *     per-plan ceilings, audit events. The *product*.
 *   - Sandbox Registry: anonymous, fixture-sourced, bounded and swept, no
 *     events, no storage. The *demo*.
 *
 * The runtime is booted in-process and bound to an ephemeral loopback port,
 * exactly like the emulator path, so a regression in graph compilation or the
 * state engine fails the demo too — there is no hand-rolled fake behind the
 * marketing page.
 */
import { performance } from 'node:perf_hooks';
import { BehaviorGraphBuilder } from '@carbon/graph';
import { createRuntime, type Runtime } from '@carbon/runtime';
import { InMemoryStateEngine } from '@carbon/state';
import { createDefaultParserRegistry, createParserContext } from '@carbon/parser';
import {
  CarbonError,
  ConflictError,
  InvalidInputError,
  isCarbonError,
  makeId,
  NotFoundError,
  NoopLogger,
  type Logger,
} from '@carbon/core';
import type { IntermediateRepresentation } from '@carbon/types';

export interface SandboxRecord {
  readonly id: string;
  readonly url: string;
  readonly sample: string;
  readonly spec: string;
  readonly startedAt: number;
  /** Mutable by the registry (activity tracking) — see `proxy`/`sweep`. */
  lastActivityAt: number;
  requestCount: number;
}

export interface ProxyResult {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: unknown;
  readonly latencyMs: number;
}

export interface SandboxRegistry {
  /** Boot a runtime from a parsed spec. Sweeps expired sandboxes first. */
  create(spec: unknown, sample: string): Promise<SandboxRecord>;
  get(id: string): SandboxRecord;
  /** Forward one HTTP request to the sandbox's runtime and measure it. */
  proxy(
    id: string,
    method: string,
    path: string,
    body: string | undefined,
    contentType: string | undefined,
  ): Promise<ProxyResult>;
  stop(id: string): Promise<void>;
  count(): number;
  /** Evict sandboxes idle past the TTL. Cheap; safe to call on every create. */
  sweep(): Promise<void>;
  shutdown(): Promise<void>;
  /** Access the runtime's state engine for snapshot/history/rewind. */
  getState(id: string): unknown;
  /** Return the request audit log (most recent first). */
  getRequestLog(id: string, limit?: number): RequestLogEntry[];
  /** Return the parsed endpoints from the spec. */
  getEndpoints(id: string): Array<{ id: string; method: string; path: string; operation: string }>;
  /** Aggregate sandbox stats for the landing page. */
  getStats(): { activeSandboxes: number; totalRequests: number; topSamples: Array<{ sample: string; count: number }> };
}

export interface SandboxRegistryOptions {
  readonly logger?: Logger;
  /** Ceiling on concurrently running sandboxes. Default 16. */
  readonly maxSandboxes?: number;
  /** Idle TTL before a sandbox is swept. Default 15 minutes. */
  readonly idleTtlMs?: number;
  /** Test hook: override the global fetch used to proxy to runtimes. */
  readonly fetchImpl?: typeof fetch;
  /** Test hook: shorten the proxy timeout so the 504 path is reachable. */
  readonly proxyTimeoutMs?: number;
}

/**
 * Ceiling on one proxied request, in ms. The upstream is an in-process
 * runtime on loopback — any request taking this long is hung, not slow.
 */
const PROXY_TIMEOUT_MS = 10_000;

/**
 * Cap on a single proxied response body. The runtimes serve bundled sample
 * specs whose largest payloads are a few KB; anything past this cap is a
 * pathological or malicious response and gets truncated rather than buffered
 * in full.
 */
const MAX_PROXY_RESPONSE_BYTES = 2 * 1024 * 1024;

/**
 * Reject proxy paths that try to traverse the runtime's router (``..``
 * segments) or smuggle control characters. The query string is exempt —
 * fetch never resolves ``..`` in a query, and query values legitimately
 * contain dots/slashes.
 */
function assertSafeProxyPath(path: string): void {
  const pathOnly = path.split('?')[0] ?? path;
  if (pathOnly.includes('\0') || pathOnly.split('/').some((seg) => seg === '..')) {
    throw new InvalidInputError('Invalid proxy path — traversal is not allowed', { path: pathOnly });
  }
}

/**
 * Read a fetch response body up to {@link MAX_PROXY_RESPONSE_BYTES}, then
 * cancel the stream. Returns `{ text, truncated }` — a huge response is
 * sliced at the cap instead of being buffered in full.
 */
async function readCapped(res: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    return { text: '', truncated: true };
  }
  if (!res.body) {
    return { text: await res.text(), truncated: false };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        const keep = Math.max(0, maxBytes - (total - value.byteLength));
        text += decoder.decode(value.subarray(0, keep), { stream: true });
        await reader.cancel().catch(() => {});
        return { text, truncated: true };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { text, truncated: false };
  } finally {
    reader.releaseLock();
  }
}

const MAX_LOG_ENTRIES = 200;

export interface RequestLogEntry {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly latencyMs: number;
  /** Truncated body preview — first 512 chars. */
  readonly bodyPreview: string;
  readonly at: number;
}

interface Entry {
  record: SandboxRecord;
  runtime: Runtime;
  requestLog: RequestLogEntry[];
  ir: IntermediateRepresentation;
}

export function createSandboxRegistry(options: SandboxRegistryOptions = {}): SandboxRegistry {
  const logger = options.logger ?? NoopLogger;
  const maxSandboxes = options.maxSandboxes ?? 16;
  const idleTtlMs = options.idleTtlMs ?? 15 * 60 * 1000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const proxyTimeoutMs = options.proxyTimeoutMs ?? PROXY_TIMEOUT_MS;
  const entries = new Map<string, Entry>();
  const sampleCounts = new Map<string, number>();
  const builder = new BehaviorGraphBuilder();
  const parsers = createDefaultParserRegistry();

  async function boot(spec: unknown, sample: string): Promise<Entry> {
    const ir: IntermediateRepresentation = await parsers.parse(
      { kind: 'json', content: spec },
      createParserContext(logger, `${sample}.openapi.json`),
    );
    const graph = builder.build(ir);
    const state = new InMemoryStateEngine();
    const runtime = await createRuntime({ ir, graph, state, logger });
    let url: string;
    try {
      url = await runtime.listen(0);
    } catch (err) {
      // A failed bind leaks the runtime — close it before propagating.
      await runtime.close().catch(() => {
        /* the listen error is the one worth reporting */
      });
      throw err;
    }
  return {
    record: {
      id: makeId('sb'),
      url,
      sample,
      spec: ir.api.name,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      requestCount: 0,
    },
    runtime,
    requestLog: [],
    ir,
  };
  }

  return {
    async create(spec, sample) {
      await this.sweep();
      if (entries.size >= maxSandboxes) {
        throw new ConflictError(
          `Sandbox capacity reached (${maxSandboxes} running) — stop or wait for one to expire`,
          { running: entries.size, limit: maxSandboxes },
        );
      }
      const entry = await boot(spec, sample);
      // Concurrent creates can both pass the capacity check before either
      // finishes booting (boot is the slow part). Re-check after boot and
      // close the loser rather than silently running over the ceiling.
      if (entries.size >= maxSandboxes) {
        await entry.runtime.close().catch(() => {
          /* already closed */
        });
        throw new ConflictError(
          `Sandbox capacity reached (${maxSandboxes} running) — stop or wait for one to expire`,
          { running: entries.size, limit: maxSandboxes },
        );
      }
      entries.set(entry.record.id, entry);
      sampleCounts.set(sample, (sampleCounts.get(sample) ?? 0) + 1);
      logger.info('sandbox.created', { id: entry.record.id, sample, url: entry.record.url });
      return { ...entry.record };
    },

    get(id) {
      const entry = entries.get(id);
      if (!entry) throw new NotFoundError('sandbox', id);
      return { ...entry.record };
    },

    async proxy(id, method, path, body, contentType) {
      const entry = entries.get(id);
      if (!entry) throw new NotFoundError('sandbox', id);
      assertSafeProxyPath(path);

      const headers: Record<string, string> = {};
      if (contentType) headers['content-type'] = contentType;
      const hasBody = body !== undefined && !['GET', 'HEAD'].includes(method.toUpperCase());

      // Reject oversized request bodies before they hit the runtime.
      const MAX_REQUEST_BODY_BYTES = 512 * 1024; // 512 KB
      if (hasBody && body && body.length > MAX_REQUEST_BODY_BYTES) {
        throw new InvalidInputError(`Request body too large — max ${MAX_REQUEST_BODY_BYTES} bytes`, {
          received: body.length,
          limit: MAX_REQUEST_BODY_BYTES,
        });
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), proxyTimeoutMs);
      timer.unref?.();
      const started = performance.now();
      let res: Response;
      try {
        // Race the fetch against the abort signal so a fetch that ignores its
        // signal (stubs, misbehaving clients) still times out deterministically.
        res = await new Promise<Response>((resolve, reject) => {
          const onAbort = () =>
            reject(
              new CarbonError({
                code: 'CARBON_TIMEOUT',
                message: 'The sandbox runtime did not respond in time',
                expose: true,
              }),
            );
          controller.signal.addEventListener('abort', onAbort, { once: true });
          fetchImpl(entry.record.url + path, {
            method,
            headers,
            body: hasBody ? body : undefined,
            signal: controller.signal,
          }).then(
            resolve,
            (err: unknown) => {
              // The abort handler already rejected with CARBON_TIMEOUT; don't
              // double-reject (the real fetch rejects with AbortError on abort).
              if (!controller.signal.aborted) reject(err);
            },
          );
        });
      } catch (err) {
        if (isCarbonError(err)) throw err;
        // Connection refused etc. — the sandbox expired or crashed between
        // the lookup and this request.
        throw new CarbonError({
          code: 'CARBON_RUNTIME_UNAVAILABLE',
          message: 'The sandbox runtime is unavailable — it may have expired',
          cause: err,
          expose: true,
        });
      } finally {
        clearTimeout(timer);
      }
      const { text, truncated } = await readCapped(res, MAX_PROXY_RESPONSE_BYTES);
      const latencyMs = round(performance.now() - started);

      let parsed: unknown = text;
      if (!truncated && text.length > 0) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }

      entry.record.lastActivityAt = Date.now();
      entry.record.requestCount += 1;

      // Record in the audit log (bounded).
      const bodyStr = typeof parsed === 'string' ? parsed : JSON.stringify(parsed ?? null);
      entry.requestLog.push({
        method,
        path,
        status: res.status,
        latencyMs,
        bodyPreview: bodyStr.slice(0, 512),
        at: Date.now(),
      });
      if (entry.requestLog.length > MAX_LOG_ENTRIES) {
        entry.requestLog.splice(0, entry.requestLog.length - MAX_LOG_ENTRIES);
      }

      return {
        status: res.status,
        headers: {
          'content-type': res.headers.get('content-type') ?? 'application/json',
          ...(truncated ? { 'x-carbon-truncated': 'true' } : {}),
        },
        body: parsed,
        latencyMs,
      };
    },

    getState(id) {
      const entry = entries.get(id);
      if (!entry) throw new NotFoundError('sandbox', id);
      return entry.runtime.ctx.state;
    },

    getRequestLog(id, limit = 100) {
      const entry = entries.get(id);
      if (!entry) throw new NotFoundError('sandbox', id);
      return entry.requestLog.slice(-limit);
    },

    getEndpoints(id) {
      const entry = entries.get(id);
      if (!entry) throw new NotFoundError('sandbox', id);
      return entry.ir.endpoints.map((ep) => ({
        id: ep.id,
        method: ep.method,
        path: ep.path,
        operation: ep.operation,
      }));
    },

    getStats() {
      let totalRequests = 0;
      for (const e of entries.values()) {
        totalRequests += e.record.requestCount;
      }
      const topSamples = Array.from(sampleCounts.entries())
        .map(([sample, count]) => ({ sample, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
      return { activeSandboxes: entries.size, totalRequests, topSamples };
    },

    async stop(id) {
      const entry = entries.get(id);
      if (!entry) throw new NotFoundError('sandbox', id);
      entries.delete(id);
      await entry.runtime.close().catch(() => {
        /* already closed */
      });
      logger.info('sandbox.stopped', { id });
    },

    count() {
      return entries.size;
    },

    async sweep() {
      const now = Date.now();
      const expired = Array.from(entries.values()).filter(
        (e) => now - e.record.lastActivityAt >= idleTtlMs,
      );
      for (const e of expired) {
        entries.delete(e.record.id);
        await e.runtime.close().catch(() => {
          /* already closed */
        });
        logger.info('sandbox.swept', { id: e.record.id });
      }
    },

    async shutdown() {
      await Promise.all(
        Array.from(entries.values()).map((e) =>
          e.runtime.close().catch(() => {
            /* already closed */
          }),
        ),
      );
      entries.clear();
    },
  };
}

function round(n: number, digits = 3): number {
  const m = 10 ** digits;
  return Math.round(n * m) / m;
}
