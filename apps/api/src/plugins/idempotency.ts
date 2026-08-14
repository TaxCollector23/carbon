import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from './api-key.js';
import { recordIdempotencyOutcome } from './metrics.js';

export interface IdempotencyOptions {
  readonly redis: Redis;
  /** How long to cache the first response, in seconds. Default 24h. */
  readonly ttlSec?: number;
  /** Prefix for keys. */
  readonly keyPrefix?: string;
  /** How long the inflight lock lives before it self-expires. Default 30s. */
  readonly lockTtlSec?: number;
  /**
   * When true, every mutating request (POST/PATCH/DELETE) MUST carry an
   * `Idempotency-Key` header — anything else gets a 400
   * IDEMPOTENCY_KEY_REQUIRED. Paths in {@link allowUnkeyed} bypass the check
   * (webhooks, health probes, cli-auth polling — anything designed to accept
   * safe retries or that the caller cannot key). Off by default so existing
   * clients keep working during the rollout.
   *
   * Wire via env `CARBON_REQUIRE_IDEMPOTENCY=1`.
   */
  readonly requireKey?: boolean;
  /**
   * Route patterns (as matched by Fastify — e.g. `/v1/billing/webhook`) that
   * are allowed through even when {@link requireKey} is on. Defaults to
   * {@link DEFAULT_ALLOW_UNKEYED}.
   */
  readonly allowUnkeyed?: Iterable<string>;
}

/**
 * Paths that accept unkeyed mutating requests even when `requireKey` is on.
 *
 * - `/v1/billing/webhook` — Stripe retries with its own dedupe, and the caller
 *   isn't a Carbon client so we can't push a header on them.
 * - `/v1/cli-auth/*` — the CLI polls these before it holds an API key; the
 *   sessionId already carries per-request identity.
 * - `/scim/v2/*` — the SCIM spec doesn't define an idempotency header and IdPs
 *   won't set one.
 * - `/v1/invitations/accept` — one-shot user action from an email link.
 */
export const DEFAULT_ALLOW_UNKEYED: readonly string[] = [
  '/v1/billing/webhook',
  '/v1/cli-auth/start',
  '/v1/cli-auth/:sessionId/approve',
  '/v1/cli-auth/:sessionId/deny',
  '/v1/invitations/accept',
  '/scim/v2/Users',
  '/scim/v2/Users/:id',
];

/**
 * Stripe-style idempotency, implemented with Fastify's `preHandler` +
 * `onSend` hooks. We used to monkey-patch `reply.send` to intercept the
 * outgoing payload; that reached into Fastify's reply pipeline in a way that
 * a future minor version could quietly break. The hook API is Fastify's
 * public contract and is the right place to do this.
 *
 * Flow (POST/PATCH/DELETE with `Idempotency-Key: <key>`):
 *   preHandler  →  1. If a cached response exists, replay it with
 *                    `idempotent-replay: true` and return.
 *                  2. Otherwise SETNX a lock with a 30s TTL. If the lock is
 *                     already held (concurrent retry of an inflight request)
 *                     return 409 CARBON_CONFLICT + `retry-after: 1`.
 *                  3. On success, remember the storage keys on the request so
 *                     `onSend` can populate them later.
 *   onSend      →  1. If the payload is a stream, skip caching entirely — we
 *                    would have to buffer the whole thing in memory, which is
 *                    exactly the wrong trade-off for large artifact downloads.
 *                  2. If the status is >= 400, skip caching and release the
 *                    lock so a fresh retry hits the handler.
 *                  3. Otherwise store `{status, headers, body}` under a 24h
 *                    TTL and release the lock in the same MULTI.
 */
const KEY_PATTERN = /^[A-Za-z0-9._~-]{16,128}$/;

interface CachedResponse {
  readonly status: number;
  /** Headers to replay verbatim (minus hop-by-hop and per-request ones). */
  readonly headers: Record<string, string | string[]>;
  /** Payload bytes, base64-encoded so Redis stores a plain string. */
  readonly bodyB64: string;
}

interface IdemState {
  readonly respKey: string;
  readonly lockKey: string;
}

const STATE = Symbol('carbon.idempotencyState');

interface StatefulRequest extends FastifyRequest {
  [STATE]?: IdemState;
}

