import type { Logger } from '@carbon/core';
import { makeId, NotFoundError, ConflictError } from '@carbon/core';
import { BehaviorGraphBuilder } from '@carbon/graph';
import {
  createRuntime,
  errorInjectionPlugin,
  latencyPlugin,
  assertionsPlugin,
  type AssertionRule,
  type ErrorInjectionRule,
  type LatencyProfile,
  type OnViolation,
  type Runtime,
} from '@carbon/runtime';
import { InMemoryStateEngine, parseSnapshot } from '@carbon/state';
import { StorageKeys, type Storage } from '@carbon/storage';
import type { BehaviorGraph, IntermediateRepresentation } from '@carbon/types';

/**
 * The Emulator Registry owns the lifecycle of every running Carbon runtime.
 *
 * Runtimes are held in-process. Boot flow:
 *   1. Load IR from storage (previously ingested).
 *   2. Compile graph.
 *   3. Restore snapshot if requested.
 *   4. Boot the Fastify runtime on a chosen port.
 *
 * Multiple emulators may run concurrently on distinct ports. Because Node's
 * event loop is single-threaded and we co-locate the runtime with the API,
 * this is bounded — the emulators are cheap, but not free. A future revision
 * moves each emulator into its own worker or child process; the registry
 * interface stays identical.
 */
export interface ChaosConfig {
  readonly errorRules?: readonly ErrorInjectionRule[];
  readonly latency?: LatencyProfile;
}

export interface EmulatorRegistry {
  create(input: CreateEmulatorInput): Promise<EmulatorRecord>;
  list(): EmulatorRecord[];
  get(id: string): EmulatorRecord;
  stop(id: string): Promise<void>;
  reset(id: string): Promise<void>;
  restore(id: string, snapshotName: string): Promise<void>;
  snapshot(id: string, name: string): Promise<{ storageKey: string }>;
  shutdown(): Promise<void>;
  /**
   * Replace the emulator's active chaos rules. The runtime keeps a mutable
   * reference the injection/latency plugins read on every request, so this
   * takes effect without restarting the runtime.
   */
  applyChaos(id: string, config: ChaosConfig): void;
  /** Current chaos config (for GET/introspection). */
  getChaos(id: string): ChaosConfig;
  /**
   * Install assertion rules on an emulator with a violation sink. Replaces
   * any prior rule set for that emulator.
   */
  installAssertions(id: string, rules: readonly AssertionRule[], onViolation: OnViolation): void;
}

export interface CreateEmulatorInput {
  readonly projectSlug: string;
  readonly irId: string;
  readonly port?: number;
  readonly host?: string;
  readonly snapshot?: string;
}

export interface EmulatorRecord {
  readonly id: string;
  readonly projectSlug: string;
  readonly irId: string;
  readonly url: string;
  readonly startedAt: number;
  readonly status: 'running' | 'stopped';
}

interface Entry {
  record: EmulatorRecord;
  runtime: Runtime;
  chaos: { errorRules: ErrorInjectionRule[]; latency: LatencyProfile };
  assertions: { rules: AssertionRule[]; onViolation: OnViolation | null };
}

export interface EmulatorRegistryOptions {
  readonly storage: Storage;
  readonly logger: Logger;
  /**
   * Ceiling on concurrently running emulators. Each one holds a compiled
   * graph, an in-memory state engine, and a listening socket in *this*
   * process, so an unbounded count is a straightforward way for one caller to
   * exhaust the API's memory and file descriptors. Default 25.
   */
  readonly maxEmulators?: number;
}

