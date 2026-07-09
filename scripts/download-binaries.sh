#!/bin/bash
# Stages yt-dlp + ffmpeg/ffprobe per target into bin/<os>/<arch>/.
#
# Usage:
#   scripts/download-binaries.sh                 # host os + host arch
#   scripts/download-binaries.sh mac-arm64 mac-x64
#   scripts/download-binaries.sh mac-arm64 mac-x64 win-x64 linux-x64
#
# Each target is "<os>-<arch>" where os is mac|win|linux and arch is arm64|x64.
# yt-dlp/ffmpeg are downloaded for the *target*, never copied from the host, so a
# single (e.g. Apple Silicon) machine can stage correct binaries for every target.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="${MYTUBE_BIN_STAGE_DIR:-$ROOT_DIR/bin}"
CURL=(curl --location --fail --http1.1 --retry 5 --retry-all-errors --retry-delay 2 --connect-timeout 20 --progress-bar)
YTDLP_BASE="https://github.com/yt-dlp/yt-dlp/releases/latest/download"
BTBN_BASE="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest"

# Cache the universal macOS yt-dlp so multiple mac targets share one download.
YTDLP_MACOS_CACHE=""
# Checksum manifests, downloaded once per run.
YTDLP_SUMS_CACHE=""
BTBN_SUMS_CACHE=""

sha256_of() { # file
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else echo ""; fi
}

md5_of() { # file
  if command -v md5sum >/dev/null 2>&1; then md5sum "$1" | awk '{print $1}'
  elif command -v md5 >/dev/null 2>&1; then md5 -q "$1"
  else echo ""; fi
}

# Verify a file against a `<hash>  <name>` manifest. Deletes the file and fails
# on mismatch so a tampered/corrupt download can never be staged.
verify_against_manifest() { # file assetname manifest hashcmd label
  local file="$1" asset="$2" manifest="$3" hashcmd="$4" label="$5" expected actual
  expected="$(awk -v name="$asset" '$2 == name || $2 == "*" name {print $1; exit}' "$manifest")"
  if [ -z "$expected" ]; then
    rm -f "$file"
    echo "ERROR: $label manifest has no entry for $asset" >&2
    return 1
  fi
  actual="$("$hashcmd" "$file")"
  if [ -z "$actual" ]; then
    rm -f "$file"
    echo "ERROR: no checksum tool available to verify $asset (need shasum/sha256sum/md5sum)" >&2
    return 1
  fi
  if [ "$actual" != "$expected" ]; then
    rm -f "$file"
    echo "ERROR: checksum mismatch for $asset (expected $expected, got $actual)" >&2
    echo "       The download may be corrupt or tampered with. Re-run to retry." >&2
    return 1
  fi
  echo "    checksum OK: $asset"
}

verify_ytdlp() { # file assetname
  if [ -z "$YTDLP_SUMS_CACHE" ]; then
    YTDLP_SUMS_CACHE="$BIN_DIR/.yt-dlp_sums.cache"
    download "$YTDLP_BASE/SHA2-256SUMS" "$YTDLP_SUMS_CACHE"
  fi
  verify_against_manifest "$1" "$2" "$YTDLP_SUMS_CACHE" sha256_of "yt-dlp SHA2-256SUMS"
}

verify_btbn() { # file assetname
  if [ -z "$BTBN_SUMS_CACHE" ]; then
    BTBN_SUMS_CACHE="$BIN_DIR/.btbn_sums.cache"
    download "$BTBN_BASE/checksums.sha256" "$BTBN_SUMS_CACHE"
  fi
  verify_against_manifest "$1" "$2" "$BTBN_SUMS_CACHE" sha256_of "BtbN checksums.sha256"
}

verify_johnvansickle_md5() { # file url
  local file="$1" url="$2" md5file expected actual
  md5file="$file.md5.tmp"
  download "$url.md5" "$md5file"
  expected="$(awk '{print $1; exit}' "$md5file")"
  rm -f "$md5file"
  actual="$(md5_of "$file")"
  if [ -z "$expected" ] || [ -z "$actual" ] || [ "$actual" != "$expected" ]; then
    rm -f "$file"
    echo "ERROR: md5 mismatch for $(basename "$file") (expected ${expected:-?}, got ${actual:-?})" >&2
    return 1
  fi
  echo "    checksum OK: $(basename "$file")"
}

