#!/bin/sh
# Build universal (arm64 + x86_64) native pieces. Needs Xcode CLT.
# Results are committed so installs don't need a compiler:
#   bin/agent-cursor-overlay   overlay window
#   AgentCursor.app            agent-cursor:// URL handler
set -e
cd "$(dirname "$0")"
mkdir -p bin build

universal() { # <source> <output>
  for arch in arm64 x86_64; do
    swiftc -O -target "$arch-apple-macos12" -o "build/$(basename "$2")-$arch" "$1"
  done
  lipo -create -output "$2" "build/$(basename "$2")-arm64" "build/$(basename "$2")-x86_64"
}

universal overlay.swift bin/agent-cursor-overlay
codesign --force --sign - bin/agent-cursor-overlay

rm -rf AgentCursor.app
mkdir -p AgentCursor.app/Contents/MacOS
cp Info.plist AgentCursor.app/Contents/Info.plist
universal urlhandler.swift AgentCursor.app/Contents/MacOS/AgentCursor
codesign --force --sign - AgentCursor.app

rm -rf build
lipo -info bin/agent-cursor-overlay AgentCursor.app/Contents/MacOS/AgentCursor