export function createEmulatorRegistry(deps: EmulatorRegistryOptions): EmulatorRegistry {
  const entries = new Map<string, Entry>();
  const builder = new BehaviorGraphBuilder();
  const maxEmulators = deps.maxEmulators ?? 25;

  async function loadIr(projectSlug: string, irId: string): Promise<IntermediateRepresentation> {
    const bytes = await deps.storage.get(StorageKeys.ir(projectSlug, irId));
    if (!bytes) throw new NotFoundError('ir', irId);
    return JSON.parse(new TextDecoder().decode(bytes)) as IntermediateRepresentation;
  }

  async function loadSnapshot(projectSlug: string, name: string) {
    const bytes = await deps.storage.get(StorageKeys.snapshot(projectSlug, name));
    if (!bytes) throw new NotFoundError('snapshot', name);
    return parseSnapshot(new TextDecoder().decode(bytes));
  }

  return {
    async create(input) {
      if (entries.size >= maxEmulators) {
        throw new ConflictError(
          `Emulator limit reached (${maxEmulators} running) — stop one before starting another`,
          { running: entries.size, limit: maxEmulators },
        );
      }

      const ir = await loadIr(input.projectSlug, input.irId);
      const graph: BehaviorGraph = builder.build(ir);
      const state = new InMemoryStateEngine();
      if (input.snapshot)
        await state.restore(await loadSnapshot(input.projectSlug, input.snapshot));

      // Mutable holders so the plugins we register at boot can be reconfigured
      // via `applyChaos` / `installAssertions` without restarting the runtime.
      const chaos: Entry['chaos'] = { errorRules: [], latency: {} };
      const assertions: Entry['assertions'] = { rules: [], onViolation: null };
      const runtime = await createRuntime({
        ir,
        graph,
        state,
        logger: deps.logger,
        plugins: [
          errorInjectionPlugin(() => chaos.errorRules),
          latencyPlugin(() => chaos.latency),
          assertionsPlugin(
            () => assertions.rules,
            () => assertions.onViolation ?? (() => {}),
          ),
        ],
      });
      const port = input.port ?? 0;
      let url: string;
      try {
        url = await runtime.listen(port, input.host ?? '127.0.0.1');
      } catch (err) {
        // A failed bind (port already in use) otherwise leaks the runtime and
        // whatever the graph build allocated — the entry is never recorded, so
        // `shutdown()` would never reach it.
        await runtime.close().catch(() => {
          /* the listen error is the one worth reporting */
        });
        throw err;
      }

      const id = makeId('emu');
      const record: EmulatorRecord = {
        id,
        projectSlug: input.projectSlug,
        irId: input.irId,
        url,
        startedAt: Date.now(),
        status: 'running',
      };
      entries.set(id, { record, runtime, chaos, assertions });
      deps.logger.info('emulator.created', { id, url, project: input.projectSlug });
      return record;
    },

    list() {
      return Array.from(entries.values()).map((e) => e.record);
    },

    get(id) {
      const entry = entries.get(id);
      if (!entry) throw new NotFoundError('emulator', id);
      return entry.record;
    },

    async stop(id) {
      const entry = entries.get(id);
      if (!entry) throw new NotFoundError('emulator', id);
      await entry.runtime.close();
      entries.delete(id);
      deps.logger.info('emulator.stopped', { id });
    },

    async reset(id) {
      const entry = entries.get(id);
      if (!entry) throw new NotFoundError('emulator', id);
      await entry.runtime.ctx.state.reset();
    },

    async restore(id, snapshotName) {
      const entry = entries.get(id);
      if (!entry) throw new NotFoundError('emulator', id);
      const snap = await loadSnapshot(entry.record.projectSlug, snapshotName);
      await entry.runtime.ctx.state.restore(snap);
    },

    async snapshot(id, name) {
      const entry = entries.get(id);
      if (!entry) throw new NotFoundError('emulator', id);
      const snap = await entry.runtime.ctx.state.snapshot();
      const key = StorageKeys.snapshot(entry.record.projectSlug, name);
      const head = await deps.storage.head(key);
      if (head) {
        throw new ConflictError(`snapshot ${name} already exists — delete it first`);
      }
      await deps.storage.put(key, JSON.stringify(snap), { contentType: 'application/json' });
      return { storageKey: key };
    },

    async shutdown() {
      await Promise.all(Array.from(entries.values()).map((e) => e.runtime.close()));
      entries.clear();
    },

    applyChaos(id, config) {
      const entry = entries.get(id);
      if (!entry) throw new NotFoundError('emulator', id);
      if (config.errorRules) {
        entry.chaos.errorRules = [...config.errorRules];
      }
      if (config.latency) {
        entry.chaos.latency = { ...config.latency };
      }
    },

    getChaos(id) {
      const entry = entries.get(id);
      if (!entry) throw new NotFoundError('emulator', id);
      return { errorRules: entry.chaos.errorRules, latency: entry.chaos.latency };
    },

    installAssertions(id, rules, onViolation) {
      const entry = entries.get(id);
      if (!entry) throw new NotFoundError('emulator', id);
      entry.assertions.rules = [...rules];
      entry.assertions.onViolation = onViolation;
    },
  };
}