download() { # url dest
  local url="$1" dest="$2" tmp="$2.tmp"
  mkdir -p "$(dirname "$dest")"
  rm -f "$tmp"
  if ! "${CURL[@]}" -o "$tmp" "$url"; then
    rm -f "$tmp"
    echo "ERROR: failed to download $url" >&2
    echo "       Re-run this command, or set MYTUBE_USE_SYSTEM_BINARIES=1 to copy tools from PATH for local development." >&2
    return 1
  fi
  if [ ! -s "$tmp" ]; then
    rm -f "$tmp"
    echo "ERROR: downloaded empty file from $url" >&2
    return 1
  fi
  mv "$tmp" "$dest"
}

copy_from_path() { # command dest
  local command_name="$1" dest="$2" source
  source="$(command -v "$command_name" || true)"
  if [ -z "$source" ]; then
    return 1
  fi
  mkdir -p "$(dirname "$dest")"
  cp "$source" "$dest"
  chmod +x "$dest" 2>/dev/null || true
  echo "    copied $command_name from PATH: $source"
  return 0
}

# Portable zip extraction so this runs on macOS/Linux (unzip) and Windows CI
# runners (which ship 7z/bsdtar/PowerShell but not always unzip).
extract_zip() { # zipfile destdir
  local zip="$1" dest="$2"
  mkdir -p "$dest"
  if command -v unzip >/dev/null 2>&1; then
    unzip -oq "$zip" -d "$dest"
  elif command -v 7z >/dev/null 2>&1; then
    7z x -y -o"$dest" "$zip" >/dev/null
  elif command -v 7z.exe >/dev/null 2>&1; then
    7z.exe x -y -o"$dest" "$zip" >/dev/null
  elif command -v bsdtar >/dev/null 2>&1; then
    bsdtar -xf "$zip" -C "$dest"
  elif command -v powershell >/dev/null 2>&1; then
    powershell -NoProfile -Command "Expand-Archive -Force -LiteralPath '$zip' -DestinationPath '$dest'"
  else
    echo "ERROR: no zip extractor available (need unzip, 7z, bsdtar, or powershell)" >&2
    return 1
  fi
}

host_target() {
  local os arch o a
  os=$(uname -s); arch=$(uname -m)
  case "$os" in Darwin) o=mac;; Linux) o=linux;; *) o=win;; esac
  case "$arch" in arm64|aarch64) a=arm64;; x86_64|amd64) a=x64;; *) a=x64;; esac
  echo "$o-$a"
}

fetch_ytdlp() { # os arch destdir
  local os="$1" arch="$2" dir="$3"
  if [ "${MYTUBE_USE_SYSTEM_BINARIES:-0}" = "1" ]; then
    local exe=""; [ "$os" = "win" ] && exe=".exe"
    if copy_from_path "yt-dlp$exe" "$dir/yt-dlp$exe" || copy_from_path "yt-dlp" "$dir/yt-dlp$exe"; then
      return
    fi
    echo "ERROR: MYTUBE_USE_SYSTEM_BINARIES=1 but yt-dlp was not found on PATH" >&2
    return 1
  fi

  case "$os" in
    mac)
      local dest="$dir/yt-dlp"
      if [ -z "$YTDLP_MACOS_CACHE" ]; then
        YTDLP_MACOS_CACHE="$BIN_DIR/.yt-dlp_macos.cache"
        download "$YTDLP_BASE/yt-dlp_macos" "$YTDLP_MACOS_CACHE"
        verify_ytdlp "$YTDLP_MACOS_CACHE" "yt-dlp_macos"
      fi
      cp "$YTDLP_MACOS_CACHE" "$dest"; chmod +x "$dest" ;;
    linux)
      local asset="yt-dlp_linux"; [ "$arch" = "arm64" ] && asset="yt-dlp_linux_aarch64"
      download "$YTDLP_BASE/$asset" "$dir/yt-dlp"
      verify_ytdlp "$dir/yt-dlp" "$asset"
      chmod +x "$dir/yt-dlp" ;;
    win)
      download "$YTDLP_BASE/yt-dlp.exe" "$dir/yt-dlp.exe"
      verify_ytdlp "$dir/yt-dlp.exe" "yt-dlp.exe" ;;
  esac
}

