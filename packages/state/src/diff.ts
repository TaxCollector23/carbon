import type { ResourceId } from '@carbon/types';
import type { StateSnapshot } from './engine.js';

/**
 * A single row inside a snapshot. This intentionally mirrors the shape of
 * `StateSnapshot['records'][number]` (minus the resource, which is the outer
 * key in the diff) so consumers can treat rows as free-standing values.
 */
export interface DiffRow {
  readonly id: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface DiffChange {
  readonly before: DiffRow;
  readonly after: DiffRow;
  readonly changedFields: readonly string[];
}

export interface DiffResourceEntry {
  readonly added: readonly DiffRow[];
  readonly removed: readonly DiffRow[];
  readonly changed: readonly DiffChange[];
}

export interface SnapshotDiff {
  readonly a: { readonly takenAt: number; readonly recordCount: number };
  readonly b: { readonly takenAt: number; readonly recordCount: number };
  readonly resources: Readonly<Record<string, DiffResourceEntry>>;
}

/**
 * Diff two snapshots resource-by-resource. Rows keyed by id — anything only in
 * `b` is `added`, only in `a` is `removed`, present in both with different
 * `data` (deep equality) is `changed` with the set of top-level field names
 * that differ. `updatedAt`/`createdAt` are treated as metadata and are NOT
 * fields in `changedFields`; only entries in `data` count.
 */
export function diffSnapshots(a: StateSnapshot, b: StateSnapshot): SnapshotDiff {
  const byResourceA = groupByResource(a);
  const byResourceB = groupByResource(b);
  const allResources = new Set<string>([...byResourceA.keys(), ...byResourceB.keys()]);

  const resources: Record<string, DiffResourceEntry> = {};
  for (const resource of allResources) {
    const left = byResourceA.get(resource) ?? new Map<string, DiffRow>();
    const right = byResourceB.get(resource) ?? new Map<string, DiffRow>();
    const added: DiffRow[] = [];
    const removed: DiffRow[] = [];
    const changed: DiffChange[] = [];

    for (const [id, row] of right.entries()) {
      const prev = left.get(id);
      if (!prev) {
        added.push(row);
        continue;
      }
      const fields = changedFieldsOf(prev.data, row.data);
      if (fields.length > 0) {
        changed.push({ before: prev, after: row, changedFields: fields });
      }
    }
    for (const [id, row] of left.entries()) {
      if (!right.has(id)) removed.push(row);
    }

    resources[resource] = { added, removed, changed };
  }

  return {
    a: { takenAt: a.takenAt, recordCount: a.records.length },
    b: { takenAt: b.takenAt, recordCount: b.records.length },
    resources,
  };
}

function groupByResource(snap: StateSnapshot): Map<string, Map<string, DiffRow>> {
  const out = new Map<string, Map<string, DiffRow>>();
  for (const rec of snap.records) {
    const key = String(rec.resource as ResourceId);
    const table = out.get(key) ?? new Map<string, DiffRow>();
    table.set(rec.id, {
      id: rec.id,
      data: rec.data,
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt,
    });
    out.set(key, table);
  }
  return out;
}

function changedFieldsOf(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): string[] {
  const fields = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const f of fields) {
    if (!deepEqual(before[f], after[f])) changed.push(f);
  }
  changed.sort();
  return changed;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(bo, k)) return false;
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  return true;
}
