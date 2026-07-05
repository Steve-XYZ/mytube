import * as http from 'http';
import * as zlib from 'zlib';
import type { AddressInfo } from 'net';

export interface TestServer {
  baseUrl: string;
  close(): Promise<void>;
}

const PAGES: Record<string, string> = {
  '/': `<!doctype html>
<html>
  <head><title>E2E Page A</title></head>
  <body>
    <h1 id="heading">Page A</h1>
    <a id="to-b" href="/b">Go to page B</a>
  </body>
</html>`,
  '/b': `<!doctype html>
<html>
  <head><title>E2E Page B</title></head>
  <body>
    <h1 id="heading">Page B</h1>
    <a id="to-a" href="/">Back to page A</a>
  </body>
</html>`,
  '/permissions': `<!doctype html>
<html>
  <head><title>E2E Permissions</title></head>
  <body>
    <h1 id="heading">Permissions</h1>
    <p id="perm-state"></p>
    <p id="result"></p>
    <button id="req-notif">Request notifications</button>
    <script>
      document.getElementById('perm-state').textContent = Notification.permission;
      document.getElementById('req-notif').addEventListener('click', () => {
        Notification.requestPermission().then((outcome) => {
          document.getElementById('result').textContent = outcome;
        });
      });
    </script>
  </body>
</html>`,
  '/gallery': `<!doctype html>
<html>
  <head><title>E2E Gallery</title></head>
  <body>
    <h1 id="heading">Gallery</h1>
    <img src="/img/photo1.png" width="200" height="150" alt="photo one">
    <img src="/img/photo2.png" width="300" height="200" alt="photo two">
    <!-- Below the 50px threshold: must be filtered out as a tracking-pixel-like image. -->
    <img src="/img/small.png" width="10" height="10" alt="tiny">
  </body>
</html>`,
};

let imageCache: Record<string, Buffer> | null = null;

function getImages(): Record<string, Buffer> {
  imageCache ??= {
    '/img/photo1.png': generatePng(200, 150, [200, 60, 60]),
    '/img/photo2.png': generatePng(300, 200, [60, 120, 200]),
    '/img/small.png': generatePng(10, 10, [60, 200, 60]),
  };
  return imageCache;
}

/** Local static server so navigation/gallery tests never depend on the live network. */
export async function startTestServer(): Promise<TestServer> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');

    const image = getImages()[url.pathname];
    if (image) {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': image.length });
      res.end(image);
      return;
    }

    const body = PAGES[url.pathname];
    if (!body) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(body);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

/**
 * Build a valid single-color truecolor PNG so scanned images have real
 * natural dimensions (the app filters images below 50x50).
 */
function generatePng(width: number, height: number, [r, g, b]: [number, number, number] | number[]): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Each scanline: filter byte 0 followed by RGB pixels.
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 3);
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 3;
      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
    }
  }

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
