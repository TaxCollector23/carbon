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
import { ConflictError, makeId, NotFoundError, NoopLogger, type Logger } from '@carbon/core';
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
}

export interface SandboxRegistryOptions {
  readonly logger?: Logger;
  /** Ceiling on concurrently running sandboxes. Default 16. */
  readonly maxSandboxes?: number;
  /** Idle TTL before a sandbox is swept. Default 15 minutes. */
  readonly idleTtlMs?: number;
}

interface Entry {
  record: SandboxRecord;
  runtime: Runtime;
}

export function createSandboxRegistry(options: SandboxRegistryOptions = {}): SandboxRegistry {
  const logger = options.logger ?? NoopLogger;
  const maxSandboxes = options.maxSandboxes ?? 16;
  const idleTtlMs = options.idleTtlMs ?? 15 * 60 * 1000;
  const entries = new Map<string, Entry>();
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
      entries.set(entry.record.id, entry);
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

      const headers: Record<string, string> = {};
      if (contentType) headers['content-type'] = contentType;
      const hasBody = body !== undefined && !['GET', 'HEAD'].includes(method.toUpperCase());

      const started = performance.now();
      const res = await fetch(entry.record.url + path, {
        method,
        headers,
        body: hasBody ? body : undefined,
      });
      const text = await res.text();
      const latencyMs = round(performance.now() - started);

      let parsed: unknown = text;
      if (text.length > 0) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }

      entry.record.lastActivityAt = Date.now();
      entry.record.requestCount += 1;
      return {
        status: res.status,
        headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
        body: parsed,
        latencyMs,
      };
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
