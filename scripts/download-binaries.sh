#!/bin/bash
# Downloads yt-dlp and ffmpeg binaries for the current platform
set -e

BIN_DIR="$(cd "$(dirname "$0")/.." && pwd)/bin"
mkdir -p "$BIN_DIR"

OS=$(uname -s)
ARCH=$(uname -m)

echo "==> Platform: $OS / $ARCH"
echo "==> Bin directory: $BIN_DIR"

# ==================== yt-dlp ====================
echo ""
echo "==> Downloading yt-dlp..."

if [ "$OS" = "Darwin" ]; then
  YTDLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
  YTDLP_BIN="$BIN_DIR/yt-dlp"
elif [ "$OS" = "Linux" ]; then
  YTDLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux"
  YTDLP_BIN="$BIN_DIR/yt-dlp"
else
  # Windows (MINGW/MSYS)
  YTDLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
  YTDLP_BIN="$BIN_DIR/yt-dlp.exe"
fi

if [ -f "$YTDLP_BIN" ]; then
  echo "    yt-dlp already exists, skipping. Delete $YTDLP_BIN to re-download."
else
  curl -L --progress-bar -o "$YTDLP_BIN" "$YTDLP_URL"
  chmod +x "$YTDLP_BIN"
  echo "    yt-dlp downloaded: $YTDLP_BIN"
fi

# Verify
"$YTDLP_BIN" --version 2>/dev/null && echo "    yt-dlp OK" || echo "    WARNING: yt-dlp binary may not be executable"

# ==================== ffmpeg ====================
echo ""
echo "==> Downloading ffmpeg..."

FFMPEG_BIN="$BIN_DIR/ffmpeg"
FFPROBE_BIN="$BIN_DIR/ffprobe"

if [ "$OS" = "Darwin" ]; then
  if [ "$ARCH" = "arm64" ]; then
    FFMPEG_URL="https://www.osxexperts.net/ffmpeg7arm.zip"
    FFPROBE_URL="https://www.osxexperts.net/ffprobe7arm.zip"
  else
    FFMPEG_URL="https://www.osxexperts.net/ffmpeg7intel.zip"
    FFPROBE_URL="https://www.osxexperts.net/ffprobe7intel.zip"
  fi

  if [ -f "$FFMPEG_BIN" ]; then
    echo "    ffmpeg already exists, skipping."
  else
    # Try using brew-installed ffmpeg first
    if command -v ffmpeg &>/dev/null; then
      SYSTEM_FFMPEG=$(which ffmpeg)
      SYSTEM_FFPROBE=$(which ffprobe)
      cp "$SYSTEM_FFMPEG" "$FFMPEG_BIN"
      cp "$SYSTEM_FFPROBE" "$FFPROBE_BIN"
      echo "    Copied system ffmpeg from $SYSTEM_FFMPEG"
    else
      echo "    Downloading ffmpeg from osxexperts.net..."
      curl -L --progress-bar -o "$BIN_DIR/ffmpeg.zip" "$FFMPEG_URL"
      unzip -o "$BIN_DIR/ffmpeg.zip" -d "$BIN_DIR" && rm "$BIN_DIR/ffmpeg.zip"
      curl -L --progress-bar -o "$BIN_DIR/ffprobe.zip" "$FFPROBE_URL"
      unzip -o "$BIN_DIR/ffprobe.zip" -d "$BIN_DIR" && rm "$BIN_DIR/ffprobe.zip"
      chmod +x "$FFMPEG_BIN" "$FFPROBE_BIN"
      echo "    ffmpeg downloaded"
    fi
  fi
elif [ "$OS" = "Linux" ]; then
  if [ -f "$FFMPEG_BIN" ]; then
    echo "    ffmpeg already exists, skipping."
  else
    if command -v ffmpeg &>/dev/null; then
      cp "$(which ffmpeg)" "$FFMPEG_BIN"
      cp "$(which ffprobe)" "$FFPROBE_BIN"
      echo "    Copied system ffmpeg"
    else
      echo "    Please install ffmpeg: sudo apt install ffmpeg"
      exit 1
    fi
  fi
else
  # Windows
  FFMPEG_BIN="$BIN_DIR/ffmpeg.exe"
  FFPROBE_BIN="$BIN_DIR/ffprobe.exe"
  if [ -f "$FFMPEG_BIN" ]; then
    echo "    ffmpeg already exists, skipping."
  else
    FFMPEG_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
    echo "    Downloading ffmpeg for Windows..."
    curl -L --progress-bar -o "$BIN_DIR/ffmpeg-win.zip" "$FFMPEG_URL"
    unzip -o "$BIN_DIR/ffmpeg-win.zip" "*/bin/ffmpeg.exe" "*/bin/ffprobe.exe" -d "$BIN_DIR"
    mv "$BIN_DIR"/ffmpeg-master-latest-win64-gpl/bin/ffmpeg.exe "$FFMPEG_BIN"
    mv "$BIN_DIR"/ffmpeg-master-latest-win64-gpl/bin/ffprobe.exe "$FFPROBE_BIN"
    rm -rf "$BIN_DIR/ffmpeg-win.zip" "$BIN_DIR/ffmpeg-master-latest-win64-gpl"
    echo "    ffmpeg downloaded"
  fi
fi

# Verify ffmpeg
"$FFMPEG_BIN" -version 2>/dev/null | head -1 && echo "    ffmpeg OK" || echo "    WARNING: ffmpeg binary may not work"

echo ""
echo "==> All binaries ready in $BIN_DIR"
ls -la "$BIN_DIR"
