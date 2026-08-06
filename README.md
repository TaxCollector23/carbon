# Carbon

**Develop against production without production.**

Carbon creates intelligent local replicas of the APIs your product depends on. It records real
traffic, learns behavior, and emulates the API on your machine — so you can build offline, avoid
flaky staging, dodge rate limits, and iterate faster.

Existing mocks are static. Carbon is behavioral.

## Repository

This is a TurboRepo monorepo managed with pnpm.

```
apps/
  web         Marketing website (Next.js)
  dashboard   Product dashboard (Next.js + Better Auth)
  docs        Mintlify documentation site
  cli         Carbon CLI (`carbon`)
  desktop     Desktop app (stub — Phase Two)

packages/
  core            Runtime primitives
  parser          OpenAPI / HAR / traffic parsing
  state-engine    In-memory resource graph
  behavior-engine Behavioral inference
  sdk             TypeScript SDK
  ui              Shared React primitives (shadcn-based)
  config          Shared tsconfig / tailwind / eslint presets
  database        Drizzle schema + client
  shared          Cross-cutting types and utilities
  workers         Background jobs
```

## Getting started

```bash
pnpm install
pnpm dev
```

## License

Proprietary — © Carbon.
