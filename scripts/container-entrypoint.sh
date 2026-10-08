#!/bin/sh
set -eu
# Custom CLI commands (including the one-off schema Job) must not start the app.
if [ "$#" -eq 2 ] && [ "$1" = node ] && [ "$2" = app.js ]; then
  node scripts/container-preflight.js
fi
exec "$@"
