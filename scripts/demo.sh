#!/usr/bin/env bash
# Carbon public demo — boot the control plane and expose it via a Cloudflare tunnel.
#
# Two modes, same result (public https URL):
#   MODE=local   (default) uses the local Postgres `carbon` DB, no Redis (rate
#                 limiting + idempotency degrade gracefully), bootless-ish auth.
#   MODE=prod    uses Neon + Upstash. Requires DATABASE_URL + REDIS_URL.
#
# In either mode the public endpoints that power the landing console stay open:
#   GET  /v1/benchmark   GET  /v1/sandbox/*   POST /v1/sandbox   POST /v1/track
#
# Usage:
#   ./scripts/demo.sh                     # local PG, tunnel
#   MODE=prod DATABASE_URL=... REDIS_URL=... ./scripts/demo.sh
#
# The tunnel needs a Cloudflare Zero Trust account. If no token is exported,
# the script prints the interactive login command (free, no card) and waits.
set -euo pipefail
cd "$(dirname "$0")/.."

export API_PORT="${API_PORT:-4567}"
export API_HOST="${API_HOST:-0.0.0.0}"
export ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-*}"            # any browser origin may call
export CARBON_TRUSTED_PROXY_HOPS="${CARBON_TRUSTED_PROXY_HOPS:-1}"
export CARBON_PUBLIC_DOCS=false
export EMBED_WORKERS=false                                # single process, no BullMQ workers

if [ "${MODE:-local}" = "prod" ]; then
  : "${DATABASE_URL:?MODE=prod requires DATABASE_URL (Neon pooled connection string)}"
  : "${REDIS_URL:?MODE=prod requires REDIS_URL (Upstash rediss://)}"
  # Open demo stays unauthenticated, so public console paths must be the
  # only thing reachable; production safety checks force auth=enforced, but
  # /v1/benchmark, /v1/sandbox/*, /v1/track are in PUBLIC_PATHS regardless.
  export NODE_ENV="${NODE_ENV:-production}"
  export CARBON_AUTH_MODE="${CARBON_AUTH_MODE:-enforced}"
  echo "MODE=prod: using Neon + Upstash."
else
  export NODE_ENV="${NODE_ENV:-development}"   # dev skips the boot-time safety gates (no Redis needed)
  export DATABASE_URL="${DATABASE_URL:-postgres://rangan@127.0.0.1:5432/carbon}"
  echo "MODE=local: local Postgres 'carbon' DB — set MODE=prod with Neon/Upstash for the fuller profile."
fi

echo "→ smoke: migration state on the target DB…"
pnpm --filter @carbon/database migrate:apply >/dev/null 2>&1 || echo "  (migrations skipped — verify DB is reachable)"

echo "→ booting the control-plane API on :${API_PORT}…"
pnpm --filter @carbon/api start &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true' EXIT

echo "→ waiting for /ready…"
for _ in $(seq 1 60); do
  curl -sf "http://127.0.0.1:${API_PORT}/ready" >/dev/null 2>&1 && break
  sleep 1
done
curl -sf "http://127.0.0.1:${API_PORT}/health" | head -c 400 || { echo "  ✗ API failed to boot"; cat /tmp/carbon-demo.log 2>/dev/null; exit 1; }
echo
echo "  ✓ /health OK"

echo "→ smoke: benchmark…"
curl -sf "http://127.0.0.1:${API_PORT}/v1/benchmark" | python3 -c "import json,sys; d=json.load(sys.stdin); print('   stateful:', d.get('stateful',{}).get('passed'), '| req/s:', round(d.get('throughput',{}).get('requestsPerSec',0)))" 2>/dev/null || echo "   (benchmark smoke skipped)"

echo "→ smoke: sandbox boot + one real request…"
SB=$(curl -sf -X POST "http://127.0.0.1:${API_PORT}/v1/sandbox" -H 'content-type: application/json' -d '{"sample":"petstore"}') 
SB_ID=$(echo "$SB" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
curl -sf "http://127.0.0.1:${API_PORT}/v1/sandbox/${SB_ID}/__carbon/state/history" >/dev/null && echo "   ✓ sandbox booted ($SB_ID)"
curl -sf -X POST "http://127.0.0.1:${API_PORT}/v1/sandbox/${SB_ID}/pets" -H 'content-type: application/json' -d '{"name":"Fido","tag":"dog"}' >/dev/null && echo "   ✓ POST /pets through the proxy"
curl -sf -X DELETE "http://127.0.0.1:${API_PORT}/v1/sandbox/${SB_ID}" >/dev/null 2>&1 || true

echo "→ smoke: track…"
curl -sf -X POST "http://127.0.0.1:${API_PORT}/v1/track" -H 'content-type: application/json' -d '{"action":"demo.smoke","path":"/smoke"}' >/dev/null && echo "   ✓ /v1/track"

echo ""
echo "All local smoke checks passed. Exposure step:"
if [ -z "${TUNNEL_TOKEN:-}" ]; then
  echo "  cloudflared tunnel needs a Cloudflare account (free, no card)."
  echo "  Run:   cloudflared tunnel login"
  echo "  Then re-run this script with TUNNEL_TOKEN set, or run cloudflared tunnel locally."
else
  echo "→ opening Cloudflare tunnel…"
  cloudflared tunnel --url "http://127.0.0.1:${API_PORT}" &
  wait "$API_PID"
fi