import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(rootDir, 'image.png');
const buildDir = path.join(rootDir, 'build');
const linuxDir = path.join(buildDir, 'icons');
const iconsetDir = path.join(buildDir, 'icon.iconset');
const linuxSizes = [16, 32, 48, 64, 128, 256, 512];
const icoSizes = [16, 32, 48, 64, 128, 256];

const metadata = await sharp(source).metadata();
if (!metadata.width || !metadata.height || metadata.width !== metadata.height) {
  throw new Error(`image.png must be square (found ${metadata.width}x${metadata.height}).`);
}
if (metadata.width < 1024) {
  throw new Error(`image.png must be at least 1024x1024 (found ${metadata.width}x${metadata.height}).`);
}

await rm(linuxDir, { recursive: true, force: true });
await rm(iconsetDir, { recursive: true, force: true });
await mkdir(linuxDir, { recursive: true });
await mkdir(iconsetDir, { recursive: true });

const { data, info } = await sharp(source)
  .resize(1024, 1024, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

const visited = new Uint8Array(info.width * info.height);
const queue = new Int32Array(info.width * info.height);
let head = 0;
let tail = 0;

function enqueue(x, y) {
  if (x < 0 || y < 0 || x >= info.width || y >= info.height) return;
  const pixelIndex = y * info.width + x;
  if (visited[pixelIndex]) return;

  const offset = pixelIndex * info.channels;
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  const minimum = Math.min(red, green, blue);
  const maximum = Math.max(red, green, blue);

  if (minimum < 220 || maximum - minimum > 24) return;

  visited[pixelIndex] = 1;
  queue[tail++] = pixelIndex;
  data[offset + 3] = 0;
}

for (let x = 0; x < info.width; x += 1) {
  enqueue(x, 0);
  enqueue(x, info.height - 1);
}
for (let y = 0; y < info.height; y += 1) {
  enqueue(0, y);
  enqueue(info.width - 1, y);
}

while (head < tail) {
  const pixelIndex = queue[head++];
  const x = pixelIndex % info.width;
  const y = Math.floor(pixelIndex / info.width);
  enqueue(x - 1, y);
  enqueue(x + 1, y);
  enqueue(x, y - 1);
  enqueue(x, y + 1);
}

const master = await sharp(data, {
  raw: {
    width: info.width,
    height: info.height,
    channels: info.channels,
  },
})
  .png({ compressionLevel: 9, adaptiveFiltering: false })
  .toBuffer();

const pngs = new Map();
for (const size of linuxSizes) {
  const png = await sharp(master)
    .resize(size, size, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
  pngs.set(size, png);
  await writeFile(path.join(linuxDir, `${size}x${size}.png`), png);
}

const iconsetFiles = new Map([
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
]);
for (const [filename, size] of iconsetFiles) {
  await writeFile(path.join(iconsetDir, filename), pngs.get(size));
}
await writeFile(path.join(iconsetDir, 'icon_512x512@2x.png'), master);

const icoImages = await Promise.all(icoSizes.map((size) => readFile(path.join(linuxDir, `${size}x${size}.png`))));
const headerSize = 6;
const entrySize = 16;
let imageOffset = headerSize + entrySize * icoImages.length;
const header = Buffer.alloc(imageOffset);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(icoImages.length, 4);

for (let index = 0; index < icoImages.length; index += 1) {
  const size = icoSizes[index];
  const image = icoImages[index];
  const offset = headerSize + entrySize * index;
  header.writeUInt8(size === 256 ? 0 : size, offset);
  header.writeUInt8(size === 256 ? 0 : size, offset + 1);
  header.writeUInt8(0, offset + 2);
  header.writeUInt8(0, offset + 3);
  header.writeUInt16LE(1, offset + 4);
  header.writeUInt16LE(32, offset + 6);
  header.writeUInt32LE(image.length, offset + 8);
  header.writeUInt32LE(imageOffset, offset + 12);
  imageOffset += image.length;
}

await writeFile(path.join(buildDir, 'icon.ico'), Buffer.concat([header, ...icoImages]));
