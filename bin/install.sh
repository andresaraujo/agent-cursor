#!/bin/sh
# Local install from a clone: link into herdr and start. The overlay binary is
# prebuilt (native/bin); rebuild with native/build.sh if it's missing.
set -e
cd "$(dirname "$0")/.."
command -v herdr >/dev/null || { echo "herdr not found: https://herdr.dev" >&2; exit 1; }
[ -x native/bin/agent-cursor-overlay ] && [ -d native/AgentCursor.app ] || sh native/build.sh
# Files copied via browser/AirDrop get quarantined; a git clone doesn't, but be safe.
xattr -dr com.apple.quarantine native/bin native/AgentCursor.app 2>/dev/null || true
# Register the agent-cursor:// URL scheme.
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$PWD/native/AgentCursor.app"
herdr plugin link "$PWD"
sh bin/run.sh start
