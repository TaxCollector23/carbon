# Carbon

**Build and test API integrations without depending on shared staging or live third-party APIs.**

Carbon creates stateful replicas of the APIs your product depends on. It can ingest specs,
recorded traffic, and service definitions, then run the API behavior on your machine for
development, tests, and CI.

After import, the runtime serves requests from the compiled graph and state engine.

## Repository

This is a TurboRepo monorepo managed with pnpm.

```
apps/
  web         Marketing website (Next.js)
  dashboard   Product dashboard (Next.js + Better Auth)
  docs        Mintlify documentation site
  cli         Carbon CLI (`carbon`, published as `carbon-api`)
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