export async function registerIdempotency(
  app: FastifyInstance,
  ctx: AppContext,
  opts: IdempotencyOptions,
): Promise<void> {
  const ttl = opts.ttlSec ?? 60 * 60 * 24;
  const lockTtl = opts.lockTtlSec ?? 30;
  const prefix = opts.keyPrefix ?? 'carbon:idem';
  const requireKey =
    opts.requireKey ?? /^(1|true|yes|on)$/i.test(process.env.CARBON_REQUIRE_IDEMPOTENCY ?? '');
  const allowUnkeyed = new Set(opts.allowUnkeyed ?? DEFAULT_ALLOW_UNKEYED);

  app.addHook('preHandler', async (req, reply) => {
    const method = req.method.toUpperCase();
    if (method !== 'POST' && method !== 'PATCH' && method !== 'DELETE') return;

    const raw = req.headers['idempotency-key'];
    const key = Array.isArray(raw) ? raw[0] : raw;
    if (!key) {
      if (!requireKey) return;
      const route = req.routeOptions?.url ?? '';
      if (allowUnkeyed.has(route)) return;
      reply.status(400).send({
        error: {
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          message:
            'Mutating requests must include an Idempotency-Key header (16-128 URL-safe chars).',
        },
      });
      return reply;
    }
    if (!KEY_PATTERN.test(key)) {
      reply.status(400).send({
        error: {
          code: 'CARBON_INVALID_INPUT',
          message: 'Idempotency-Key must be 16-128 chars from the URL-safe set [A-Za-z0-9._~-]',
        },
      });
      return reply;
    }

    const storageKey = `${prefix}:${identify(req)}:${key}`;
    const respKey = `${storageKey}:resp`;
    const lockKey = `${storageKey}:lock`;

    // Cache lookup first: a hit skips both the lock and the handler.
    const cachedRaw = await opts.redis.get(respKey);
    if (cachedRaw) {
      const cached = safeParse(cachedRaw);
      if (cached) {
        recordIdempotencyOutcome('hit');
        replayCached(reply, cached);
        return reply;
      }
      // Corrupt entry — fall through and treat like a miss.
    }

    // Concurrent inflight guard: SET NX so only the first retry wins.
    // If we lose the race, the response is not yet cached, so we can't
    // replay — surface a 409 and let the client retry after the lock expires.
    const acquired = await opts.redis.set(lockKey, '1', 'EX', lockTtl, 'NX');
    if (acquired !== 'OK') {
      recordIdempotencyOutcome('conflict');
      reply.header('retry-after', '1');
      reply.status(409).send({
        error: {
          code: 'CARBON_CONFLICT',
          message: 'An idempotent request with this key is already in progress',
        },
      });
      return reply;
    }

    recordIdempotencyOutcome('miss');
    (req as StatefulRequest)[STATE] = { respKey, lockKey };
    reply.header('idempotent-replay', 'false');
  });

  app.addHook('onSend', async (req, reply, payload) => {
    const state = (req as StatefulRequest)[STATE];
    if (!state) return payload;

    // Streams are single-consumption and can be arbitrarily large (think
    // artifact downloads). Buffering them here would either OOM the process
    // or drain the pipe before the client sees any bytes. Skip caching and
    // release the lock so retries hit the handler again.
    if (payload instanceof Readable) {
      recordIdempotencyOutcome('skipped_stream');
      ctx.logger.debug('idempotency.skip_stream', { key: state.respKey });
      opts.redis.del(state.lockKey).catch((err: unknown) => {
        ctx.logger.warn('idempotency.release_failed', {
          err: (err as Error).message,
        });
      });
      return payload;
    }

    // Only cache successes. A cached 500 would poison every retry with the
    // same key; a cached 4xx would deny a legitimate corrected retry.
    if (reply.statusCode >= 400) {
      opts.redis.del(state.lockKey).catch((err: unknown) => {
        ctx.logger.warn('idempotency.release_failed', {
          err: (err as Error).message,
        });
      });
      return payload;
    }

    const buffer = toBuffer(payload);
    const stored: CachedResponse = {
      status: reply.statusCode,
      headers: sanitizeHeaders(reply.getHeaders()),
      bodyB64: buffer.toString('base64'),
    };

    opts.redis
      .multi()
      .set(state.respKey, JSON.stringify(stored), 'EX', ttl)
      .del(state.lockKey)
      .exec()
      .catch((err: unknown) => {
        ctx.logger.warn('idempotency.write_failed', {
          err: (err as Error).message,
        });
      });

    return payload;
  });
}

function replayCached(reply: FastifyReply, cached: CachedResponse): void {
  for (const [name, value] of Object.entries(cached.headers)) {
    if (value === undefined) continue;
    reply.header(name, value);
  }
  reply.header('idempotent-replay', 'true');
  reply.status(cached.status).send(Buffer.from(cached.bodyB64, 'base64'));
}

function toBuffer(payload: unknown): Buffer {
  if (payload === undefined || payload === null) return Buffer.alloc(0);
  if (Buffer.isBuffer(payload)) return payload;
  if (payload instanceof Uint8Array) return Buffer.from(payload);
  if (typeof payload === 'string') return Buffer.from(payload);
  // Fastify normally serializes objects before onSend, but a hook earlier in
  // the chain might return one raw. Fall back to a JSON encoding so we still
  // replay something sensible.
  return Buffer.from(JSON.stringify(payload));
}

/**
 * Skim per-request and hop-by-hop headers off the cached response.
 *
 * `content-length` and `transfer-encoding` describe the wire framing of this
 * specific reply — Fastify re-derives them on replay. `date`, `x-request-id`
 * and `set-cookie` are per-request identity that would be misleading to
 * duplicate. Everything else (notably `content-type`) is preserved verbatim.
 */
function sanitizeHeaders(
  raw: ReturnType<FastifyReply['getHeaders']>,
): Record<string, string | string[]> {
  const drop = new Set([
    'content-length',
    'transfer-encoding',
    'connection',
    'date',
    'x-request-id',
    'set-cookie',
    'idempotent-replay',
  ]);
  const out: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(raw)) {
    const lower = name.toLowerCase();
    if (drop.has(lower)) continue;
    if (value === undefined) continue;
    if (typeof value === 'number') {
      out[lower] = String(value);
    } else if (Array.isArray(value)) {
      out[lower] = value.map(String);
    } else {
      out[lower] = String(value);
    }
  }
  return out;
}

function safeParse(raw: string): CachedResponse | null {
  try {
    const parsed = JSON.parse(raw) as CachedResponse;
    if (typeof parsed?.status !== 'number' || typeof parsed?.bodyB64 !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Caller scope for the key namespace. Authenticated requests are keyed by
 * the API key id (which is per-org), so two callers in the same org still
 * get isolated idempotency spaces. Anonymous requests fall back to remote
 * address — good enough for local dev; production requires auth anyway.
 */
function identify(req: FastifyRequest): string {
  const apiKey = (req as AuthenticatedRequest).apiKey;
  if (apiKey?.id) return `key:${apiKey.id}`;
  return `anon:${req.ip}`;
}
