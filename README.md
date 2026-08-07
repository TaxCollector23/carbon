# Carbon

**Build and test API integrations without shared staging or live third-party dependencies.**

Carbon turns specs, recordings, and service definitions into stateful API
replicas. Use those replicas in development, tests, and CI so integration work
is repeatable without calling the upstream provider.

After import, Carbon serves requests from a compiled behavior graph backed by a
state engine.

## Repository

This is a TurboRepo monorepo managed with pnpm.

```
apps/
  web         Website plus Firebase-gated dashboard (Next.js)
  dashboard   Legacy dashboard app, not the primary deploy target
  docs        Mintlify documentation site
  cli         Carbon CLI (`carbon`, published as `carbon-api`)
  desktop     Desktop app (planned for Phase Two)

packages/
  core            Runtime primitives
  parser          OpenAPI / AsyncAPI / Protobuf / gRPC / HAR / Postman / GraphQL parsing
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
