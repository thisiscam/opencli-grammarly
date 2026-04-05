#!/bin/bash
# Dev rebuild cycle for opencli-grammarly plugin
# Usage: ./dev.sh
set -e

echo "→ Cleaning stale .js files..."
rm -f check.js score.js tone.js rewrite.js utils.js

echo "→ Re-transpiling plugin..."
opencli plugin update grammarly 2>&1 | grep -v "no compiled"

echo "→ Fixing @jackwener/opencli symlink..."
rm -f node_modules/@jackwener/opencli
ln -s /opt/homebrew/lib/node_modules/@jackwener/opencli node_modules/@jackwener/opencli

echo "✅ Ready. Test with: opencli grammarly check \"Their going tommorow.\""
