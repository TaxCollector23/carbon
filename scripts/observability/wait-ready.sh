#!/usr/bin/env bash
# Poll the local observability stack until every component reports ready.
# Prints a checkmark / cross per endpoint and exits non-zero if anything
# fails to come up within the timeout.
#
# Usage:
#   scripts/observability/wait-ready.sh           # default 60s timeout
#   TIMEOUT=120 scripts/observability/wait-ready.sh
set -u

TIMEOUT="${TIMEOUT:-60}"
INTERVAL=2

# name|url|expected-substring-in-body-or-empty-for-2xx-only
CHECKS=(
  "prometheus|http://localhost:9090/-/ready|"
  "grafana|http://localhost:3002/api/health|"
  "tempo|http://localhost:3200/ready|"
  "alertmanager|http://localhost:9093/-/ready|"
)

OK="✔"     # ✔
BAD="✖"    # ✖

check_one() {
  local url="$1"
  # -f fails on 4xx/5xx; -sS silent w/ error; --max-time keeps hangs short.
  curl -fsS --max-time 3 -o /dev/null "$url"
}

fail=0
for entry in "${CHECKS[@]}"; do
  name="${entry%%|*}"
  rest="${entry#*|}"
  url="${rest%%|*}"

  deadline=$(( $(date +%s) + TIMEOUT ))
  ok=0
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if check_one "$url"; then
      ok=1
      break
    fi
    sleep "$INTERVAL"
  done

  if [ "$ok" -eq 1 ]; then
    printf "  %b  %-13s %s\n" "$OK" "$name" "$url"
  else
    printf "  %b  %-13s %s  (timed out after %ss)\n" "$BAD" "$name" "$url" "$TIMEOUT"
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  echo
  echo "One or more components failed to become ready."
  echo "Try: docker compose -f deploy/observability/docker-compose.yml logs"
  exit 1
fi

echo
echo "Observability stack is ready."
echo "  Grafana:      http://localhost:3002 (anonymous Viewer / admin:admin)"
echo "  Prometheus:   http://localhost:9090"
echo "  Tempo query:  http://localhost:3200"
echo "  Alertmanager: http://localhost:9093"
