/**
 * Content-addressed key/value storage abstraction. Every Carbon artifact —
 * IR, behavior graph, snapshots, recordings — lives behind this interface.
 * Local FS today, S3-compatible tomorrow, cloud sync after that. Consumers
 * never know which backend is in use.
 *
 * Keys are namespaced with forward slashes for portability across backends.
 * Example: `projects/prj_abc/graphs/latest.json`.
 */
import type { Readable } from 'node:stream';

export interface Storage {
  readonly kind: 'fs' | 's3' | 'memory';

  get(key: string): Promise<Uint8Array | null>;
  put(key: string, value: Uint8Array | string, opts?: PutOptions): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix: string): AsyncIterable<StorageObject>;
  head(key: string): Promise<StorageObject | null>;
  /**
   * Stream an object's bytes without buffering the whole payload in memory.
   *
   * Returns `null` when the key is missing. Backends that cannot stream
   * (or callers that always need bytes — e.g. the ingestion pipeline) may
   * continue to use {@link get}; this method is intentionally optional so
   * both APIs coexist.
   *
   * ETag convention: Carbon artifact ids are content hashes, so the id
   * itself is a strong content identifier. We still emit weak ETags
   * (`W/"<id>"`) because downstream JSON serialization — pretty-printing,
   * key ordering, trailing newlines — can vary byte-for-byte while the
   * logical artifact is unchanged. Weak semantics let intermediaries
   * treat those representations as equivalent for cache validation.
   */
  getStream?(key: string): Promise<StorageStream | null>;
}

export interface StorageStream {
  readonly stream: Readable;
  readonly size: number;
  readonly etag: string;
}

export interface PutOptions {
  readonly contentType?: string;
  /** Fail if a value already exists at this key. */
  readonly ifAbsent?: boolean;
}

export interface StorageObject {
  readonly key: string;
  readonly size: number;
  readonly modifiedAt: number;
  readonly contentType?: string;
}

export const StorageKeys = {
  project: (slug: string) => `projects/${slug}`,
  ir: (slug: string, id: string) => `projects/${slug}/ir/${id}.json`,
  graph: (slug: string, id: string) => `projects/${slug}/graphs/${id}.json`,
  snapshot: (slug: string, name: string) => `projects/${slug}/snapshots/${name}.json`,
  recording: (slug: string, id: string) => `projects/${slug}/recordings/${id}.jsonl`,
} as const;
