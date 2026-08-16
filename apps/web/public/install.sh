#!/bin/sh
# Carbon — one-line installer.
#
#   curl -fsSL https://carbon-web-psi.vercel.app/install.sh | sh
#
# Downloads the latest standalone `carbon` CLI binary from the GitHub release
# for this OS/architecture, verifies its SHA-256 against the published
# SHA256SUMS.txt, and installs it to ~/.local/bin (no sudo required).
#
# Options (all optional):
#   CARBON_VERSION=v0.3.0     pin a specific release instead of latest
#   CARBON_INSTALL_DIR=/x     install to an explicit directory
#   sh install.sh --version v0.3.0   same as the env var
set -eu

VERSION="${CARBON_VERSION:-latest}"
if [ "${1:-}" = "--version" ] || [ "${1:-}" = "-v" ]; then
  VERSION="${2:-latest}"
fi

REPO="TaxCollector23/carbon"
BASE="https://github.com/$REPO"

# --- detect OS ---------------------------------------------------------------
case "$(uname -s)" in
  Darwin) OS="darwin" ;;
  Linux) OS="linux" ;;
  MINGW* | MSYS* | CYGWIN*)
    echo "error: on Windows, download carbon-windows-x64.exe directly from" >&2
    echo "  $BASE/releases/latest" >&2
    exit 1
    ;;
  *)
    echo "error: unsupported OS: $(uname -s)" >&2
    exit 1
    ;;
esac

# --- detect architecture -----------------------------------------------------
case "$(uname -m)" in
  x86_64 | amd64) ARCH="x64" ;;
  arm64 | aarch64) ARCH="arm64" ;;
  *)
    echo "error: unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

ASSET="carbon-$OS-$ARCH"
if [ "$VERSION" = "latest" ]; then
  URL="$BASE/releases/latest/download/$ASSET"
  SUM_URL="$BASE/releases/latest/download/SHA256SUMS.txt"
else
  URL="$BASE/releases/download/$VERSION/$ASSET"
  SUM_URL="$BASE/releases/download/$VERSION/SHA256SUMS.txt"
fi

# --- choose install directory (never sudo by default) ------------------------
if [ -z "${CARBON_INSTALL_DIR:-}" ]; then
  if [ -n "${XDG_BIN_HOME:-}" ]; then
    DEST_DIR="$XDG_BIN_HOME"
  elif [ -d "$HOME/.local/bin" ] || [ -w "$HOME" ]; then
    DEST_DIR="$HOME/.local/bin"
  elif [ -w /usr/local/bin ]; then
    DEST_DIR="/usr/local/bin"
  else
    echo "error: no writable install directory found; set CARBON_INSTALL_DIR" >&2
    exit 1
  fi
else
  DEST_DIR="$CARBON_INSTALL_DIR"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "$1"
  else
    echo "error: need curl or wget to download" >&2
    exit 1
  fi
}

echo "carbon: downloading $ASSET ($VERSION)…"
fetch "$URL" >"$TMP/carbon"
chmod +x "$TMP/carbon"

# --- verify SHA-256 if a checksum tool exists --------------------------------
if command -v shasum >/dev/null 2>&1 || command -v sha256sum >/dev/null 2>&1; then
  if fetch "$SUM_URL" >"$TMP/SHA256SUMS.txt" 2>/dev/null; then
    EXPECTED="$(awk -v asset="$ASSET" '$2 == asset { print $1; exit }' "$TMP/SHA256SUMS.txt")"
    if [ -n "$EXPECTED" ]; then
      if command -v shasum >/dev/null 2>&1; then
        ACTUAL="$(shasum -a 256 "$TMP/carbon" | awk '{ print $1 }')"
      else
        ACTUAL="$(sha256sum "$TMP/carbon" | awk '{ print $1 }')"
      fi
      if [ "$ACTUAL" != "$EXPECTED" ]; then
        echo "error: checksum mismatch for $ASSET" >&2
        echo "  expected $EXPECTED" >&2
        echo "  got      $ACTUAL" >&2
        exit 1
      fi
      echo "carbon: checksum verified"
    fi
  fi
fi

mkdir -p "$DEST_DIR"
mv "$TMP/carbon" "$DEST_DIR/carbon"
echo "carbon: installed to $DEST_DIR/carbon"

case ":$PATH:" in
  *":$DEST_DIR:"*) ;;
  *)
    echo "note: $DEST_DIR is not on your PATH. Add it with:" >&2
    echo "  export PATH=\"$DEST_DIR:\$PATH\"" >&2
    ;;
esac

echo
echo "Run 'carbon --help' to get started, or jump in with:"
echo "  carbon test petstore --openapi https://petstore3.swagger.io/api/v3/openapi.json"
