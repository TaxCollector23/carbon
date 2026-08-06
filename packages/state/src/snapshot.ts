import { InvalidInputError } from '@carbon/core';
import type { StateSnapshot } from './engine.js';

/** Serialize a snapshot to a stable JSON string suitable for on-disk storage. */
export function serializeSnapshot(snapshot: StateSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

export function parseSnapshot(input: string): StateSnapshot {
  const parsed: unknown = JSON.parse(input);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as { version?: unknown }).version !== 1 ||
    !Array.isArray((parsed as { records?: unknown }).records)
  ) {
    throw new InvalidInputError('Snapshot is malformed');
  }
  return parsed as StateSnapshot;
}
