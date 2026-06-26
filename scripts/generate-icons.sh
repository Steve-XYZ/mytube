#!/usr/bin/env bash
# Generate all platform icons from the canonical image.png in the project root.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$ROOT_DIR/image.png"
BUILD_DIR="$ROOT_DIR/build"
ICONSET_DIR="$ROOT_DIR/build/icon.iconset"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$2"
}

[ "$#" -eq 0 ] || fail "This script takes no arguments. Replace image.png to change the canonical icon source."
[ -f "$SOURCE" ] || fail "Canonical icon source not found: $SOURCE"

require_command node "Node.js is required. Install the project-supported Node.js version first."
require_command iconutil "iconutil is required to create build/icon.icns. Run icon generation on macOS with Xcode Command Line Tools installed."

if ! node -e "import('sharp')" >/dev/null 2>&1; then
  fail "The sharp development dependency is missing. Run 'pnpm install' before generating icons."
fi

trap 'rm -rf "$ICONSET_DIR"' EXIT

node "$ROOT_DIR/scripts/generate-icons.mjs"
iconutil -c icns "$ICONSET_DIR" -o "$BUILD_DIR/icon.icns"

echo "Generated icons from image.png:"
echo "  build/icon.icns"
echo "  build/icon.ico (16 32 48 64 128 256 px)"
echo "  build/icons/ (16 32 48 64 128 256 512 px)"
