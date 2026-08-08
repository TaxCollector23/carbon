import { ConflictError, NotFoundError, makeId } from '@carbon/core';
import type { ResourceId } from '@carbon/types';
import type {
  ListQuery,
  ListResult,
  StateEngine,
  StateRecord,
  StateSnapshot,
} from './engine.js';
import { MutationJournal, type JournalEntry, type JournalRow } from './journal.js';

export interface InMemoryStateEngineOptions {
  /** Cap for the built-in mutation journal. Defaults to 500 entries. */
  readonly journalCapacity?: number;
  /** Set to false to skip journaling entirely (marginal perf gain). */
  readonly journalEnabled?: boolean;
}

interface TableRow {
  data: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

type Store = Map<ResourceId, Map<string, TableRow>>;

/**
 * Deterministic in-memory implementation of StateEngine. Backed by nested
 * Maps for O(1) lookups. Transactions use a copy-on-write staging store so
 * failures leave the primary untouched. Time is injectable — tests get
 * reproducible timestamps without freezing global Date.
 */
export class InMemoryStateEngine implements StateEngine {
  private store: Store = new Map();
  private readonly journal: MutationJournal | null;

  constructor(
    private readonly clock: () => number = () => Date.now(),
    options: InMemoryStateEngineOptions = {},
  ) {
    this.journal = options.journalEnabled === false
      ? null
      : new MutationJournal(options.journalCapacity ?? 500);
  }

  private toJournalRow(row: TableRow): JournalRow {
    return { data: { ...row.data }, createdAt: row.createdAt, updatedAt: row.updatedAt };
  }

  private snapshotRow(resource: ResourceId, id: string): JournalRow | null {
    const existing = this.store.get(resource)?.get(id);
    return existing ? this.toJournalRow(existing) : null;
  }

  async read(resource: ResourceId, id: string): Promise<StateRecord | null> {
    const row = this.store.get(resource)?.get(id);
    return row ? this.toRecord(resource, id, row) : null;
  }

  async list(resource: ResourceId, query: ListQuery = {}): Promise<ListResult> {
    const table = this.store.get(resource);
    if (!table) return { items: [], nextCursor: null, total: 0 };

    const filter = query.filter;
    const filtered: Array<[string, TableRow]> = [];
    for (const entry of table.entries()) {
      if (!filter || matches(entry[1].data, filter)) filtered.push(entry);
    }
    filtered.sort((a, b) => a[1].createdAt - b[1].createdAt || a[0].localeCompare(b[0]));

    const limit = query.limit ?? 25;
    const startIndex = query.cursor ? filtered.findIndex(([id]) => id === query.cursor) + 1 : 0;
    const slice = filtered.slice(startIndex, startIndex + limit);
    const nextCursor = startIndex + limit < filtered.length ? slice[slice.length - 1]?.[0] ?? null : null;

    return {
      items: slice.map(([id, row]) => this.toRecord(resource, id, row)),
      nextCursor,
      total: filtered.length,
    };
  }

  async create(resource: ResourceId, value: unknown): Promise<StateRecord> {
    const table = this.tableFor(resource);
    const now = this.clock();
    const data = ensureObject(value);
    const providedId = typeof data.id === 'string' ? data.id : undefined;
    const id = providedId ?? makeId(shortenResource(resource));
    if (table.has(id)) {
      throw new ConflictError(`${resource} with id ${id} already exists`, { resource, id });
    }
    const row: TableRow = { data: { ...data, id }, createdAt: now, updatedAt: now };
    table.set(id, row);
    this.journal?.record({
      at: now,
      op: 'create',
      resource,
      id,
      before: null,
      after: this.toJournalRow(row),
    });
    return this.toRecord(resource, id, row);
  }

  async update(resource: ResourceId, id: string, patch: unknown): Promise<StateRecord> {
    const table = this.store.get(resource);
    const row = table?.get(id);
    if (!row) throw new NotFoundError(String(resource), id);
    const now = this.clock();
    const before = this.toJournalRow(row);
    const updated: TableRow = {
      data: { ...row.data, ...ensureObject(patch), id },
      createdAt: row.createdAt,
      updatedAt: now,
    };
    table!.set(id, updated);
    this.journal?.record({
      at: now,
      op: 'update',
      resource,
      id,
      before,
      after: this.toJournalRow(updated),
    });
    return this.toRecord(resource, id, updated);
  }

  async replace(resource: ResourceId, id: string, value: unknown): Promise<StateRecord> {
    const table = this.store.get(resource);
    const row = table?.get(id);
    if (!row) throw new NotFoundError(String(resource), id);
    const now = this.clock();
    const before = this.toJournalRow(row);
    const next: TableRow = {
      data: { ...ensureObject(value), id },
      createdAt: row.createdAt,
      updatedAt: now,
    };
    table!.set(id, next);
    this.journal?.record({
      at: now,
      op: 'replace',
      resource,
      id,
      before,
      after: this.toJournalRow(next),
    });
    return this.toRecord(resource, id, next);
  }

