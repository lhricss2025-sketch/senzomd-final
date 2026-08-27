#!/bin/bash
# SENZO MD — Railway / production start script
set -e

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm ci --no-audit --no-fund 2>/dev/null || npm install --no-audit --no-fund
fi

echo "Starting SENZO MD..."
exec node index.js
