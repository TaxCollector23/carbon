# Carbon improvement plan

## Audit summary

Carbon is already a substantial pnpm/Turborepo monorepo rather than a prototype. The strongest foundations are the shared parser → IR → behavior graph pipeline, the stateful runtime, snapshot support, an authenticated Fastify control plane, async BullMQ ingestion, structured observability, and a CLI with JSON output, doctor checks, watch mode, recording, replay, and test generation.

The main product gap is not raw capability; it is the first five minutes. A new developer currently has to understand several apps, choose between local and hosted flows, and often sign in before seeing the core stateful behavior. The CLI also has many powerful commands but no single, memorable “try Carbon now” path. On the backend, public capability discovery and sample metadata should be explicit so web, CLI, SDK, and future integrations do not duplicate deployment assumptions.

## Prioritized roadmap

### Phase 1 — activation and trust (implemented in this slice)

- Add a public `/try` playground that runs a deterministic, stateful Petstore-style API entirely in the browser. It must demonstrate `POST → GET → DELETE`, show request/response history, and require no account, API key, or backend dependency.
- Add `carbon try` as the shortest CLI path to the same playground, with an optional browser launch and a sample deep link.
- Make remote CLI ingest fail clearly on non-2xx responses and network timeouts instead of trying to parse an error page as a spec.
- Expose a public, machine-readable `/v1/capabilities` contract and public sample metadata so clients can discover supported formats, async support, docs, and limits without credentials.
- Link the playground from the primary navigation, hero, footer, and CLI documentation surface.

### Phase 2 — backend reliability and scale

- [x] Publish a stable API version header (`x-carbon-api-version: v1`) and machine-readable capabilities contract.
- [x] Add a credential-free `carbon capabilities` discovery command for control-plane tooling.
- Add contract tests generated from the OpenAPI document for every public SDK/CLI operation; run them against both an in-memory test server and Postgres/Redis integration services.
- Move long-lived emulator processes behind a worker/child-process boundary with resource quotas, idle eviction, and per-emulator memory/CPU telemetry.
- Make ingestion jobs resumable by stage with content-addressed source artifacts, deduplication keys, and explicit cancellation. Preserve parser warnings and partial results in the job record.
- Add API version negotiation and deprecation headers, then generate the TypeScript and Python clients from the same committed schema in CI.
- Add abuse controls for anonymous/demo surfaces: per-IP quotas, bounded payloads, no arbitrary upstream fetching, and retention policies.

### Phase 3 — CLI that becomes the default workflow

- Add a first-class local project lifecycle: `carbon init`, `carbon ingest`, `carbon emulate`, `carbon test`, `carbon snapshot`, and `carbon ci` with consistent exit codes and JSON events.
- [x] Make `carbon ingest` optionally persist to the control plane and print stable artifact/job IDs with `--project`, `--async`, `--wait`, and `--timeout`.
- [x] Expand shell completion coverage to the complete command catalog.
- [x] Add `carbon diff` for normalized spec drift and `carbon explain` for why an endpoint mutates a resource or returns a generated response.
- Publish signed binaries or a reproducible installer alongside npm, with checksum verification and an offline cache for catalog specs.

### Phase 4 — hosted product and developer ecosystem

- Turn the sample catalog into versioned, health-checked fixtures with generated endpoint examples and an embeddable read-only experience.
- Add a browser request builder backed by short-lived sandbox emulators for users who want real HTTP, while keeping the no-auth local playground as the fast path.
- Add usage-based quotas, workspace audit exports, environment promotion, and webhook delivery guarantees on top of the existing control-plane primitives.
- Add first-party GitHub Action and VS Code workflows that run the same graph locally and in CI.
- Add performance budgets for parse, compile, request latency, snapshot restore, queue wait, and browser activation; publish regressions automatically.

## Progress after the first implementation slice

The activation slice and the first two workflow/reliability items are implemented. The remaining roadmap is intentionally staged: contract-test generation, emulator isolation, resumable ingestion, drift tooling, signed distributions, and real hosted sandboxes require separate infrastructure and release work rather than being hidden behind the demo page.

## Definition of done for the current slice

- A visitor can open `/try`, run a stateful request sequence, reset it, and understand the value without credentials.
- `carbon try --sample petstore --open` opens that experience and remains scriptable with `--json`.
- Remote ingest reports HTTP status, response body context, and timeout guidance.
- `/v1/capabilities` and `/v1/samples` can be consumed by unauthenticated discovery clients while sample instantiation remains protected.
- Typecheck, focused tests, formatting, and the web production build pass before deployment.

## Deployment note

The repository has two separate deployment paths: the web app is configured for Vercel, while the Fastify API and dashboard are long-running Fly.io services. A web-only deploy is safe for this UI slice; API/dashboard deployment remains gated by the configured Fly credentials and CI variable (`CARBON_ENABLE_FLY_DEPLOY`).
