#!/bin/sh
# Herdr may launch plugins with a minimal PATH; find node before running the CLI.
ROOT="${HERDR_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
NODE="$(command -v node 2>/dev/null)"
if [ -z "$NODE" ]; then
  for c in /opt/homebrew/bin/node /usr/local/bin/node "$HOME"/.nvm/versions/node/*/bin/node; do
    [ -x "$c" ] && NODE="$c"
  done
fi
[ -z "$NODE" ] && { echo "agent-cursor: node not found" >&2; exit 1; }
exec "$NODE" "$ROOT/src/cli.mjs" "$@"
