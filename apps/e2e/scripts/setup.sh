#!/usr/bin/env bash
# One-shot setup for the e2e suite. Called from global-setup.ts.
#
# Creates a fresh Postgres database (name from CARBON_E2E_DB), runs the
# Drizzle migrations, and seeds the fixture org. All three steps are
# idempotent enough that re-running against an existing DB is safe.
set -euo pipefail

: "${CARBON_E2E_DB:?CARBON_E2E_DB is required}"
: "${DATABASE_URL:?DATABASE_URL is required}"

PGUSER="${CARBON_E2E_PG_USER:-${USER:-postgres}}"
PGHOST="${CARBON_E2E_PG_HOST:-localhost}"
PGPORT="${CARBON_E2E_PG_PORT:-5432}"
PGADMIN_DB="${CARBON_E2E_PG_ADMIN_DB:-postgres}"

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

echo "e2e-setup: ensuring database $CARBON_E2E_DB on $PGHOST:$PGPORT"
EXISTS=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGADMIN_DB" -tAc \
  "SELECT 1 FROM pg_database WHERE datname='$CARBON_E2E_DB'" || true)
if [ "$EXISTS" != "1" ]; then
  createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$CARBON_E2E_DB"
  echo "e2e-setup: created $CARBON_E2E_DB"
else
  echo "e2e-setup: reusing existing $CARBON_E2E_DB"
fi

echo "e2e-setup: applying migrations"
(
  cd "$REPO_ROOT"
  DATABASE_URL="$DATABASE_URL" pnpm --filter @carbon/database migrate:apply
)

echo "e2e-setup: seeding fixture org"
(
  cd "$REPO_ROOT/apps/e2e"
  DATABASE_URL="$DATABASE_URL" pnpm exec tsx scripts/seed.ts
)

echo "e2e-setup: done"
