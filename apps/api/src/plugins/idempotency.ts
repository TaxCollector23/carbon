import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { AppContext } from '../context.js';

export interface IdempotencyOptions {
  readonly redis: Redis;
  /** How long to cache the first response, in seconds. Default 24h. */
  readonly ttlSec?: number;
  /** Prefix for keys. */
  readonly keyPrefix?: string;
}

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
    if (key.length < 8 || key.length > 128) {
      reply.status(400).send({
        error: { code: 'CARBON_INVALID_INPUT', message: 'Idempotency-Key must be 8–128 chars' },
      });
      return reply;
    }

    const bodyHash = hashBody(req.body);
    const storageKey = `${prefix}:${key}`;
    const cached = await opts.redis.hgetall(storageKey);

    if (cached && cached.status) {
      if (cached.hash && cached.hash !== bodyHash) {
        reply.status(409).send({
          error: {
            code: 'CARBON_CONFLICT',
            message: 'Idempotency-Key reused with a different request body',
          },
        });
        return reply;
      }
      const status = Number(cached.status);
      const body = cached.body ? JSON.parse(cached.body) : null;
      reply.header('idempotent-replay', 'true');
      reply.status(status).send(body);
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
        const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
        void opts.redis
          .multi()
          .hset(storageKey, {
            status: String(statusCode),
            hash: bodyHash,
            body: serialized,
          })
          .expire(storageKey, ttl)
          .exec()
          .catch((err) => ctx.logger.warn('idempotency.write_failed', { err: (err as Error).message }));
      }
      return original(payload);
    }) as typeof reply.send;
  });
}

function hashBody(body: unknown): string {
  if (body === undefined || body === null) return '';
  const canonical = typeof body === 'string' ? body : JSON.stringify(body);
  return createHash('sha256').update(canonical).digest('hex');
}
