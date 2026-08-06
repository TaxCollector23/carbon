import type { ResourceId } from '@carbon/types';

/**
 * The StateEngine is Carbon's deterministic backend. It behaves like a
 * miniature database: reads reflect writes, writes are transactional, and
 * snapshots can be taken atomically.
 *
 * The interface is intentionally free of protocol concerns (HTTP, GraphQL)
 * so it can be driven by the runtime, the SDK, or replay tests uniformly.
 */
export interface StateEngine {
  read(resource: ResourceId, id: string): Promise<StateRecord | null>;
  list(resource: ResourceId, query?: ListQuery): Promise<ListResult>;
  create(resource: ResourceId, value: unknown): Promise<StateRecord>;
  update(resource: ResourceId, id: string, patch: unknown): Promise<StateRecord>;
  replace(resource: ResourceId, id: string, value: unknown): Promise<StateRecord>;
  delete(resource: ResourceId, id: string): Promise<void>;

  transaction<T>(fn: (tx: StateEngine) => Promise<T>): Promise<T>;

  /** Snapshot & restore — for reproducible tests and time-travel debugging. */
  snapshot(): Promise<StateSnapshot>;
  restore(snapshot: StateSnapshot): Promise<void>;
  reset(): Promise<void>;
}

export interface StateRecord {
  readonly resource: ResourceId;
  readonly id: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface ListQuery {
  readonly limit?: number;
  readonly cursor?: string | null;
  readonly filter?: Readonly<Record<string, unknown>>;
}

export interface ListResult {
  readonly items: readonly StateRecord[];
  readonly nextCursor: string | null;
  readonly total: number;
}

/** Serialized full-state envelope. Portable across processes and versions. */
export interface StateSnapshot {
  readonly version: 1;
  readonly takenAt: number;
  readonly records: ReadonlyArray<{
    readonly resource: ResourceId;
    readonly id: string;
    readonly data: Readonly<Record<string, unknown>>;
    readonly createdAt: number;
    readonly updatedAt: number;
  }>;
}
