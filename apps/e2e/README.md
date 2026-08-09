# @carbon/e2e

End-to-end tests for the Carbon dashboard, driven by [Playwright](https://playwright.dev)
against the real API server and a real Postgres database.

## What runs

`playwright.config.ts` boots two dev servers as `webServer` entries:

- `pnpm --filter @carbon/api dev` on `:4000`
- `pnpm --filter @carbon/dashboard dev` on `:3001`

`scripts/global-setup.ts` shells out to `scripts/setup.sh`, which:

1. Creates a fresh Postgres database (`carbon_e2e_<epoch>` by default).
2. Runs Drizzle migrations via `pnpm --filter @carbon/database migrate:apply`.
3. Seeds the `org_test` organization the tests reference.

`scripts/global-teardown.ts` drops the DB at the end of the run (unless
`CARBON_E2E_KEEP_DB=1` is set for debugging).

## Prerequisites

- Postgres 16 running locally with a role that can `CREATEDB`.
  Default: `postgresql://$USER@localhost:5432`.
- Node 20+, pnpm 11+ (repo `packageManager`).
- Playwright browsers installed once:

  ```bash
  pnpm --filter @carbon/e2e exec playwright install --with-deps chromium
  ```

## Running

```bash
# From repo root:
pnpm --filter @carbon/e2e test           # headless
pnpm --filter @carbon/e2e test:ui        # Playwright UI mode
pnpm --filter @carbon/e2e test:headed    # headed browser
```

## Configuration knobs

| Env var                      | Purpose                                                        |
| ---------------------------- | -------------------------------------------------------------- |
| `CARBON_E2E_DB`              | DB name to create/reuse. Random per-run when unset.            |
| `CARBON_E2E_DATABASE_URL`    | Full override for the DB URL. Skips dropdb in teardown.        |
| `CARBON_E2E_PG_USER/HOST/PORT` | Individual pg connection overrides.                         |
| `CARBON_E2E_KEEP_DB=1`       | Skip teardown so the DB can be inspected after the run.        |

## Test suites

- `homepage.spec.ts` — overview page renders; health pill is optional.
- `projects.spec.ts` — create a project via the modal, see it in the list.
- `activity.spec.ts` — timeline or empty state; also seeds a project via
  the API and reloads to verify an event landed.
- `keys.spec.ts` — create an API key, see the one-time secret modal.
- `snapshots.spec.ts` — per-project snapshots page; select-a-project empty
  state, plus post-seed empty/table render.
- `emulators.spec.ts` — polling indicator, chaos + load-test modal opens
  (when a row is present), input clamps on the load-test form.
- `chaos-presets.spec.ts` — opens the New preset modal, submits valid JSON
  rules, and expects the new row.
- `ai-quality.spec.ts` — project picker + latest report card or empty
  state.
- `usage.spec.ts` — aggregate chart or empty state, kind filter dropdown
  round-trip.
- `settings.spec.ts` — resolves org via the OrgIdPrompt fallback, saves a
  Slack webhook, reloads and confirms it persisted.
- `cli-auth.spec.ts` — POSTs `/v1/cli-auth/start`, opens the returned
  session URL, accepts either the approval UI or a `/sign-in` redirect.
- `api-endpoints.spec.ts` — direct HTTP probes at `/health`, `/ready`,
  `/v1/version`, `/v1/projects`, `/v1/organizations/current`.
- `api-endpoints-extended.spec.ts` — iterates every GET path in
  `/openapi.json`, substitutes fixture params, and asserts no 5xx.
