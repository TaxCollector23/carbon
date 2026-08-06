import { ConflictError } from '@carbon/core';
import type { PutOptions, Storage, StorageObject } from './storage.js';

/** In-memory storage — for tests and ephemeral SDK sessions. */
export class MemoryStorage implements Storage {
  readonly kind = 'memory' as const;
  private readonly data = new Map<string, { value: Uint8Array; modifiedAt: number; contentType?: string }>();

  async get(key: string): Promise<Uint8Array | null> {
    return this.data.get(key)?.value ?? null;
  }

  async put(key: string, value: Uint8Array | string, opts: PutOptions = {}): Promise<void> {
    if (opts.ifAbsent && this.data.has(key)) {
      throw new ConflictError(`Key already exists: ${key}`, { key });
    }
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
    this.data.set(key, { value: bytes, modifiedAt: Date.now(), contentType: opts.contentType });
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async *list(prefix: string): AsyncIterable<StorageObject> {
    for (const [key, entry] of this.data.entries()) {
      if (!key.startsWith(prefix)) continue;
      yield { key, size: entry.value.byteLength, modifiedAt: entry.modifiedAt, contentType: entry.contentType };
    }
  }

  async head(key: string): Promise<StorageObject | null> {
    const entry = this.data.get(key);
    return entry
      ? { key, size: entry.value.byteLength, modifiedAt: entry.modifiedAt, contentType: entry.contentType }
      : null;
  }
}
