# @carbon/example-sdk-basic

The smallest working example of the Carbon SDK: parse an OpenAPI spec, boot
a stateful replica in-process, hit it with `fetch`, then tear it down.

## Run it

```bash
pnpm install
pnpm --filter @carbon/example-sdk-basic dev
```

You should see the replica boot on a random port, three `fetch` round-trips
against `/pets`, then the SDK's `usage()` counters and `metrics()` summary.

## What to copy

- **Import shape** — `import { carbon } from '@carbon/sdk'` is the only
  entry point you need.
- **`from`** — accepts a string (file path or URL) or a preloaded
  `ParserInput`. This example uses an absolute file path resolved via
  `import.meta.url` so it works from any cwd.
- **`port: 0`** — lets the OS pick a free port. The bound URL is on
  `replica.url`.
- **`replica.stop()`** — always call this in a `finally` so listeners are
  released even when your test throws.

## See also

- [`@carbon/example-sdk-with-ai`](../sdk-with-ai) — same shape, plus
  AI-inferred resources gated by the judge.
- [`@carbon/example-sdk-vitest`](../sdk-vitest) — the SDK inside a Vitest
  suite with setup/teardown.
