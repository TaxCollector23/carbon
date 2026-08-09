import type { Redis } from 'ioredis';
import type { Logger } from '@carbon/core';

/**
 * Transient store for freshly minted CLI-auth secrets that live between the
 * `/approve` call and the CLI's next `/poll`.
 *
 * The Phase A implementation stashed these in a process-local `Map`, which
 * breaks the moment the API is deployed with more than one replica behind a
 * load balancer: the browser hits replica A on approve, the CLI hits replica
 * B on poll, and the secret is nowhere to be found.
 *
 * When Redis is available we use it as the source of truth with a short TTL
 * (default 60s). When it's absent (local dev, tests), we fall back to an
 * in-memory `Map` with a per-entry `setTimeout` to auto-expire — same
 * semantics, single-process only.
 */
export interface SecretStore {
  put(id: string, secret: string): Promise<void>;
  take(id: string): Promise<string | null>;
}

export interface CreateSecretStoreDeps {
  readonly redis?: Redis;
  readonly logger: Logger;
  /** Default 60 seconds. Long enough for a ~2s poll cadence plus slack. */
  readonly ttlSec?: number;
}

const KEY_PREFIX = 'carbon:cli-auth-secret:';

export function createSecretStore(deps: CreateSecretStoreDeps): SecretStore {
  const ttlSec = deps.ttlSec ?? 60;
  if (deps.redis) return createRedisStore(deps.redis, deps.logger, ttlSec);
  return createMemoryStore(deps.logger, ttlSec);
}

function createRedisStore(redis: Redis, logger: Logger, ttlSec: number): SecretStore {
  return {
    async put(id, secret) {
      // NX so a concurrent approve for the same session cannot overwrite a
      // secret the CLI is about to consume. The narrow window makes this
      // mostly cosmetic, but it keeps the semantics honest.
      try {
        await redis.set(`${KEY_PREFIX}${id}`, secret, 'EX', ttlSec, 'NX');
      } catch (err) {
        logger.warn('cli_auth.secret_store.put_failed', {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    async take(id) {
      const key = `${KEY_PREFIX}${id}`;
      try {
        const results = await redis.multi().get(key).del(key).exec();
        if (!results) return null;
        const [getErr, value] = results[0] ?? [];
        if (getErr) {
          logger.warn('cli_auth.secret_store.take_failed', {
            message: getErr instanceof Error ? getErr.message : String(getErr),
          });
          return null;
        }
        return typeof value === 'string' && value.length > 0 ? value : null;
      } catch (err) {
        logger.warn('cli_auth.secret_store.take_failed', {
          message: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    },
  };
}

function createMemoryStore(_logger: Logger, ttlSec: number): SecretStore {
  const entries = new Map<string, { secret: string; timer: ReturnType<typeof setTimeout> }>();
  return {
    async put(id, secret) {
      const existing = entries.get(id);
      if (existing) clearTimeout(existing.timer);
      const timer = setTimeout(() => entries.delete(id), ttlSec * 1000);
      // unref so a stray secret doesn't hold the event loop open in tests.
      if (typeof (timer as { unref?: () => void }).unref === 'function') {
        (timer as { unref: () => void }).unref();
      }
      entries.set(id, { secret, timer });
    },
    async take(id) {
      const entry = entries.get(id);
      if (!entry) return null;
      clearTimeout(entry.timer);
      entries.delete(id);
      return entry.secret;
    },
  };
}
