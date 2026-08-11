#!/usr/bin/env bash
# Run `mintlify broken-links` and fail (nonzero) if any broken link is found.
#
# The Mintlify CLI prints results to stdout and, historically, has been
# inconsistent about its exit code — successful runs with broken links have
# sometimes returned 0. This wrapper enforces the invariant we actually
# care about: broken link => nonzero exit.

set -uo pipefail

cd "$(dirname "$0")/.."

TMP="$(mktemp -t carbon-docs-links.XXXXXX)"
trap 'rm -f "$TMP"' EXIT

# Capture output and CLI exit code.
set +e
./node_modules/.bin/mintlify broken-links 2>&1 | tee "$TMP"
CLI_EXIT=${PIPESTATUS[0]}
set -e

# If the CLI itself failed (crash, auth, etc), surface that.
if [ "$CLI_EXIT" -ne 0 ]; then
  echo "check-links: mintlify broken-links exited with $CLI_EXIT" >&2
  exit "$CLI_EXIT"
fi

# Belt & suspenders — grep for the phrases the CLI uses to report bad links.
if grep -Eiq '(broken link|not found|404|dead link)' "$TMP"; then
  echo "check-links: broken links detected in docs" >&2
  exit 1
fi

echo "check-links: no broken links"
