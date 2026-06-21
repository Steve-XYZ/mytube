#!/bin/bash
# Generate app icons for all platforms from a 1024x1024 PNG source
# Usage: bash scripts/generate-icons.sh [source.png]
# If no source is provided, generates a placeholder icon

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_DIR/build"
ICONS_DIR="$BUILD_DIR/icons"

mkdir -p "$ICONS_DIR"

SOURCE="${1:-}"

# If no source provided, create a placeholder using sips (macOS built-in)
if [ -z "$SOURCE" ]; then
  echo "No source icon provided. Generating placeholder..."

  # Create a simple icon using Python (available on macOS)
  python3 -c "
import struct, zlib

def create_png(width, height, color):
    def chunk(chunk_type, data):
        c = chunk_type + data
        crc = struct.pack('>I', zlib.crc32(c) & 0xffffffff)
        return struct.pack('>I', len(data)) + c + crc

    header = b'\\x89PNG\\r\\n\\x1a\\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))

    # Create gradient image data
    raw = b''
    r0, g0, b0 = 220, 50, 50   # Red top
    r1, g1, b1 = 180, 30, 90   # Purple bottom
    for y in range(height):
        raw += b'\\x00'  # filter byte
        t = y / max(height - 1, 1)
        for x in range(width):
            # Circle mask
            cx, cy = width/2, height/2
            radius = width * 0.42
            dx, dy = x - cx, y - cy
            dist = (dx*dx + dy*dy) ** 0.5

            if dist < radius:
                r = int(r0 + (r1 - r0) * t)
                g = int(g0 + (g1 - g0) * t)
                b = int(b0 + (b1 - b0) * t)

                # Play triangle in center
                tx, ty = (x - cx) / radius, (y - cy) / radius
                in_triangle = (tx > -0.15 and tx < 0.3 and
                              ty > tx * 0.8 - 0.3 and ty < -tx * 0.8 + 0.3)
                if in_triangle:
                    r, g, b = 255, 255, 255
            else:
                # Transparent-ish background (white)
                r, g, b = 245, 245, 245
                # Smooth edge
                edge = dist - radius
                if edge < 2:
                    alpha = 1 - edge / 2
                    r = int(r * (1 - alpha) + (r0 + (r1 - r0) * t) * alpha)
                    g = int(g * (1 - alpha) + (g0 + (g1 - g0) * t) * alpha)
                    b = int(b * (1 - alpha) + (b0 + (b1 - b0) * t) * alpha)

            raw += bytes([min(255, max(0, r)), min(255, max(0, g)), min(255, max(0, b))])

    idat = chunk(b'IDAT', zlib.compress(raw))
    iend = chunk(b'IEND', b'')
    return header + ihdr + idat + iend

png = create_png(1024, 1024, (220, 50, 50))
with open('$BUILD_DIR/icon_source.png', 'wb') as f:
    f.write(png)
print('Created 1024x1024 placeholder icon')
"
  SOURCE="$BUILD_DIR/icon_source.png"
fi

echo "Generating icons from: $SOURCE"

# Generate macOS .icns using iconutil (macOS only)
if [[ "$OSTYPE" == "darwin"* ]]; then
  ICONSET="$BUILD_DIR/icon.iconset"
  mkdir -p "$ICONSET"

  sips -z 16 16     "$SOURCE" --out "$ICONSET/icon_16x16.png"      > /dev/null 2>&1
  sips -z 32 32     "$SOURCE" --out "$ICONSET/icon_16x16@2x.png"   > /dev/null 2>&1
  sips -z 32 32     "$SOURCE" --out "$ICONSET/icon_32x32.png"      > /dev/null 2>&1
  sips -z 64 64     "$SOURCE" --out "$ICONSET/icon_32x32@2x.png"   > /dev/null 2>&1
  sips -z 128 128   "$SOURCE" --out "$ICONSET/icon_128x128.png"    > /dev/null 2>&1
  sips -z 256 256   "$SOURCE" --out "$ICONSET/icon_128x128@2x.png" > /dev/null 2>&1
  sips -z 256 256   "$SOURCE" --out "$ICONSET/icon_256x256.png"    > /dev/null 2>&1
  sips -z 512 512   "$SOURCE" --out "$ICONSET/icon_256x256@2x.png" > /dev/null 2>&1
  sips -z 512 512   "$SOURCE" --out "$ICONSET/icon_512x512.png"    > /dev/null 2>&1
  sips -z 1024 1024 "$SOURCE" --out "$ICONSET/icon_512x512@2x.png" > /dev/null 2>&1

  iconutil -c icns "$ICONSET" -o "$BUILD_DIR/icon.icns"
  rm -rf "$ICONSET"
  echo "Created: build/icon.icns"
fi

# Generate Linux icons (various sizes)
for SIZE in 16 32 48 64 128 256 512; do
  if command -v sips &> /dev/null; then
    sips -z $SIZE $SIZE "$SOURCE" --out "$ICONS_DIR/${SIZE}x${SIZE}.png" > /dev/null 2>&1
  fi
done
echo "Created: build/icons/*.png"

# Generate Windows .ico (requires ImageMagick or we'll use electron-builder's built-in conversion)
if command -v magick &> /dev/null; then
  magick "$SOURCE" -define icon:auto-resize=256,128,64,48,32,16 "$BUILD_DIR/icon.ico"
  echo "Created: build/icon.ico"
elif command -v convert &> /dev/null; then
  convert "$SOURCE" -define icon:auto-resize=256,128,64,48,32,16 "$BUILD_DIR/icon.ico"
  echo "Created: build/icon.ico"
else
  # electron-builder can convert from PNG, so copy the source
  cp "$SOURCE" "$BUILD_DIR/icon.png"
  echo "Created: build/icon.png (electron-builder will auto-convert to .ico)"
fi

echo "Icon generation complete!"
