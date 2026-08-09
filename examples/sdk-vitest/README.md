# @carbon/example-sdk-vitest

A minimal Vitest suite that boots one Carbon replica per file, shares it
across tests, resets state between cases, and tears it down in `afterAll`.

## Run it

```bash
pnpm install
pnpm --filter @carbon/example-sdk-vitest test
```

## Pattern

- `beforeAll` — one `carbon.emulate({ port: 0 })`; port 0 lets you run the
  suite in parallel with other replicas.
- `beforeEach` — `replica.state.reset()` so cases don't leak into each
  other. Cheaper than a full re-emulate.
- `afterAll` — `replica.stop()` to release the port.
- Assertions on `replica.usage()` and `replica.metrics()` — the SDK counts
  only user-facing HTTP hits; `/__carbon/*` control routes are excluded so
  your tests can gate on real traffic.

## See also

- `packages/sdk/src/index.ts` — the `Replica` contract this example
  exercises end-to-end.
