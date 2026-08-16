#!/usr/bin/env sh
# Smoke-check a deployed Carbon API. Verifies liveness, readiness, and — most
# importantly — that the versioned public surface actually serves. A stale
# deploy (or one that only ships the probe routes) 404s everything here.
#
#   scripts/smoke-api.sh                     # https://carbon-api.fly.dev
#   scripts/smoke-api.sh https://localhost:4000
set -eu

BASE="${1:-https://carbon-api.fly.dev}"
fail=0

check_status() {
  path="$1"
  want="${2:-200}"
  code="$(curl -s -o /dev/null -w '%{http_code}' "$BASE$path")"
  if [ "$code" != "$want" ]; then
    echo "FAIL  $path  (got $code, want $want)" >&2
    fail=1
  else
    echo "OK    $path  ($code)"
  fi
}

check_json() {
  path="$1"
  key="$2"
  body="$(curl -s "$BASE$path")"
  if ! printf '%s' "$body" | python3 -c "import sys, json; json.load(sys.stdin)['$key']" >/dev/null 2>&1; then
    echo "FAIL  $path  (missing '$key'; body: $(printf '%s' "$body" | head -c 200))" >&2
    fail=1
  else
    echo "OK    $path  (has '$key')"
  fi
}

echo "Smoke-checking $BASE"
check_status /health
check_status /ready
check_status /v1/version
check_status /v1/capabilities
check_json /v1/capabilities service
check_json /v1/capabilities apiVersion
check_json /v1/version gitSha

if [ "$fail" -ne 0 ]; then
  echo "smoke check FAILED" >&2
  exit 1
fi
echo "smoke check passed"
