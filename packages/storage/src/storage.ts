/**
 * Content-addressed key/value storage abstraction. Every Carbon artifact —
 * IR, behavior graph, snapshots, recordings — lives behind this interface.
 * Local FS today, S3-compatible tomorrow, cloud sync after that. Consumers
 * never know which backend is in use.
 *
 * Keys are namespaced with forward slashes for portability across backends.
 * Example: `projects/prj_abc/graphs/latest.json`.
 */
export interface Storage {
  readonly kind: 'fs' | 's3' | 'memory';

  get(key: string): Promise<Uint8Array | null>;
  put(key: string, value: Uint8Array | string, opts?: PutOptions): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix: string): AsyncIterable<StorageObject>;
  head(key: string): Promise<StorageObject | null>;
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
