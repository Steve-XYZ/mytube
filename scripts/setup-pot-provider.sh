#!/bin/bash
# Installs the optional bgutil PO-token provider used by yt-dlp for YouTube.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$ROOT_DIR/bin"
# The provider is platform-independent (Node server + Python plugin), so it lives
# in bin/shared/ and is bundled alongside the per-arch binaries by electron-builder.
SHARED_DIR="$BIN_DIR/shared"
PROVIDER_VERSION="${MYTUBE_POT_PROVIDER_VERSION:-1.3.1}"
PROVIDER_COMMIT="${MYTUBE_POT_PROVIDER_COMMIT:-7608dd51ee813b48cf9a6d68c6e42cb197ce10e0}"
PROVIDER_REPO="https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git"
PROVIDER_DIR="$SHARED_DIR/bgutil-ytdlp-pot-provider"
PLUGIN_DIR="$SHARED_DIR/yt-dlp-plugins/bgutil-ytdlp-pot-provider"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mytube-pot-provider.XXXXXX")"
SOURCE_DIR="$WORK_DIR/source"
RUNTIME_DIR="$SHARED_DIR/bgutil-ytdlp-pot-provider.tmp"

cleanup() {
  rm -rf "$WORK_DIR" "$RUNTIME_DIR"
}
trap cleanup EXIT

mkdir -p "$SHARED_DIR"

echo "==> Installing YouTube PO-token provider $PROVIDER_VERSION"

if [ -f "$PROVIDER_DIR/server/build/generate_once.js" ] &&
   [ -f "$PLUGIN_DIR/yt_dlp_plugins/extractor/getpot_bgutil_script.py" ] &&
   [ "${MYTUBE_FORCE_POT_SETUP:-0}" != "1" ]; then
  INSTALLED_COMMIT="$(cat "$PROVIDER_DIR/.source-commit" 2>/dev/null || true)"
  if [ "$INSTALLED_COMMIT" = "$PROVIDER_COMMIT" ]; then
    echo "    Provider already installed. Set MYTUBE_FORCE_POT_SETUP=1 to reinstall."
    exit 0
  fi
  echo "    Installed provider commit differs; reinstalling."
fi

git clone --depth 1 --single-branch --branch "$PROVIDER_VERSION" "$PROVIDER_REPO" "$SOURCE_DIR"

CLONED_COMMIT="$(git -C "$SOURCE_DIR" rev-parse HEAD)"
if [ "$CLONED_COMMIT" != "$PROVIDER_COMMIT" ]; then
  echo "ERROR: bgutil provider tag $PROVIDER_VERSION resolved to $CLONED_COMMIT, expected $PROVIDER_COMMIT" >&2
  exit 1
fi

echo "==> Building provider server"
(
  cd "$SOURCE_DIR/server"
  npm ci
  npx tsc
)

GENERATE_SCRIPT="$SOURCE_DIR/server/build/generate_once.js"
node - "$GENERATE_SCRIPT" <<'NODE'
const fs = require('node:fs');
const filePath = process.argv[2];
const source = fs.readFileSync(filePath, 'utf8');
const original = 'program.parse();';
const replacement = 'program.parse(process.argv, { from: "node" });';

if (!source.includes(original)) {
  throw new Error(`Expected provider parser call not found in ${filePath}`);
}

fs.writeFileSync(filePath, source.replace(original, replacement));
NODE

echo "==> Preparing production-only provider runtime"
mkdir -p "$RUNTIME_DIR/server/build"
cp -R "$SOURCE_DIR/server/build/." "$RUNTIME_DIR/server/build/"
cp "$SOURCE_DIR/server/package.json" "$SOURCE_DIR/server/package-lock.json" "$RUNTIME_DIR/server/"
(
  cd "$RUNTIME_DIR/server"
  npm ci --omit=dev
  rm -f package-lock.json node_modules/.package-lock.json
  find node_modules -type d \( -name test -o -name tests -o -name __tests__ -o -name .cache \) -prune -exec rm -rf {} +
  find node_modules -type d -name .git -prune -exec rm -rf {} +
)
find "$RUNTIME_DIR/server/build" -type f -name '*.map' -delete
printf '%s\n' "$PROVIDER_COMMIT" > "$RUNTIME_DIR/.source-commit"

echo "==> Installing yt-dlp plugin"
rm -rf "$PLUGIN_DIR"
mkdir -p "$PLUGIN_DIR"
cp -R "$SOURCE_DIR/plugin/yt_dlp_plugins" "$PLUGIN_DIR/"

rm -rf "$PROVIDER_DIR"
mv "$RUNTIME_DIR" "$PROVIDER_DIR"

echo "==> YouTube PO-token provider ready"
echo "    server: $PROVIDER_DIR/server"
echo "    plugin: $PLUGIN_DIR"
