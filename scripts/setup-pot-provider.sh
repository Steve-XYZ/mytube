#!/bin/bash
# Installs the optional bgutil PO-token provider used by yt-dlp for YouTube.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$ROOT_DIR/bin"
PROVIDER_VERSION="${MYTUBE_POT_PROVIDER_VERSION:-1.3.1}"
PROVIDER_COMMIT="${MYTUBE_POT_PROVIDER_COMMIT:-7608dd51ee813b48cf9a6d68c6e42cb197ce10e0}"
PROVIDER_REPO="https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git"
PROVIDER_DIR="$BIN_DIR/bgutil-ytdlp-pot-provider"
PLUGIN_DIR="$BIN_DIR/yt-dlp-plugins/bgutil-ytdlp-pot-provider"
TMP_DIR="$BIN_DIR/bgutil-ytdlp-pot-provider.tmp"

mkdir -p "$BIN_DIR"

echo "==> Installing YouTube PO-token provider $PROVIDER_VERSION"

if [ -f "$PROVIDER_DIR/server/build/generate_once.js" ] &&
   [ -f "$PLUGIN_DIR/yt_dlp_plugins/extractor/getpot_bgutil_script.py" ] &&
   [ "${MYTUBE_FORCE_POT_SETUP:-0}" != "1" ]; then
  INSTALLED_COMMIT="$(git -C "$PROVIDER_DIR" rev-parse HEAD 2>/dev/null || true)"
  if [ "$INSTALLED_COMMIT" = "$PROVIDER_COMMIT" ]; then
    echo "    Provider already installed. Set MYTUBE_FORCE_POT_SETUP=1 to reinstall."
    exit 0
  fi
  echo "    Installed provider commit differs; reinstalling."
fi

rm -rf "$TMP_DIR"
git clone --depth 1 --single-branch --branch "$PROVIDER_VERSION" "$PROVIDER_REPO" "$TMP_DIR"

CLONED_COMMIT="$(git -C "$TMP_DIR" rev-parse HEAD)"
if [ "$CLONED_COMMIT" != "$PROVIDER_COMMIT" ]; then
  rm -rf "$TMP_DIR"
  echo "ERROR: bgutil provider tag $PROVIDER_VERSION resolved to $CLONED_COMMIT, expected $PROVIDER_COMMIT" >&2
  exit 1
fi

echo "==> Building provider server"
(
  cd "$TMP_DIR/server"
  npm ci
  npx tsc
)

echo "==> Installing yt-dlp plugin"
rm -rf "$PLUGIN_DIR"
mkdir -p "$PLUGIN_DIR"
cp -R "$TMP_DIR/plugin/yt_dlp_plugins" "$PLUGIN_DIR/"

rm -rf "$PROVIDER_DIR"
mv "$TMP_DIR" "$PROVIDER_DIR"

echo "==> YouTube PO-token provider ready"
echo "    server: $PROVIDER_DIR/server"
echo "    plugin: $PLUGIN_DIR"
