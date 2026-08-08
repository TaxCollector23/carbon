#!/usr/bin/env sh
set -eu

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 or later is required to install Carbon. Install Node.js, then rerun this script." >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "${NODE_MAJOR:-0}" -lt 20 ]; then
  echo "Carbon requires Node.js 20 or later (found $(node -v)). Upgrade Node, then rerun this script." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to install Carbon. Install Node.js 20 or later, then rerun this script." >&2
  exit 1
fi

echo "Installing Carbon CLI..."
npm install -g carbon-dev

if ! command -v carbon >/dev/null 2>&1; then
  NPM_BIN="$(npm bin -g 2>/dev/null || echo "$HOME/.npm-global/bin")"
  echo >&2
  echo "Carbon installed, but 'carbon' is not on your PATH." >&2
  echo "Add your npm global bin directory to PATH, then reopen your shell:" >&2
  echo "  export PATH=\"$NPM_BIN:\$PATH\"" >&2
  echo "(Run 'npm bin -g' to confirm the directory.)" >&2
  exit 1
fi

echo
carbon --version
echo
echo "Next: run 'carbon init' to scaffold your first project."
