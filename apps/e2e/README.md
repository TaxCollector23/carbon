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
- `activity.spec.ts` — timeline or empty state (both are valid).
- `keys.spec.ts` — create an API key, see the one-time secret modal.
- `api-endpoints.spec.ts` — direct HTTP probes at `/health`, `/ready`,
  `/v1/version`, `/v1/projects`, `/v1/organizations/current`.
