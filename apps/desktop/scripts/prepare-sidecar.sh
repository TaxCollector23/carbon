#!/usr/bin/env bash
# Build (or reuse) the standalone `carbon` CLI and place it where Tauri's
# bundler expects an external binary (bundle.externalBin). Tauri resolves
# sidecars by Rust target triple, so we map the Bun cross-compile target to a
# triple and name the file `carbon-<triple>`.
#
# Usage: ./scripts/prepare-sidecar.sh [bun-target]
# Defaults to the host platform.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/../cli"

# bun-target -> "rust-triple|output-name"
map_target() {
  case "$1" in
    bun-darwin-arm64) echo "aarch64-apple-darwin|carbon-darwin-arm64" ;;
    bun-darwin-x64)   echo "x86_64-apple-darwin|carbon-darwin-x64" ;;
    bun-linux-x64)    echo "x86_64-unknown-linux-gnu|carbon-linux-x64" ;;
    bun-linux-arm64)  echo "aarch64-unknown-linux-gnu|carbon-linux-arm64" ;;
    bun-windows-x64)  echo "x86_64-pc-windows-msvc|carbon-windows-x64.exe" ;;
    *)
      echo "unknown bun target: $1" >&2
      exit 1
      ;;
  esac
}

detect_host() {
  case "$(uname -s)" in
    Darwin)
      case "$(uname -m)" in
        arm64) echo "bun-darwin-arm64" ;;
        x86_64) echo "bun-darwin-x64" ;;
        *) echo "unknown macOS arch: $(uname -m)" >&2; exit 1 ;;
      esac
      ;;
    Linux)
      case "$(uname -m)" in
        x86_64) echo "bun-linux-x64" ;;
        aarch64 | arm64) echo "bun-linux-arm64" ;;
        *) echo "unknown Linux arch: $(uname -m)" >&2; exit 1 ;;
      esac
      ;;
    MINGW* | MSYS* | CYGWIN*)
      echo "bun-windows-x64"
      ;;
    *)
      echo "unknown host platform: $(uname -s)-$(uname -m)" >&2
      exit 1
      ;;
  esac
}

BUN_TARGET="${1:-$(detect_host)}"
read -r TRIPLE OUT <<<"$(map_target "$BUN_TARGET" | tr '|' ' ')"

mkdir -p "$ROOT/src-tauri/binaries"
DEST="$ROOT/src-tauri/binaries/carbon-$TRIPLE"

if [ ! -f "$CLI/dist/bin/$OUT" ]; then
  echo "→ building CLI for $BUN_TARGET"
  (cd "$CLI" && bun build --compile src/index.ts --target="$BUN_TARGET" --outfile "dist/bin/$OUT")
fi

cp "$CLI/dist/bin/$OUT" "$DEST"
echo "✓ sidecar ready: src-tauri/binaries/carbon-$TRIPLE"
