# @carbon/vitest

Ergonomic [vitest](https://vitest.dev) integration for [Carbon](https://github.com/TaxCollector23/carbon) — boot a scoped Carbon emulator per test (or per file) from your OpenAPI/GraphQL spec.

## Install

```bash
pnpm add -D @carbon/vitest @carbon/sdk vitest
```

## `carbonTest` — one emulator per test

```ts
import { carbonTest } from '@carbon/vitest';

carbonTest(
  'lists pets',
  async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/pets`);
    expect(res.status).toBe(200);
  },
  { spec: './openapi.yaml' },
);
```

## `withCarbon` — shared emulator per file

```ts
import { beforeAll, afterAll, it, expect } from 'vitest';
import { withCarbon, type CarbonHandle } from '@carbon/vitest';

let carbon: CarbonHandle;

beforeAll(async () => {
  carbon = await withCarbon({ spec: './openapi.yaml' });
});
afterAll(() => carbon.stop());

it('serves the API', async () => {
  const res = await fetch(`${carbon.baseUrl}/pets`);
  expect(res.ok).toBe(true);
});
```

## `snapshot` / `rewind` between tests

```ts
it('rewinds state', async () => {
  const before = await carbon.snapshot();
  await fetch(`${carbon.baseUrl}/pets`, {
    method: 'POST',
    body: JSON.stringify({ id: 'p1', name: 'Fido' }),
  });
  await carbon.rewind(before); // pet is gone
});
```

## Options

`{ spec, port?, seed?, env?, ready? }` — `spec` accepts a file path, URL, raw JSON/YAML text, `Buffer`, or a pre-shaped `ParserInput`. `port` auto-picks a free port when omitted. SIGINT/SIGTERM cleanup is wired automatically.
