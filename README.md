# Carbon

**Stateful API replicas for development, tests, and CI.**

[![npm](https://img.shields.io/npm/v/carbon-api.svg)](https://www.npmjs.com/package/carbon-api)
[![node](https://img.shields.io/node/v/carbon-api.svg)](https://www.npmjs.com/package/carbon-api)
[![license](https://img.shields.io/badge/license-Proprietary-blue.svg)](./LICENSE)

Carbon turns OpenAPI specs, HAR captures, Postman collections, protobuf, gRPC, GraphQL, and AsyncAPI definitions into a stateful emulator: import a description of an API, compile it into a behavior graph, and serve it as a local replica that mutates state the way the real service would. It is built for backend and full-stack teams that want deterministic integration tests without hitting third-party providers or maintaining a shared staging environment.

## Install

```bash
npm install -g carbon-api
```

Or run without installing:

```bash
npx carbon-api <command>
```

## Quick start

```bash
carbon init                          # scaffold carbon.config.ts
carbon ingest ./openapi.yaml         # parse a spec into Carbon's IR
carbon emulate --from ./openapi.yaml # boot the replica on :8787
carbon inspect                       # view endpoints, resources, and relationships
```

Capture a real API instead of importing a spec:

```bash
carbon record https://api.example.com
```

Snapshot and restore replica state for reproducible test runs:

```bash
carbon snapshot save baseline
carbon snapshot load baseline
```

## Why Carbon

- **Stateful.** `POST /users` creates a resource that later `GET /users/:id` calls return. Carbon infers relationships between endpoints so the replica behaves like the real service, not a static fixture.
- **Snapshottable.** Serialize the replica's entire state, check it into your repo, and restore it in one call — every CI run starts from the same baseline.
- **Multi-format.** OpenAPI, AsyncAPI, GraphQL, protobuf, gRPC, HAR, and Postman collections all normalize to a single intermediate representation, so one runtime serves them all.

## How it works

Carbon runs a three-stage pipeline. The **parser** normalizes each supported format into a shared IR of endpoints, resources, and relationships. The **compiler** turns that IR into a behavior graph — a state machine describing how requests read and mutate resources. The **runtime** serves the graph over HTTP, backed by an in-memory resource store with snapshot, restore, and inspection endpoints under `/__carbon/*`.

## Documentation

- Guides and reference: <https://github.com/TaxCollector23/carbon#readme>
- API reference: `/docs` on the deployed API service
- CLI reference: `carbon --help`

## Deployment

Carbon runs locally as a CLI, and the hosted control plane (API + web dashboard) can be self-deployed on Vercel + Neon + Upstash. See [`DEPLOY.md`](./DEPLOY.md).

## Contributing

Carbon is a pnpm + Turborepo monorepo.

```bash
pnpm install
pnpm dev
```

- `apps/` — `cli` (the `carbon-api` package), `api` (Fastify control plane), `web` (Next.js marketing site), `dashboard` (Next.js app), `docs` (Mintlify).
- `packages/` — `parser`, `ingestion`, `graph`, `runtime`, `state`, `storage`, `proxy`, `sdk`, `ai`, `workers`, `database`, `types`, `core`, `shared`, `ui`, `config`.

Issues and pull requests: <https://github.com/TaxCollector23/carbon>.

## License

Proprietary — © Carbon, Inc. See [`LICENSE`](./LICENSE).
