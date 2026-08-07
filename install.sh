#!/usr/bin/env sh
set -eu

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to install Carbon. Install Node.js 20 or later, then rerun this script." >&2
  exit 1
fi

echo "Installing Carbon CLI..."
npm install -g carbon-api

echo
echo "Carbon commands:"
carbon
