# Test Carbon locally in 5 minutes

Everything here runs on your Mac. No Docker required (but nice to have).

## Prereqs

- **Node ≥ 20** (`node --version`).
- **pnpm 11** (`npm i -g pnpm@11`).
- **Postgres 16** — the easy path is `brew install postgresql@16 && brew services start postgresql@16`.

## One-time setup

```bash
cd /Users/rangan/Desktop/carbon
pnpm install
createdb carbon
DATABASE_URL="postgresql://$USER@localhost:5432/carbon" pnpm --filter @carbon/database migrate:apply
# Seed a test org so any dashboard section renders real data:
psql -U $USER -d carbon -c "INSERT INTO organizations (id, slug, name) VALUES ('org_test', 'test-org', 'Test Org') ON CONFLICT DO NOTHING;"
```

## Boot everything in one terminal

```bash
pnpm --filter carbon-dev build          # build the CLI once
export DATABASE_URL="postgresql://$USER@localhost:5432/carbon"
export CARBON_AUTH_MODE=disabled        # disables the API-key plugin so requests without
                                        # `x-carbon-key` aren't rejected. Better Auth session
                                        # cookies still resolve — they just don't gate anything
                                        # in dev because requireScope is permissive when neither
                                        # auth path attached.
node apps/cli/dist/index.cjs serve      # api + dashboard + web + workers
```

`carbon serve` prints tag-prefixed logs from each service. Ctrl+C tears them all down.

## What to open

- **http://localhost:1223** — marketing site
- **http://localhost:3001** — dashboard
- **http://localhost:4000/docs** — Scalar-rendered OpenAPI reference
- **http://localhost:4000/openapi.json** — raw spec (fed into the codegen client)

The dashboard needs to know which org it's on. In the browser console once, run:

```js
localStorage.setItem('carbon.orgId', 'org_test');
location.reload();
```

Now every dashboard section renders real data instead of the "org-scoped" empty state.

## Try the runtime

```bash
# 1. Boot an emulator from the bundled Petstore spec
node apps/cli/dist/index.cjs emulate --from benchmarks/fixtures/petstore.openapi.json --port 5555

# 2. In another terminal — make some state
curl -X POST http://localhost:5555/pets -H 'content-type: application/json' \
  -d '{"name":"Fido","tag":"dog"}'
curl -X POST http://localhost:5555/pets -H 'content-type: application/json' \
  -d '{"name":"Whiskers","tag":"cat"}'

# 3. Verify the emulator REMEMBERS
curl http://localhost:5555/pets

# 4. Rewind the last mutation
curl -X POST http://localhost:5555/__carbon/state/rewind \
  -H 'content-type: application/json' -d '{"seq":1}'
curl http://localhost:5555/pets   # Whiskers is gone
```

## Try the sign-in flow (Better Auth, no Firebase)

```bash
# 1. Sign in — opens the dashboard's /cli-auth/<sessionId> page in your browser
node apps/cli/dist/index.cjs login

# 2. On the browser page, create an account (Better Auth email/password),
#    approve the CLI. Poll picks up the minted key and stores it.

# 3. Confirm
node apps/cli/dist/index.cjs whoami
```

## Ingest via the CLI

```bash
node apps/cli/dist/index.cjs ingest benchmarks/fixtures/petstore.openapi.json
```

## Run the test suites

```bash
pnpm -r typecheck             # every workspace project
pnpm --filter @carbon/api test # 282 tests
pnpm --filter @carbon/ai  test # 19 tests
pnpm --filter @carbon/runtime test # 13 tests, including GraphQL emulator
```

For real Postgres integration tests:

```bash
DATABASE_URL="postgresql://$USER@localhost:5432/carbon" \
  pnpm --filter @carbon/api test:integration
```

## Common issues

| symptom | fix |
|---|---|
| `carbon emulate` hangs on boot | The pre-round-18 build had this — pull master, `pnpm --filter carbon-dev build`. The command now preflights the port and boots with a 20s timeout that surfaces a friendly error. |
| Dashboard says "Failed to fetch" for every section | You booted the API without `ALLOWED_ORIGINS` including `http://localhost:3001`. Restart the API with the env default (env.ts already defaults this in dev). |
| `/v1/events` (or usage/chaos) returns empty | Set `localStorage['carbon.orgId'] = 'org_test'` in the browser and reload. |
| `pnpm install` fails with "ignored builds" | Run `pnpm approve-builds` once. |
| `carbon` reports "no scripts approved" | Same. |

## The whole stack in one diagram

```
apps/cli  ── ck_live_key ─▶  apps/api  ─▶ apps/workers
                                │
                                ├─▶ Postgres  (projects / events / usage / …)
                                ├─▶ Redis     (BullMQ + idempotency, optional)
                                └─▶ Storage   (fs or S3 for IR/snapshots/recordings)

apps/dashboard (Next.js)  ── credentials ─▶ apps/api
apps/web       (Next.js)  ── /v1/leads   ─▶ apps/api
apps/docs      (Mintlify)  reads /openapi.json for Scalar reference

packages/runtime  = the emulator (Fastify + REST + WebSocket state stream + GraphQL shim)
packages/state    = in-memory engine + snapshots + mutation journal
packages/parser   = OpenAPI / GraphQL / HAR / Postman / AsyncAPI / protobuf
packages/graph    = behavior graph builder
packages/sdk      = programmatic carbon.emulate() for tests
packages/ai       = infer resources/relationships + AI judge quality gate
```
