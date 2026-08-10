#!/usr/bin/env bash
# Import the Carbon Grafana dashboards into a running Grafana instance.
#
# Usage:
#   GRAFANA_TOKEN=<api-key> scripts/observability/import-grafana.sh <grafana-host>
#
# Example:
#   GRAFANA_TOKEN=eyJrIjoi... scripts/observability/import-grafana.sh \
#     https://grafana.internal.example.com
#
# Requires: bash 4+, curl, jq (jq only used to wrap the dashboard payload).
set -euo pipefail

HOST="${1:-}"
if [[ -z "$HOST" ]]; then
  echo "usage: GRAFANA_TOKEN=<token> $0 <grafana-host>" >&2
  exit 2
fi
if [[ -z "${GRAFANA_TOKEN:-}" ]]; then
  echo "error: GRAFANA_TOKEN env var is required" >&2
  exit 2
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required (brew install jq)" >&2
  exit 2
fi

HOST="${HOST%/}"
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
DASH_DIR="$HERE/deploy/observability/grafana"

import_one() {
  local file="$1"
  local name
  name="$(basename "$file")"
  echo "→ importing $name"
  # Grafana's /api/dashboards/db expects {"dashboard": <json>, "overwrite": true}.
  local payload
  payload="$(jq -n --slurpfile d "$file" '{dashboard: $d[0], overwrite: true, folderId: 0}')"
  curl -fSs \
    -X POST "$HOST/api/dashboards/db" \
    -H "Authorization: Bearer $GRAFANA_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$payload" \
    | jq -r '"  imported uid=\(.uid) url=\(.url)"'
}

import_one "$DASH_DIR/carbon-api-overview.json"
import_one "$DASH_DIR/carbon-tracing.json"

echo "done."
