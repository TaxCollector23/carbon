#!/usr/bin/env bash
# Deploy the Carbon control-plane API to Fly.io in one shot.
#
# Prereqs (one time):
#   1. Create a Neon Postgres (free) account → copy the pooled connection string (DATABASE_URL)
#   2. Create an Upstash Redis (free) account → copy the REDIS_URL (rediss://...)
#   3. Create a Fly.io account → `fly auth login` or export FLY_API_TOKEN
#   4. Install flyctl:  curl -L https://fly.io/install.sh | sh
#
# Usage:
#   DATABASE_URL='postgres://...' REDIS_URL='rediss://...' ./scripts/deploy-api.sh
#
# Everything else is generated or defaults to sane values. Safe to re-run.

set -euo pipefail

: "${DATABASE_URL:?set DATABASE_URL (Neon pooled connection string)}"
: "${REDIS_URL:?set REDIS_URL (Upstash rediss:// URL)}"

APP=carbon-api
WEB_ORIGIN="${WEB_ORIGIN:-https://carbon-web-psi.vercel.app}"
BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-$(openssl rand -hex 32)}"

echo "→ setting secrets on ${APP}…"
fly secrets set \
  --app "$APP" \
  DATABASE_URL="$DATABASE_URL" \
  REDIS_URL="$REDIS_URL" \
  ALLOWED_ORIGINS="$WEB_ORIGIN" \
  CARBON_TRUSTED_PROXY_HOPS=1 \
  BETTER_AUTH_SECRET="$BETTER_AUTH_SECRET" \
  CARBON_PUBLIC_DOCS=false \
  >/dev/null

echo "→ deploying (remote build, no local Docker needed)…"
fly deploy --config apps/api/fly.toml --remote-only

echo "→ done. Public endpoints:"
echo "   GET  https://${APP}.fly.dev/health"
echo "   GET  https://${APP}.fly.dev/v1/benchmark"
echo "   POST https://${APP}.fly.dev/v1/sandbox"
echo "   POST https://${APP}.fly.dev/v1/track"
echo ""
echo "Next: set NEXT_PUBLIC_CARBON_API_URL=https://${APP}.fly.dev on the Vercel web deploy."
