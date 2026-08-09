#!/usr/bin/env bash
# One-shot setup for the API integration suite when running locally against
# a shared Postgres. Mirrors apps/e2e/scripts/setup.sh but points at a
# stable database name rather than a per-run disposable one, so a dev can
# poke around after a failure:
#
#   CARBON_INTEGRATION_DB=carbon_int_local bash apps/api/scripts/integration-setup.sh
#
# The vitest suite itself creates a fresh disposable DB per test file via
# `vitest.setup-integration.ts` — this script is only for the "seed one
# stable DB I can psql into" workflow.
set -euo pipefail

: "${CARBON_INTEGRATION_DB:=carbon_int_local}"
PGUSER="${PGUSER:-${USER:-postgres}}"
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGADMIN_DB="${INTEGRATION_PG_ADMIN_DB:-postgres}"

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
INTEGRATION_URL="postgresql://${PGUSER}@${PGHOST}:${PGPORT}/${CARBON_INTEGRATION_DB}"

echo "integration-setup: ensuring database $CARBON_INTEGRATION_DB on $PGHOST:$PGPORT"
EXISTS=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGADMIN_DB" -tAc \
  "SELECT 1 FROM pg_database WHERE datname='$CARBON_INTEGRATION_DB'" || true)
if [ "$EXISTS" != "1" ]; then
  createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$CARBON_INTEGRATION_DB"
  echo "integration-setup: created $CARBON_INTEGRATION_DB"
else
  echo "integration-setup: reusing existing $CARBON_INTEGRATION_DB"
fi

echo "integration-setup: applying migrations"
(
  cd "$REPO_ROOT"
  DATABASE_URL="$INTEGRATION_URL" pnpm --filter @carbon/database migrate:apply
)

echo "integration-setup: seeding fixture org (org_test)"
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$CARBON_INTEGRATION_DB" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO organizations (id, slug, name)
VALUES ('org_test', 'integration-test', 'Integration Test Org')
ON CONFLICT (id) DO NOTHING;
SQL

echo "integration-setup: done — INTEGRATION_DATABASE_URL=$INTEGRATION_URL"
