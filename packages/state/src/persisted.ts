import type {
  ListQuery,
  ListResult,
  StateEngine,
  StateRecord,
  StateSnapshot,
} from './engine.js';
import type { ResourceId } from '@carbon/types';

export interface PersistedStateOptions {
  readonly load: () => Promise<StateSnapshot | null>;
  readonly save: (snapshot: StateSnapshot) => Promise<void>;
  /** How long to wait after the last write before flushing to storage. Default 250ms. */
  readonly debounceMs?: number;
}

/**
 * Wraps a StateEngine so state is durably persisted through the caller's
 * storage of choice. On boot, `load()` is called once and (if a snapshot is
 * returned) applied via `restore`. On every mutating operation, a debounced
 * write flushes the latest snapshot back to `save`.
 *
 * The wrapper preserves the underlying engine's semantics (transactions,
 * snapshot API, deterministic ids). It never introduces cross-request
 * blocking — writes complete synchronously; persistence is best-effort.
 */
export async function withPersistence(
  engine: StateEngine,
  opts: PersistedStateOptions,
): Promise<StateEngine> {
  const initial = await opts.load();
  if (initial) await engine.restore(initial);

  const debounce = opts.debounceMs ?? 250;
  let timer: NodeJS.Timeout | null = null;
  let pending: Promise<void> | null = null;

  const flush = () => {
    if (pending) return pending;
    pending = engine.snapshot().then(async (snap) => {
      try {
        await opts.save(snap);
      } finally {
        pending = null;
      }
    });
    return pending;
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, debounce);
  };

  return {
    read(resource: ResourceId, id: string): Promise<StateRecord | null> {
      return engine.read(resource, id);
    },
    list(resource: ResourceId, query?: ListQuery): Promise<ListResult> {
      return engine.list(resource, query);
    },
    async create(resource, value) {
      const r = await engine.create(resource, value);
      schedule();
      return r;
    },
    async update(resource, id, patch) {
      const r = await engine.update(resource, id, patch);
      schedule();
      return r;
    },
    async replace(resource, id, value) {
      const r = await engine.replace(resource, id, value);
      schedule();
      return r;
    },
    async delete(resource, id) {
      await engine.delete(resource, id);
      schedule();
    },
    transaction: (fn) => engine.transaction(fn),
    async snapshot() {
      return engine.snapshot();
    },
    async restore(snap) {
      await engine.restore(snap);
      schedule();
    },
    async reset() {
      await engine.reset();
      schedule();
    },
  };
}
