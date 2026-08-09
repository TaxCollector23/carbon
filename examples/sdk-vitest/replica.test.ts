/**
 * Vitest example — boot a Carbon replica once per suite, share it across
 * tests, tear it down in `afterAll`. Each test resets state so cases don't
 * bleed into each other.
 *
 * Run with: `pnpm --filter @carbon/example-sdk-vitest test`
 */
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { carbon, type Replica } from '@carbon/sdk';

const specPath = fileURLToPath(
  new URL('../../benchmarks/fixtures/petstore.openapi.json', import.meta.url),
);

describe('petstore replica', () => {
  let replica: Replica;

  beforeAll(async () => {
    replica = await carbon.emulate({ from: specPath, port: 0 });
  });

  afterAll(async () => {
    await replica.stop();
  });

  beforeEach(async () => {
    // Reset both the emulated data and the SDK's usage counters between
    // cases so `usage()` assertions are meaningful per-test.
    await replica.state.reset();
  });

  it('serves an empty collection on first GET', async () => {
    const res = await fetch(`${replica.url}/pets`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it('persists writes across requests', async () => {
    const create = await fetch(`${replica.url}/pets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Milo', tag: 'cat' }),
    });
    expect(create.ok).toBe(true);

    const list = await fetch(`${replica.url}/pets`);
    const body = (await list.json()) as Array<{ name: string }>;
    expect(body.length).toBeGreaterThan(0);
    expect(body.some((p) => p.name === 'Milo')).toBe(true);
  });

  it('tracks user-facing requests via usage()', async () => {
    await fetch(`${replica.url}/pets`);
    await fetch(`${replica.url}/pets`);
    const usage = await replica.usage();
    // Only `/pets` fetches above should be counted — `/__carbon/*` control
    // routes are excluded on purpose.
    expect(usage.requests).toBeGreaterThanOrEqual(2);
  });

  it('exposes a synchronous metrics snapshot', () => {
    const m = replica.metrics();
    expect(m.server).toBe('sdk');
    expect(typeof m.version).toBe('string');
    expect(m.ai.needsReview).toBe(false);
  });
});
