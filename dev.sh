#!/bin/bash
# Dev rebuild cycle for opencli-grammarly plugin
#
# Usage:
#   ./dev.sh              # rebuild only
#   ./dev.sh test         # rebuild + run smoke test
#   ./dev.sh "some text"  # rebuild + check custom text
set -e

cd "$(dirname "$0")"

# Find the opencli install path
OPENCLI_PATH=$(node -e "console.log(require('path').dirname(require('which').sync('opencli')))" 2>/dev/null || echo "")
if [ -z "$OPENCLI_PATH" ]; then
  OPENCLI_PKG=$(dirname "$(readlink -f "$(which opencli)")")/../lib/node_modules/@jackwener/opencli
  [ -d "$OPENCLI_PKG" ] && OPENCLI_PATH="$OPENCLI_PKG"
fi
# Fallback to known homebrew path
[ -z "$OPENCLI_PATH" ] && OPENCLI_PATH="/opt/homebrew/lib/node_modules/@jackwener/opencli"

echo "→ Cleaning stale .js files..."
rm -f check.js score.js tone.js rewrite.js utils.js

echo "→ Re-transpiling plugin..."
opencli plugin update grammarly 2>&1 | grep -v "no compiled"

echo "→ Fixing @jackwener/opencli symlink..."
rm -f node_modules/@jackwener/opencli
ln -s "$OPENCLI_PATH" node_modules/@jackwener/opencli

echo "✅ Plugin rebuilt."

# Optional: run a test
if [ "$1" = "test" ]; then
  echo ""
  echo "→ Smoke test..."
  opencli grammarly check "Their going to the store tommorow."
elif [ -n "$1" ]; then
  echo ""
  echo "→ Running check..."
  opencli grammarly check "$1"
fi