  async delete(resource: ResourceId, id: string): Promise<void> {
    const table = this.store.get(resource);
    const existing = table?.get(id);
    if (!existing || !table?.delete(id)) throw new NotFoundError(String(resource), id);
    this.journal?.record({
      at: this.clock(),
      op: 'delete',
      resource,
      id,
      before: this.toJournalRow(existing),
      after: null,
    });
  }

  async transaction<T>(fn: (tx: StateEngine) => Promise<T>): Promise<T> {
    const staged = new InMemoryStateEngine(this.clock);
    staged.store = cloneStore(this.store);
    const result = await fn(staged);
    this.store = staged.store;
    return result;
  }

  async snapshot(): Promise<StateSnapshot> {
    const records: Array<StateSnapshot['records'][number]> = [];
    for (const [resource, table] of this.store.entries()) {
      for (const [id, row] of table.entries()) {
        records.push({
          resource,
          id,
          data: { ...row.data },
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        });
      }
    }
    return { version: 1, takenAt: this.clock(), records };
  }

  history(): readonly JournalEntry[] {
    return this.journal ? this.journal.history() : [];
  }

  async rewindTo(seq: number): Promise<void> {
    if (!this.journal) throw new Error('Journal disabled — cannot rewind');
    const plan = this.journal.planRewind(seq);
    for (const entry of plan) {
      this.applyInverse(entry);
    }
    this.journal.moveHeadBy(-plan.length);
  }

  async forwardTo(seq: number): Promise<void> {
    if (!this.journal) throw new Error('Journal disabled — cannot forward');
    const plan = this.journal.planForward(seq);
    for (const entry of plan) {
      this.applyForward(entry);
    }
    this.journal.moveHeadBy(plan.length);
  }

  private applyInverse(entry: JournalEntry): void {
    // The inverse of `create` is `delete`; `delete` is `create`;
    // `update`/`replace` restore `before`.
    const table = this.tableFor(entry.resource);
    switch (entry.op) {
      case 'create':
        table.delete(entry.id);
        break;
      case 'delete':
        if (!entry.before) return;
        table.set(entry.id, { ...entry.before, data: { ...entry.before.data } });
        break;
      case 'update':
      case 'replace':
        if (!entry.before) return;
        table.set(entry.id, { ...entry.before, data: { ...entry.before.data } });
        break;
    }
  }

  private applyForward(entry: JournalEntry): void {
    const table = this.tableFor(entry.resource);
    switch (entry.op) {
      case 'create':
      case 'update':
      case 'replace':
        if (!entry.after) return;
        table.set(entry.id, { ...entry.after, data: { ...entry.after.data } });
        break;
      case 'delete':
        table.delete(entry.id);
        break;
    }
  }

  async restore(snapshot: StateSnapshot): Promise<void> {
    const next: Store = new Map();
    for (const rec of snapshot.records) {
      const table = next.get(rec.resource) ?? new Map<string, TableRow>();
      table.set(rec.id, {
        data: { ...rec.data },
        createdAt: rec.createdAt,
        updatedAt: rec.updatedAt,
      });
      next.set(rec.resource, table);
    }
    this.store = next;
    this.journal?.clear();
  }

  async reset(): Promise<void> {
    this.store = new Map();
    this.journal?.clear();
  }

  private tableFor(resource: ResourceId): Map<string, TableRow> {
    const existing = this.store.get(resource);
    if (existing) return existing;
    const table = new Map<string, TableRow>();
    this.store.set(resource, table);
    return table;
  }

  private toRecord(resource: ResourceId, id: string, row: TableRow): StateRecord {
    return {
      resource,
      id,
      data: { ...row.data },
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

function ensureObject(v: unknown): Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    throw new ConflictError('Resource body must be an object');
  }
  return { ...(v as Record<string, unknown>) };
}

function matches(row: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(filter)) {
    if (row[k] !== v) return false;
  }
  return true;
}

function cloneStore(src: Store): Store {
  const out: Store = new Map();
  for (const [k, table] of src.entries()) {
    const next = new Map<string, TableRow>();
    for (const [id, row] of table.entries()) {
      next.set(id, { data: { ...row.data }, createdAt: row.createdAt, updatedAt: row.updatedAt });
    }
    out.set(k, next);
  }
  return out;
}

function shortenResource(resource: ResourceId): string {
  return String(resource).slice(0, 4).toLowerCase();
}
