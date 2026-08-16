#!/usr/bin/env bash
# Build standalone `carbon` binaries for every supported platform using Bun's
# single-executable compiler, then write a SHA256SUMS manifest next to them.
#
# Requires `bun` on PATH. Cross-compilation embeds the target Bun runtime, so
# the whole matrix can be produced from any host.
set -euo pipefail

cd "$(dirname "$0")/.."

OUT=dist/bin
rm -rf "$OUT"
mkdir -p "$OUT"

# target:output-name
TARGETS=(
  "bun-darwin-arm64:carbon-darwin-arm64"
  "bun-darwin-x64:carbon-darwin-x64"
  "bun-linux-x64:carbon-linux-x64"
  "bun-linux-arm64:carbon-linux-arm64"
  "bun-windows-x64:carbon-windows-x64.exe"
)

for pair in "${TARGETS[@]}"; do
  target="${pair%%:*}"
  name="${pair##*:}"
  echo "→ building $name ($target)"
  bun build --compile src/index.ts --target="$target" --outfile "$OUT/$name"
done

(
  cd "$OUT"
  shasum -a 256 carbon-* > SHA256SUMS.txt
)

echo "✓ wrote $OUT:"
ls -la "$OUT"
