import type { ResourceId } from '@carbon/types';

export type MutationOp = 'create' | 'update' | 'replace' | 'delete';

/**
 * Serializable row snapshot used inside journal entries. Matches the shape of
 * a persisted record without the resource (kept on the entry itself).
 */
export interface JournalRow {
  readonly data: Readonly<Record<string, unknown>>;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface JournalEntry {
  readonly seq: number;
  readonly at: number;
  readonly op: MutationOp;
  readonly resource: ResourceId;
  readonly id: string;
  readonly before: JournalRow | null;
  readonly after: JournalRow | null;
}

/**
 * A bounded, monotonically indexed journal of state mutations. Used for
 * time-travel debugging — `rewindTo(seq)` applies inverse ops to walk the
 * engine back to the state it had immediately after entry `seq`, and
 * `forwardTo(seq)` re-applies forward ops toward the newest recorded entry.
 *
 * When the buffer overflows the cap, the oldest entries are dropped. That
 * also lowers the earliest seq the caller can rewind to — any seq older than
 * the current head is unreachable.
 */
export class MutationJournal {
  private readonly entries: JournalEntry[] = [];
  private next = 1;
  /** Index of the last-applied entry; -1 when the log is empty or fully rewound. */
  private headIndex = -1;

  constructor(private readonly capacity: number = 500) {
    if (capacity < 1) throw new Error('MutationJournal capacity must be >= 1');
  }

  /**
   * Record a new mutation. Drops any entries past the current head (redo tail),
   * appends the new entry, and trims to the capacity from the front.
   */
  record(entry: Omit<JournalEntry, 'seq'>): JournalEntry {
    // Discard the redo tail — a new mutation after a rewind forks history.
    if (this.headIndex + 1 < this.entries.length) {
      this.entries.length = this.headIndex + 1;
    }
    const stamped: JournalEntry = { ...entry, seq: this.next++ };
    this.entries.push(stamped);
    while (this.entries.length > this.capacity) {
      this.entries.shift();
    }
    this.headIndex = this.entries.length - 1;
    return stamped;
  }

  history(): readonly JournalEntry[] {
    return this.entries.slice(0, this.headIndex + 1);
  }

  /** Full log including redo tail — useful for the emulator UI. */
  allEntries(): readonly JournalEntry[] {
    return [...this.entries];
  }

  headSeq(): number | null {
    return this.headIndex >= 0 ? this.entries[this.headIndex]!.seq : null;
  }

  /** Returns entries between the current head and `seq` (exclusive of head, inclusive of seq). */
  planRewind(targetSeq: number): JournalEntry[] {
    // Walk backwards from head down to and NOT including the entry with seq == targetSeq.
    const out: JournalEntry[] = [];
    for (let i = this.headIndex; i >= 0; i--) {
      const e = this.entries[i]!;
      if (e.seq <= targetSeq) break;
      out.push(e);
    }
    return out;
  }

  planForward(targetSeq: number): JournalEntry[] {
    const out: JournalEntry[] = [];
    for (let i = this.headIndex + 1; i < this.entries.length; i++) {
      const e = this.entries[i]!;
      if (e.seq > targetSeq) break;
      out.push(e);
    }
    return out;
  }

  /** Mark that `count` entries were popped from the head via rewind. */
  moveHeadBy(delta: number): void {
    this.headIndex = Math.max(-1, Math.min(this.entries.length - 1, this.headIndex + delta));
  }

  clear(): void {
    this.entries.length = 0;
    this.headIndex = -1;
    // seq keeps advancing so post-clear journals remain totally ordered.
  }
}
