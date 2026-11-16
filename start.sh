#!/bin/sh
cd -- "$(dirname -- "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js 22.12.0+ required. Install from https://nodejs.org/en/download' >&2
  exit 1
fi
exec node scripts/launch.mjs
