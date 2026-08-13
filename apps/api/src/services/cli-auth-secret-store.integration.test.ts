import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NoopLogger } from '@carbon/core';
import { createRedisConnection } from '@carbon/workers';
import type { Redis } from 'ioredis';
import { createSecretStore } from './cli-auth-secret-store.js';

/**
 * Integration coverage for the Redis-backed CLI-auth secret store.
 *
 * The purpose of this test is to prove the multi-instance property that Round
 * 19 A3 relies on: an approve landing on API instance A must be consumable by
 * a poll served by API instance B. We simulate that by constructing two
 * independent `Redis` clients (each stands in for a separate API replica) and
 * verifying `put` on one is observable by `take` on the other.
 *
 * Skip pattern mirrors the Postgres integration tests: without `REDIS_URL`
 * the suite no-ops so laptops without a local Redis stay green.
 */
function shouldRun(): boolean {
  if (process.env.CARBON_SKIP_INTEGRATION === '1') return false;
  return Boolean(process.env.REDIS_URL);
}

describe.skipIf(!shouldRun())('cli-auth secret store (redis integration)', () => {
  let redisA: Redis;
  let redisB: Redis;

  beforeAll(async () => {
    const url = process.env.REDIS_URL!;
    redisA = createRedisConnection(url);
    redisB = createRedisConnection(url);
    // Ensure both connections are actually up before we exercise them.
    await Promise.all([redisA.ping(), redisB.ping()]);
  });

  afterAll(async () => {
    await Promise.allSettled([redisA?.quit(), redisB?.quit()]);
  });

  it('put on instance A is take-able on instance B (multi-instance)', async () => {
    const storeA = createSecretStore({ redis: redisA, logger: NoopLogger, ttlSec: 30 });
    const storeB = createSecretStore({ redis: redisB, logger: NoopLogger, ttlSec: 30 });

    const id = `it_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const secret = `ck_live_${Math.random().toString(36).slice(2)}.integration`;

    await storeA.put(id, secret);
    // The poll lands on a different replica.
    const revealed = await storeB.take(id);
    expect(revealed).toBe(secret);

    // Redis DEL happened as part of MULTI GET+DEL — a second take from
    // either replica should yield null.
    expect(await storeA.take(id)).toBeNull();
    expect(await storeB.take(id)).toBeNull();
  });

  it('NX put does not clobber an already-stashed secret (concurrent approves)', async () => {
    const storeA = createSecretStore({ redis: redisA, logger: NoopLogger, ttlSec: 30 });
    const storeB = createSecretStore({ redis: redisB, logger: NoopLogger, ttlSec: 30 });

    const id = `it_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await storeA.put(id, 'first');
    // Second, racing approve tries to put again — NX means it's a no-op.
    await storeB.put(id, 'second');

    const revealed = await storeB.take(id);
    expect(revealed).toBe('first');
  });

  it('ttl expires the secret so no cross-instance leakage survives', async () => {
    const storeA = createSecretStore({ redis: redisA, logger: NoopLogger, ttlSec: 1 });
    const storeB = createSecretStore({ redis: redisB, logger: NoopLogger, ttlSec: 1 });

    const id = `it_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await storeA.put(id, 'ephemeral');
    // Wait past the TTL. Redis TTL granularity is seconds; 1500ms is safe.
    await new Promise((r) => setTimeout(r, 1500));
    expect(await storeB.take(id)).toBeNull();
  });
});
