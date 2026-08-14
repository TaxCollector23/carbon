# Carbon benchmarks

Honest, reproducible measurements of the Carbon runtime, state engine, and
CLI. Every number this directory prints comes from an actual run — no
fixtures, no numbers hand-picked to look good on a landing page.

## What we measure and why

| Script                                                                 | Measures                                                                                                                                                | Why it's the honest metric                                                          |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [`scripts/stateful-consistency.ts`](./scripts/stateful-consistency.ts) | CREATE -> READ -> PATCH -> READ -> DELETE -> 404 over real HTTP                                                                                         | The thing no static mock can do. Prints an assertion + response for every step.     |
| [`scripts/cold-start.ts`](./scripts/cold-start.ts)                     | Spec-to-first-2xx cold start, spawning the actual CLI as a child process, median of 10 runs                                                             | This is what a user feels when they run `carbon-api emulate --from spec.json`.      |
| [`scripts/throughput.ts`](./scripts/throughput.ts)                     | Requests per second and latency histogram over a real TCP socket with [`autocannon`](https://github.com/mcollina/autocannon) at 100 connections for 30s | In-process `fastify.inject` skips kernel + socket cost; TCP loopback is honest.     |
| [`scripts/snapshot-restore.ts`](./scripts/snapshot-restore.ts)         | Snapshot-restore latency for 10,000 rows across 5 resources, 20 iterations                                                                              | Bench isolates the state engine, including disk read + JSON parse.                  |
| [`scripts/memory.ts`](./scripts/memory.ts)                             | RSS delta after inserting 1,000 seeded rows over HTTP, `--max-old-space-size=512`                                                                       | RSS is what your Docker container gets billed for, not `heapUsed`.                  |
| [`../benchmarks/runtime-baseline.ts`](./runtime-baseline.ts)           | In-process `fastify.inject` micro-timings                                                                                                               | Kept as an internal regression signal; **do not** compare it to competitor numbers. |

## What we do NOT measure

- **Wide-area / cloud latency.** Everything runs on `127.0.0.1`. Cross-region
  behavior is not this repo's concern.
- **Competitor tools.** Comparisons against WireMock / Prism / Mockoon /
  MockServer belong in each tool's own harness with matching hardware.
  See "Competitor comparison" below for setup notes.
- **Warm-JIT peak throughput.** `runtime-baseline.ts` is close, but we
  intentionally do not report a "peak" number — the throughput script's 30s
  window is deliberately a mix of warm + steady state.
- **AI calls, upstream network calls, or plugin overhead.** The bench IR has
  none of those on purpose.

## Reproduction

Prereqs: Node >= 20.11, pnpm 11.

```bash
# From repo root
pnpm install
pnpm --filter carbon-api build   # needed for cold-start.ts
pnpm bench                       # or: pnpm --filter @carbon/benchmarks bench:all
```

Individual scripts:

```bash
pnpm --filter @carbon/benchmarks bench:stateful
pnpm --filter @carbon/benchmarks bench:snapshot
pnpm --filter @carbon/benchmarks bench:throughput
pnpm --filter @carbon/benchmarks bench:memory
pnpm --filter @carbon/benchmarks bench:cold-start
```

Every script writes structured JSON to stdout. `bench:all` additionally
writes a combined `benchmarks/results/latest.json`.

## Hardware / environment

All numbers should be reported alongside:

- CPU model, core count, base clock
- Total RAM
- OS + kernel version
- Node.js version (printed by every script)
- Whether the machine was on AC or battery, laptop lid open/closed

Publish those with the numbers or the numbers are not useful.

## Determinism knobs

- `snapshot-restore.ts` and `memory.ts` seed a mulberry32 PRNG
  (`SEED = 0xc0ffee` / `0xdecafbad`). Same seed, same payload, every run.
- `throughput.ts` binds to an OS-assigned port; `CARBON_BENCH_DURATION` and
  `CARBON_BENCH_CONNECTIONS` env vars override defaults (30s, 100).
- `cold-start.ts` runs 10 iterations by default; override with
  `CARBON_BENCH_RUNS` and `CARBON_BENCH_START_TIMEOUT_MS`.
- `memory.ts` should be run under a bounded heap; the wired-up script uses
  `--max-old-space-size=512`.

## Known issues

- `bench:cold-start` requires a working `apps/cli/dist/index.cjs`. At the
  time this harness was written the CLI dist referenced
  `apps/cli/dist/lib/worker.js`, which the current `tsup` build does not
  emit — the CLI crashes with `MODULE_NOT_FOUND`. Once that CLI packaging
  issue is fixed, `bench:cold-start` will produce numbers with no changes
  to the harness. `bench:all` marks cold-start as non-required for exactly
  this reason.

## Competitor comparison (not run here)

To compare cold start honestly against another tool, run each tool's own
"serve this OpenAPI file" command as a child process and time to first
`GET /` 2xx. The fixture in
[`fixtures/petstore.openapi.json`](./fixtures/petstore.openapi.json) is
minimal enough for any competent OpenAPI mocker to load.

- **WireMock:** `java -jar wiremock-standalone.jar --port <p>` (Java startup
  cost dominates cold-start numbers — that's a real observation, not spin).
- **Prism:** `npx @stoplight/prism-cli mock fixtures/petstore.openapi.json --port <p>`.
- **Mockoon CLI:** `mockoon-cli start --data fixtures/petstore.openapi.json --port <p>`.
- **MockServer:** `java -jar mockserver-netty-jar-with-dependencies.jar -serverPort <p>`.

Each of the above requires installation the user must do themselves. We do
not ship those binaries in this repo, and we do not want to publish
comparison numbers based on random CI runners.

## Output shape

Every script prints one JSON object to stdout. Fields that appear in more
than one script:

- `tool`: always `"carbon"`
- `demo`: name of this bench
- `generatedAt`: ISO timestamp
- `node`: Node.js version reported by `process.version`
- `samples` / `runs`: raw per-iteration numbers, in order
- Percentiles named `p50`, `p95`; min/max spelled `min`, `max`
