#!/usr/bin/env bash
# Build a macOS DMG from an already-built .app bundle using only `hdiutil`.
#
# Tauri's built-in DMG bundler shells out to `create-dmg`, whose Finder
# "prettifying" AppleScript step fails in headless/CI environments with
# "Not authorized to send Apple events to Finder (-1743)". This script
# produces a clean, installable DMG with no Finder dependency, so it works
# locally and on GitHub Actions runners.
#
# Usage: make-dmg.sh <path-to-app> <output.dmg>
set -euo pipefail

APP="${1:?usage: make-dmg.sh <path-to-app> <output.dmg>}"
OUT="${2:?usage: make-dmg.sh <path-to-app> <output.dmg>}"

if [[ ! -d "$APP" ]]; then
  echo "error: not a directory: $APP" >&2
  exit 1
fi

APP_NAME="$(basename "$APP" .app)"
VOLUME_NAME="$(echo "$APP_NAME" | tr ' ' '-')"
STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"; hdiutil detach "$STAGING/mnt" >/dev/null 2>&1 || true' EXIT

# Size the read/write image to the app plus headroom (hdiutil needs a little
# slack for the filesystem metadata and the Applications symlink).
APP_SIZE_KB="$(du -sk "$APP" | awk '{print $1}')"
IMAGE_SIZE_MB="$((APP_SIZE_KB / 1024 + 40))"

mkdir -p "$(dirname "$OUT")"
RW_DMG="$STAGING/rw.dmg"

hdiutil create -volname "$VOLUME_NAME" -fs HFS+ -size "${IMAGE_SIZE_MB}m" -ov "$RW_DMG" >/dev/null
mkdir -p "$STAGING/mnt"
hdiutil attach "$RW_DMG" -mountpoint "$STAGING/mnt" -nobrowse >/dev/null

cp -R "$APP" "$STAGING/mnt/"
# Drag-and-drop target.
ln -s /Applications "$STAGING/mnt/Applications"

hdiutil detach "$STAGING/mnt" >/dev/null
hdiutil convert "$RW_DMG" -format UDZO -imagekey zlib-level=9 -o "$OUT" >/dev/null

echo "✓ wrote $OUT"
