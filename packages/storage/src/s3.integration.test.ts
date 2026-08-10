import { createHash, randomBytes } from 'node:crypto';
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { S3Storage } from './s3.js';

/**
 * Real S3 integration suite — exercises the S3Storage backend against a
 * running MinIO instance. Gated on `STORAGE_MINIO_URL`; the unit `test`
 * script never runs this file (it is in *.integration.test.ts and picked
 * up only by `vitest.integration.config.ts`).
 *
 * Local:
 *   docker run --rm -p 9000:9000 minio/minio server /data
 *   STORAGE_MINIO_URL=http://127.0.0.1:9000 \
 *     pnpm --filter @carbon/storage test:integration
 *
 * CI: the `storage-integration` job in `.github/workflows/ci.yml` boots
 * MinIO as a service container and points this test at it.
 */
const endpoint = process.env.STORAGE_MINIO_URL;
const accessKeyId = process.env.STORAGE_MINIO_ACCESS_KEY ?? 'minioadmin';
const secretAccessKey = process.env.STORAGE_MINIO_SECRET_KEY ?? 'minioadmin';

const describeIf = endpoint ? describe : describe.skip;

describeIf('S3Storage against MinIO (integration)', () => {
  // Fresh bucket per run so parallel CI jobs and reruns cannot collide.
  const bucket = `carbon-it-${randomBytes(6).toString('hex')}`;
  let admin: S3Client;
  let storage: S3Storage;

  beforeAll(async () => {
    admin = new S3Client({
      region: 'us-east-1',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
    await admin.send(new CreateBucketCommand({ Bucket: bucket }));

    storage = new S3Storage({
      bucket,
      endpoint,
      region: 'us-east-1',
      accessKeyId,
      secretAccessKey,
      forcePathStyle: true,
      prefix: 'it/',
    });
  });

  afterAll(async () => {
    if (!admin) return;
    // MinIO refuses to delete non-empty buckets; sweep anything left over
    // from a failed assertion so subsequent runs on a persistent MinIO
    // don't inherit a graveyard of half-cleaned buckets.
    try {
      const listed = await admin.send(new ListObjectsV2Command({ Bucket: bucket }));
      for (const obj of listed.Contents ?? []) {
        if (obj.Key) {
          await admin.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key }));
        }
      }
      await admin.send(new DeleteBucketCommand({ Bucket: bucket }));
    } catch {
      // Best-effort cleanup — never fail the suite in afterAll.
    }
  });

  it('round-trips a value with put/get and preserves bytes', async () => {
    const key = 'projects/acme/blob.bin';
    const body = randomBytes(4096);
    await storage.put(key, body, { contentType: 'application/octet-stream' });

    const got = await storage.get(key);
    expect(got).not.toBeNull();
    expect(got!.byteLength).toBe(body.byteLength);
    expect(createHash('sha256').update(got!).digest('hex')).toBe(
      createHash('sha256').update(body).digest('hex'),
    );
  });

  it('head reports size and content-type for a written object', async () => {
    const key = 'projects/acme/head.json';
    const payload = JSON.stringify({ hello: 'minio' });
    await storage.put(key, payload, { contentType: 'application/json' });

    const meta = await storage.head(key);
    expect(meta).not.toBeNull();
    expect(meta!.size).toBe(Buffer.byteLength(payload));
    expect(meta!.contentType).toBe('application/json');
  });

  it('getStream returns a readable stream with matching bytes and server ETag', async () => {
    const key = 'projects/acme/stream.txt';
    const payload = 'hello '.repeat(200); // 1200 bytes, spans small chunks
    await storage.put(key, payload, { contentType: 'text/plain' });

    const result = await storage.getStream(key);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.size).toBe(Buffer.byteLength(payload));
    // S3-provided ETag is wrapped weak by S3Storage. Match shape rather than
    // exact md5 so the assertion survives MinIO's occasional ETag quirks.
    expect(result.etag).toMatch(/^W\/".+"$/);

    const chunks: Buffer[] = [];
    for await (const chunk of result.stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString('utf8')).toBe(payload);
  });

  it('list yields all keys under a prefix and unwraps the storage-level prefix', async () => {
    const keys = ['list/a.txt', 'list/b.txt', 'list/nested/c.txt'];
    for (const k of keys) {
      await storage.put(k, `body-${k}`);
    }

    const seen: string[] = [];
    for await (const obj of storage.list('list/')) {
      seen.push(obj.key);
      expect(obj.size).toBeGreaterThan(0);
    }
    for (const k of keys) expect(seen).toContain(k);
    // Storage-level prefix ('it/') must not leak into returned keys.
    expect(seen.every((k) => !k.startsWith('it/'))).toBe(true);
  });

  it('delete removes the object and get returns null afterwards', async () => {
    const key = 'delete/me.bin';
    await storage.put(key, randomBytes(64));
    expect(await storage.get(key)).not.toBeNull();

    await storage.delete(key);
    expect(await storage.get(key)).toBeNull();
    expect(await storage.head(key)).toBeNull();
  });

  it('ifAbsent put rejects a second write to the same key', async () => {
    const key = 'if-absent/once.txt';
    await storage.put(key, 'first', { ifAbsent: true });
    await expect(storage.put(key, 'second', { ifAbsent: true })).rejects.toThrow(/already exists/i);
    const got = await storage.get(key);
    expect(new TextDecoder().decode(got!)).toBe('first');
  });
});
