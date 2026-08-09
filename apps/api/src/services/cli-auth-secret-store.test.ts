import { describe, expect, it, vi } from 'vitest';
import { NoopLogger } from '@carbon/core';
import type { Redis } from 'ioredis';
import { createSecretStore } from './cli-auth-secret-store.js';

/**
 * Two shapes to verify: the in-memory fallback (used when Redis is absent),
 * and the Redis-backed path. We stub Redis with just the four commands the
 * store actually calls (`set`, `multi().get().del().exec()`) so the test
 * doesn't depend on `ioredis-mock`.
 */

describe('cli-auth secret store', () => {
  describe('in-memory fallback', () => {
    it('put then take returns the secret exactly once', async () => {
      const store = createSecretStore({ logger: NoopLogger });
      await store.put('sess_1', 'ck_live_aaaaaaaaaaaa.secret');
      expect(await store.take('sess_1')).toBe('ck_live_aaaaaaaaaaaa.secret');
      // Second take: consumed.
      expect(await store.take('sess_1')).toBeNull();
    });

    it('returns null for unknown ids', async () => {
      const store = createSecretStore({ logger: NoopLogger });
      expect(await store.take('nope')).toBeNull();
    });

    it('auto-expires after the configured ttl', async () => {
      vi.useFakeTimers();
      try {
        const store = createSecretStore({ logger: NoopLogger, ttlSec: 1 });
        await store.put('sess_2', 'value');
        vi.advanceTimersByTime(1500);
        expect(await store.take('sess_2')).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('put with the same id overwrites and resets the ttl', async () => {
      vi.useFakeTimers();
      try {
        const store = createSecretStore({ logger: NoopLogger, ttlSec: 5 });
        await store.put('sess_3', 'first');
        vi.advanceTimersByTime(4000);
        await store.put('sess_3', 'second');
        // The original timer would have fired at t=5000 (1000ms from now);
        // the fresh timer runs 5000ms from the second put. Advance past the
        // first, but not the second, to verify the fresh timer replaced it.
        vi.advanceTimersByTime(2000);
        expect(await store.take('sess_3')).toBe('second');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('redis-backed', () => {
    /** Minimal ioredis stub covering only what the store actually calls. */
    function makeRedisStub(): {
      redis: Redis;
      store: Map<string, string>;
      calls: { set: Array<[string, string, string, number, string]>; multi: number };
    } {
      const map = new Map<string, string>();
      const calls = { set: [] as Array<[string, string, string, number, string]>, multi: 0 };
      const redis = {
        async set(key: string, value: string, exFlag: string, ttl: number, nxFlag: string) {
          calls.set.push([key, value, exFlag, ttl, nxFlag]);
          if (nxFlag === 'NX' && map.has(key)) return null;
          map.set(key, value);
          return 'OK';
        },
        multi() {
          calls.multi += 1;
          let pendingKey: string | null = null;
          const chain = {
            get(key: string) {
              pendingKey = key;
              return chain;
            },
            del(_key: string) {
              return chain;
            },
            async exec(): Promise<Array<[Error | null, unknown]>> {
              const value = pendingKey !== null ? map.get(pendingKey) ?? null : null;
              if (pendingKey !== null) map.delete(pendingKey);
              return [
                [null, value],
                [null, value ? 1 : 0],
              ];
            },
          };
          return chain;
        },
      } as unknown as Redis;
      return { redis, store: map, calls };
    }

    it('put SETs with EX + NX and take GETs+DELs atomically', async () => {
      const { redis, store, calls } = makeRedisStub();
      const secretStore = createSecretStore({ redis, logger: NoopLogger, ttlSec: 60 });

      await secretStore.put('sess_r', 'ck_live_bbbbbbbbbbbb.top-secret');
      expect(calls.set[0]).toEqual([
        'carbon:cli-auth-secret:sess_r',
        'ck_live_bbbbbbbbbbbb.top-secret',
        'EX',
        60,
        'NX',
      ]);
      expect(store.get('carbon:cli-auth-secret:sess_r')).toBe('ck_live_bbbbbbbbbbbb.top-secret');

      const first = await secretStore.take('sess_r');
      expect(first).toBe('ck_live_bbbbbbbbbbbb.top-secret');
      expect(store.has('carbon:cli-auth-secret:sess_r')).toBe(false);

      // Second take after DEL: nothing left.
      const second = await secretStore.take('sess_r');
      expect(second).toBeNull();
    });

    it('take returns null when the redis MULTI blows up (fail-open)', async () => {
      const explodingRedis = {
        multi() {
          return {
            get() {
              return this;
            },
            del() {
              return this;
            },
            async exec() {
              throw new Error('connection lost');
            },
          };
        },
        async set() {
          return 'OK';
        },
      } as unknown as Redis;
      const store = createSecretStore({ redis: explodingRedis, logger: NoopLogger });
      expect(await store.take('sess_x')).toBeNull();
    });
  });
});
