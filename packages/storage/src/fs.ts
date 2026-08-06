import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { ConflictError } from '@carbon/core';
import type { PutOptions, Storage, StorageObject } from './storage.js';

/** Filesystem-backed storage. Default backend for local development. */
export class FsStorage implements Storage {
  readonly kind = 'fs' as const;

  constructor(private readonly root: string) {}

  async get(key: string): Promise<Uint8Array | null> {
    const path = this.toPath(key);
    if (!existsSync(path)) return null;
    return new Uint8Array(await readFile(path));
  }

  async put(key: string, value: Uint8Array | string, opts: PutOptions = {}): Promise<void> {
    const path = this.toPath(key);
    if (opts.ifAbsent && existsSync(path)) {
      throw new ConflictError(`Key already exists: ${key}`, { key });
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, value);
  }

  async delete(key: string): Promise<void> {
    const path = this.toPath(key);
    await rm(path, { force: true });
  }

  async *list(prefix: string): AsyncIterable<StorageObject> {
    const base = this.toPath(prefix);
    if (!existsSync(base)) return;
    for await (const path of walk(base)) {
      const st = await stat(path);
      if (!st.isFile()) continue;
      yield {
        key: relative(this.root, path).split('\\').join('/'),
        size: st.size,
        modifiedAt: st.mtimeMs,
      };
    }
  }

  async head(key: string): Promise<StorageObject | null> {
    const path = this.toPath(key);
    if (!existsSync(path)) return null;
    const st = await stat(path);
    return { key, size: st.size, modifiedAt: st.mtimeMs };
  }

  private toPath(key: string): string {
    return join(this.root, key);
  }
}

async function* walk(dir: string): AsyncIterable<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}
