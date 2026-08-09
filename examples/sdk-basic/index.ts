/**
 * Basic SDK example — boot a Carbon replica from an OpenAPI file, exercise
 * a few endpoints via plain `fetch`, print what the replica returned, then
 * shut it down.
 *
 * Run with: `pnpm --filter @carbon/example-sdk-basic dev`
 */
import { fileURLToPath } from 'node:url';
import { carbon } from '@carbon/sdk';

async function main(): Promise<void> {
  // Resolve the fixture relative to this file so the example works regardless
  // of the caller's cwd (pnpm --filter, IDE run buttons, CI, etc.).
  const specPath = fileURLToPath(
    new URL('../../benchmarks/fixtures/petstore.openapi.json', import.meta.url),
  );

  console.log(`[example] booting replica from ${specPath}`);
  const replica = await carbon.emulate({
    from: specPath,
    // Use port 0 so multiple examples can run in parallel without collisions.
    port: 0,
  });
  console.log(`[example] replica listening at ${replica.url}`);

  try {
    // 1. GET the (empty) collection.
    const initialList = await getJson(`${replica.url}/pets`);
    console.log('[example] GET /pets (initial) →', initialList);

    // 2. POST a new pet.
    const created = await postJson(`${replica.url}/pets`, {
      name: 'Milo',
      tag: 'cat',
    });
    console.log('[example] POST /pets → created', created);

    // 3. GET the collection again — the pet we just created should be there
    //    because Carbon is stateful (this isn't canned mock JSON).
    const listAfter = await getJson(`${replica.url}/pets`);
    console.log('[example] GET /pets (after create) →', listAfter);

    // 4. Peek at the SDK-level counters and metrics.
    const usage = await replica.usage();
    const metrics = replica.metrics();
    console.log('[example] usage:', usage);
    console.log('[example] metrics:', metrics);
  } finally {
    await replica.stop();
    console.log('[example] replica stopped.');
  }
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  return decode(res);
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return decode(res);
}

async function decode(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return { status: res.status };
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
}

main().catch((err) => {
  console.error('[example] failed:', err);
  process.exit(1);
});
