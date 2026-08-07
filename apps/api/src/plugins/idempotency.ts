import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from './api-key.js';

export interface IdempotencyOptions {
  readonly redis: Redis;
  /** How long to cache the first response, in seconds. Default 24h. */
  readonly ttlSec?: number;
  /** Prefix for keys. */
  readonly keyPrefix?: string;
}

const CLAIM_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 0 then
  redis.call("HSET", KEYS[1], "hash", ARGV[1])
  redis.call("EXPIRE", KEYS[1], ARGV[2])
  return 1
end
return 0
`;

/**
 * Stripe-style idempotency. If a client sends `Idempotency-Key: <uuid>` on a
 * write (POST/PATCH/DELETE), we cache the first response and replay it for
 * every retry with the same key. This is the single biggest thing you can add
 * to make a public API safe under retries.
 *
 * We hash the request body along with the key: if a caller reuses a key but
 * sends a materially different body, we return 409 instead of silently
 * replaying a stale response — matches the spec Stripe published.
 *
 * Redis is required. In dev without Redis, register the plugin only if a
 * client is available; otherwise skip.
 */
export async function registerIdempotency(
  app: FastifyInstance,
  ctx: AppContext,
  opts: IdempotencyOptions,
): Promise<void> {
  const ttl = opts.ttlSec ?? 60 * 60 * 24;
  const prefix = opts.keyPrefix ?? 'carbon:idem';

  app.addHook('preHandler', async (req, reply) => {
    const method = req.method.toUpperCase();
    if (method !== 'POST' && method !== 'PATCH' && method !== 'DELETE') return;
    const raw = req.headers['idempotency-key'];
    const key = Array.isArray(raw) ? raw[0] : raw;
    if (!key) return;
    if (!isValidIdempotencyKey(key)) {
      reply.status(400).send({
        error: {
          code: 'CARBON_INVALID_INPUT',
          message: 'Idempotency-Key must be 8-128 visible ASCII chars',
        },
      });
      return reply;
    }

    const bodyHash = hashBody(req.body);
    const storageKey = [
      prefix,
      hashSegment(identify(req)),
      method,
      hashSegment(routeId(req)),
      hashSegment(key),
    ].join(':');
    const cached = await opts.redis.hgetall(storageKey);

    if (sendCachedOrConflict(reply, cached, bodyHash)) {
      return reply;
    }

    const claimed = await opts.redis.eval(CLAIM_SCRIPT, 1, storageKey, bodyHash, String(ttl));
    if (Number(claimed) !== 1) {
      const latest = await opts.redis.hgetall(storageKey);
      if (sendCachedOrConflict(reply, latest, bodyHash)) {
        return reply;
      }
      reply.header('retry-after', '1');
      reply.status(409).send({
        error: {
          code: 'CARBON_CONFLICT',
          message: 'An idempotent request with this key is already in progress',
        },
      });
      return reply;
    }

    // Attach a serializer hook so we can capture the response for later replay.
    reply.header('idempotent-replay', 'false');
    const original = reply.send.bind(reply);
    reply.send = ((payload: unknown) => {
      // Only cache 2xx responses; retrying a 500 with the same key should
      // hit the server, not return a cached failure.
      const statusCode = reply.statusCode;
      if (statusCode >= 200 && statusCode < 300) {
        const serialized = serializePayload(payload);
        void opts.redis
          .multi()
          .hset(storageKey, {
            status: String(statusCode),
            hash: bodyHash,
            body: serialized.body,
            bodyEncoding: serialized.encoding,
          })
          .expire(storageKey, ttl)
          .exec()
          .catch((err) =>
            ctx.logger.warn('idempotency.write_failed', { err: (err as Error).message }),
          );
      } else {
        void opts.redis
          .del(storageKey)
          .catch((err) =>
            ctx.logger.warn('idempotency.release_failed', { err: (err as Error).message }),
          );
      }
      return original(payload);
    }) as typeof reply.send;
  });
}

function sendCachedOrConflict(
  reply: FastifyReply,
  cached: Record<string, string>,
  bodyHash: string,
): boolean {
  if (!cached.hash) return false;
  if (cached.hash !== bodyHash) {
    reply.status(409).send({
      error: {
        code: 'CARBON_CONFLICT',
        message: 'Idempotency-Key reused with a different request body',
      },
    });
    return true;
  }
  if (!cached.status) {
    reply.header('retry-after', '1');
    reply.status(409).send({
      error: {
        code: 'CARBON_CONFLICT',
        message: 'An idempotent request with this key is already in progress',
      },
    });
    return true;
  }
  reply.header('idempotent-replay', 'true');
  reply
    .status(Number(cached.status))
    .send(deserializePayload(cached.body ?? '', cached.bodyEncoding));
  return true;
}

function isValidIdempotencyKey(key: string): boolean {
  return /^[\x21-\x7e]{8,128}$/.test(key);
}

function hashBody(body: unknown): string {
  if (body === undefined || body === null) return '';
  const canonical = typeof body === 'string' ? body : JSON.stringify(body);
  return createHash('sha256').update(canonical).digest('hex');
}

function identify(req: FastifyRequest): string {
  const apiKey = (req as AuthenticatedRequest).apiKey;
  if (apiKey?.prefix) return `key:${apiKey.prefix}`;
  return `ip:${req.ip}`;
}

function routeId(req: FastifyRequest): string {
  return req.routeOptions.url ?? new URL(req.url, 'http://carbon.internal').pathname;
}

function hashSegment(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

function serializePayload(payload: unknown): { body: string; encoding: string } {
  if (payload === undefined) return { body: '', encoding: 'empty' };
  if (typeof payload === 'string') return { body: payload, encoding: 'text' };
  if (Buffer.isBuffer(payload)) return { body: payload.toString('base64'), encoding: 'base64' };
  if (payload instanceof Uint8Array) {
    return { body: Buffer.from(payload).toString('base64'), encoding: 'base64' };
  }
  return { body: JSON.stringify(payload), encoding: 'json' };
}

function deserializePayload(body: string, encoding: string | undefined): unknown {
  switch (encoding) {
    case 'empty':
      return undefined;
    case 'text':
      return body;
    case 'base64':
      return Buffer.from(body, 'base64');
    case 'json':
    default:
      return body ? JSON.parse(body) : null;
  }
}
