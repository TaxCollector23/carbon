import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NotFound,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { ConflictError } from '@carbon/core';
import type { PutOptions, Storage, StorageObject, StorageStream } from './storage.js';

export interface S3StorageOptions {
  readonly bucket: string;
  readonly endpoint?: string; // e.g. https://<acct>.r2.cloudflarestorage.com
  readonly region?: string; // R2 uses 'auto'; S3 uses e.g. 'us-west-2'
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Path prefix applied to every key. Useful for multi-tenant buckets. */
  readonly prefix?: string;
  /**
   * Force path-style URLs (bucket in path, not subdomain). Required for R2,
   * MinIO, and most non-AWS S3-compatible services.
   */
  readonly forcePathStyle?: boolean;
}

/**
 * S3-compatible storage backend.
 *
 * Tested against:
 *   - Cloudflare R2 (default choice — 10 GB free, zero egress)
 *   - AWS S3
 *   - Backblaze B2
 *   - MinIO (local dev)
 *
 * For R2, pass `endpoint: https://<account_id>.r2.cloudflarestorage.com`,
 * `region: 'auto'`, `forcePathStyle: true`.
 */
export class S3Storage implements Storage {
  readonly kind = 's3' as const;
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(opts: S3StorageOptions) {
    this.bucket = opts.bucket;
    this.prefix = opts.prefix ? this.normalizePrefix(opts.prefix) : '';
    this.client = new S3Client({
      region: opts.region ?? 'auto',
      endpoint: opts.endpoint,
      credentials: {
        accessKeyId: opts.accessKeyId,
        secretAccessKey: opts.secretAccessKey,
      },
      forcePathStyle: opts.forcePathStyle ?? Boolean(opts.endpoint),
    });
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.k(key) }),
      );
      if (!res.Body) return null;
      return await streamToBytes(res.Body as unknown as AsyncIterable<Uint8Array>);
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async getStream(key: string): Promise<StorageStream | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.k(key) }),
      );
      if (!res.Body) return null;
      const body = res.Body as {
        transformToWebStream?: () => ReadableStream<Uint8Array>;
      } & AsyncIterable<Uint8Array>;
      const stream = body.transformToWebStream
        ? Readable.fromWeb(body.transformToWebStream() as Parameters<typeof Readable.fromWeb>[0])
        : Readable.from(body);
      // S3/R2 return their own ETag (usually the object MD5 in strong quotes).
      // Prefer it verbatim; fall back to the artifact-id convention when the
      // server omits it. Marked weak because JSON representations can vary
      // byte-for-byte without changing the logical artifact.
      const rawEtag = (res.ETag ?? '').replace(/^"|"$/g, '');
      const id =
        key
          .split('/')
          .pop()
          ?.replace(/\.[^.]+$/, '') ?? key;
      const etag = rawEtag ? `W/"${rawEtag}"` : `W/"${id}"`;
      return {
        stream,
        size: res.ContentLength ?? 0,
        etag,
      };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async put(key: string, value: Uint8Array | string, opts: PutOptions = {}): Promise<void> {
    if (opts.ifAbsent) {
      const head = await this.head(key);
      if (head) throw new ConflictError(`Key already exists: ${key}`, { key });
    }
    const body = typeof value === 'string' ? new TextEncoder().encode(value) : value;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.k(key),
        Body: body,
        ContentType: opts.contentType,
      }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.k(key) }));
  }

  async *list(prefix: string): AsyncIterable<StorageObject> {
    let continuationToken: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: this.k(prefix),
          ContinuationToken: continuationToken,
        }),
      );
      for (const obj of res.Contents ?? []) {
        if (!obj.Key) continue;
        yield {
          key: this.unk(obj.Key),
          size: obj.Size ?? 0,
          modifiedAt: obj.LastModified?.getTime() ?? 0,
        };
      }
      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (continuationToken);
  }

  async head(key: string): Promise<StorageObject | null> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.k(key) }),
      );
      return {
        key,
        size: res.ContentLength ?? 0,
        modifiedAt: res.LastModified?.getTime() ?? 0,
        contentType: res.ContentType,
      };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  private k(key: string): string {
    return this.prefix + key;
  }

  private unk(prefixed: string): string {
    return this.prefix && prefixed.startsWith(this.prefix)
      ? prefixed.slice(this.prefix.length)
      : prefixed;
  }

  private normalizePrefix(p: string): string {
    return p.endsWith('/') ? p : `${p}/`;
  }
}

function isNotFound(err: unknown): boolean {
  if (err instanceof NotFound) return true;
  const status = (err as { $metadata?: { httpStatusCode?: number }; name?: string })?.$metadata
    ?.httpStatusCode;
  return status === 404 || (err as { name?: string })?.name === 'NoSuchKey';
}

async function streamToBytes(stream: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream) {
    chunks.push(chunk);
    total += chunk.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
