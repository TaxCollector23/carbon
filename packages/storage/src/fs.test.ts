import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FsStorage } from './fs.js';

describe('FsStorage.getStream', () => {
  let root: string;
  let storage: FsStorage;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'carbon-fs-storage-'));
    storage = new FsStorage(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('streams matching bytes with the correct size and weak content-hash etag', async () => {
    const key = 'projects/acme/ir/hash123.json';
    const payload = JSON.stringify({ ir: 'yes', nested: { works: true } });
    await storage.put(key, payload);

    const result = await storage.getStream(key);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.size).toBe(Buffer.byteLength(payload));
    // Etag derives from the artifact id (basename minus extension), wrapped weak.
    expect(result.etag).toBe('W/"hash123"');

    const chunks: Buffer[] = [];
    for await (const chunk of result.stream) {
      chunks.push(chunk as Buffer);
    }
    expect(Buffer.concat(chunks).toString('utf8')).toBe(payload);
  });

  it('returns null for a missing key', async () => {
    const result = await storage.getStream('projects/acme/ir/nope.json');
    expect(result).toBeNull();
  });
});