fetch_ffmpeg() { # os arch destdir
  local os="$1" arch="$2" dir="$3" tmp
  if [ "${MYTUBE_USE_SYSTEM_BINARIES:-0}" = "1" ]; then
    local exe=""; [ "$os" = "win" ] && exe=".exe"
    if copy_from_path "ffmpeg$exe" "$dir/ffmpeg$exe" && copy_from_path "ffprobe$exe" "$dir/ffprobe$exe"; then
      return
    fi
    echo "ERROR: MYTUBE_USE_SYSTEM_BINARIES=1 but ffmpeg/ffprobe were not both found on PATH" >&2
    return 1
  fi

  tmp="$(mktemp -d "${TMPDIR:-/tmp}/mytube-ffmpeg.XXXXXX")"
  trap 'rm -rf "$tmp"' RETURN
  case "$os" in
    mac)
      # osxexperts.net publishes no checksum manifests, so these zips can only
      # be integrity-checked implicitly (HTTPS + non-empty + executable probe).
      local fm fp
      if [ "$arch" = "arm64" ]; then
        fm="https://www.osxexperts.net/ffmpeg7arm.zip"; fp="https://www.osxexperts.net/ffprobe7arm.zip"
      else
        fm="https://www.osxexperts.net/ffmpeg7intel.zip"; fp="https://www.osxexperts.net/ffprobe7intel.zip"
      fi
      download "$fm" "$tmp/ffmpeg.zip"; extract_zip "$tmp/ffmpeg.zip" "$tmp"
      download "$fp" "$tmp/ffprobe.zip"; extract_zip "$tmp/ffprobe.zip" "$tmp"
      mv "$tmp/ffmpeg" "$dir/ffmpeg"; mv "$tmp/ffprobe" "$dir/ffprobe"
      chmod +x "$dir/ffmpeg" "$dir/ffprobe" ;;
    linux)
      local slug="amd64"; [ "$arch" = "arm64" ] && slug="arm64"
      local url="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-${slug}-static.tar.xz"
      download "$url" "$tmp/ffmpeg.tar.xz"
      verify_johnvansickle_md5 "$tmp/ffmpeg.tar.xz" "$url"
      tar -xf "$tmp/ffmpeg.tar.xz" -C "$tmp"
      local sub; sub="$(find "$tmp" -maxdepth 1 -type d -name 'ffmpeg-*-static' | head -1)"
      mv "$sub/ffmpeg" "$dir/ffmpeg"; mv "$sub/ffprobe" "$dir/ffprobe"
      chmod +x "$dir/ffmpeg" "$dir/ffprobe" ;;
    win)
      download "$BTBN_BASE/ffmpeg-master-latest-win64-gpl.zip" "$tmp/ffmpeg.zip"
      verify_btbn "$tmp/ffmpeg.zip" "ffmpeg-master-latest-win64-gpl.zip"
      extract_zip "$tmp/ffmpeg.zip" "$tmp"
      local bindir; bindir="$(dirname "$(find "$tmp" -type f -name 'ffmpeg.exe' | head -1)")"
      mv "$bindir/ffmpeg.exe" "$dir/ffmpeg.exe"; mv "$bindir/ffprobe.exe" "$dir/ffprobe.exe" ;;
  esac
  rm -rf "$tmp"
  trap - RETURN
}

stage_target() { # os arch
  local os="$1" arch="$2" dir="$BIN_DIR/$os/$arch"
  local exe=""; [ "$os" = "win" ] && exe=".exe"
  mkdir -p "$dir"
  echo "==> $os-$arch"

  # yt-dlp is ALWAYS refreshed: YouTube changes its player every few months and
  # breaks older versions (n-signature solving fails -> "Requested format is not
  # available"), so a stale bundled binary silently breaks downloads. Re-fetching
  # is cheap (cached across targets in one run).
  echo "    yt-dlp (refresh)..."; fetch_ytdlp "$os" "$arch" "$dir"
  echo "    yt-dlp version: $("$dir/yt-dlp$exe" --version 2>/dev/null || echo '?')"

  # ffmpeg/ffprobe are large and stable; only fetch when missing.
  if [ -f "$dir/ffmpeg$exe" ] && [ -f "$dir/ffprobe$exe" ]; then echo "    ffmpeg present, skipping"; else
    echo "    ffmpeg/ffprobe..."; fetch_ffmpeg "$os" "$arch" "$dir"; fi

  echo "    staged: $dir"
}

main() {
  local targets=("$@")
  if [ ${#targets[@]} -eq 0 ]; then targets=("$(host_target)"); fi

  mkdir -p "$BIN_DIR"
  for t in "${targets[@]}"; do
    local os="${t%%-*}" arch="${t##*-}"
    case "$os" in mac|win|linux) ;; *) echo "ERROR: unknown os in target '$t'" >&2; exit 1;; esac
    case "$arch" in arm64|x64) ;; *) echo "ERROR: unknown arch in target '$t'" >&2; exit 1;; esac
    stage_target "$os" "$arch"
  done

  rm -f "$BIN_DIR/.yt-dlp_macos.cache" "$BIN_DIR/.yt-dlp_sums.cache" "$BIN_DIR/.btbn_sums.cache"
  echo ""
  echo "==> Done. Staged targets: ${targets[*]}"
}

main "$@"
