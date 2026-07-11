import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import {
  YtDlpUpdater,
  YTDLP_LATEST_RELEASE_URL,
  compareYtDlpVersions,
  parseChecksumManifest,
  getManagedYtDlpDir,
  getManagedYtDlpPath,
  readManagedYtDlpVersion,
} from '../../src/main/download/YtDlpUpdater';

const LATEST_VERSION = '2099.01.01';
const ASSET_URL = 'https://example.invalid/yt-dlp_linux';
const CHECKSUM_URL = 'https://example.invalid/SHA2-256SUMS';

// A runnable stand-in for the downloaded binary: reports the release version.
const BINARY_CONTENT = `#!/bin/sh\necho ${LATEST_VERSION}\n`;

function sha256(content: string): string {
  return createHash('sha256').update(Buffer.from(content)).digest('hex');
}

function stubResponse(body: string | Buffer) {
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(body.toString()),
    text: async () => body.toString(),
    arrayBuffer: async () => {
      const buf = typeof body === 'string' ? Buffer.from(body) : body;
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
  };
}

function releaseJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    tag_name: LATEST_VERSION,
    assets: [
      { name: 'yt-dlp_linux', browser_download_url: ASSET_URL },
      { name: 'SHA2-256SUMS', browser_download_url: CHECKSUM_URL },
    ],
    ...overrides,
  });
}

function checksumManifest(hash: string): string {
  return [`${sha256('unrelated')}  yt-dlp.exe`, `${hash}  yt-dlp_linux`, ''].join('\n');
}

describe('YtDlpUpdater', () => {
  let managedDir: string;
  let fetchMock: ReturnType<typeof vi.fn>;
  let routes: Record<string, () => ReturnType<typeof stubResponse>>;

  function makeUpdater(options: Partial<ConstructorParameters<typeof YtDlpUpdater>[0]> = {}) {
    return new YtDlpUpdater({
      managedDir,
      currentVersionProvider: () => '2020.01.01',
      fetchFn: fetchMock as unknown as typeof fetch,
      platform: 'linux',
      ...options,
    });
  }

  beforeEach(() => {
    managedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-updater-test-'));
    routes = {
      [YTDLP_LATEST_RELEASE_URL]: () => stubResponse(releaseJson()),
      [ASSET_URL]: () => stubResponse(BINARY_CONTENT),
      [CHECKSUM_URL]: () => stubResponse(checksumManifest(sha256(BINARY_CONTENT))),
    };
    fetchMock = vi.fn(async (url: string) => {
      const route = routes[url];
      if (!route) throw new Error(`unexpected fetch: ${url}`);
      return route();
    });
  });

  afterEach(() => {
    fs.rmSync(managedDir, { recursive: true, force: true });
  });

  it('downloads, verifies, and installs a newer binary', async () => {
    const onUpdated = vi.fn();
    const updater = makeUpdater({ onUpdated });

    const result = await updater.checkAndUpdate();

    expect(result).toEqual({ status: 'updated', version: LATEST_VERSION });

    const binaryPath = getManagedYtDlpPath(managedDir, 'linux');
    expect(fs.readFileSync(binaryPath, 'utf-8')).toBe(BINARY_CONTENT);
    expect(fs.statSync(binaryPath).mode & 0o111).not.toBe(0);
    expect(onUpdated).toHaveBeenCalledWith(binaryPath, LATEST_VERSION);

    const state = JSON.parse(fs.readFileSync(path.join(managedDir, 'update-state.json'), 'utf-8'));
    expect(state.version).toBe(LATEST_VERSION);
    expect(state.lastCheckAt).toBeGreaterThan(0);
  });

  it('reports up-to-date without downloading when current version is not older', async () => {
    const updater = makeUpdater({ currentVersionProvider: () => LATEST_VERSION });

    const result = await updater.checkAndUpdate();

    expect(result).toEqual({ status: 'up-to-date', version: LATEST_VERSION });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(getManagedYtDlpPath(managedDir, 'linux'))).toBe(false);
  });

  it('reinstalls an up-to-date managed binary when its background probe fails', async () => {
    const managedPath = getManagedYtDlpPath(managedDir, 'linux');
    fs.writeFileSync(managedPath, '#!/bin/sh\necho 1999.01.01\n', { mode: 0o755 });
    fs.writeFileSync(
      path.join(managedDir, 'update-state.json'),
      JSON.stringify({ version: LATEST_VERSION, lastCheckAt: 0 }),
    );
    const updater = makeUpdater({ currentVersionProvider: () => LATEST_VERSION });

    const result = await updater.checkAndUpdate();

    expect(result).toEqual({ status: 'updated', version: LATEST_VERSION });
    expect(fs.readFileSync(managedPath, 'utf-8')).toBe(BINARY_CONTENT);
  });

  it('updates even when the current version is unknown', async () => {
    const updater = makeUpdater({ currentVersionProvider: () => null });

    const result = await updater.checkAndUpdate();

    expect(result.status).toBe('updated');
  });

  it('throttles checks within the spacing window unless forced', async () => {
    fs.writeFileSync(path.join(managedDir, 'update-state.json'), JSON.stringify({ lastCheckAt: Date.now() }));
    const updater = makeUpdater();

    expect(await updater.checkAndUpdate()).toEqual({ status: 'throttled' });
    expect(fetchMock).not.toHaveBeenCalled();

    expect((await updater.checkAndUpdate(true)).status).toBe('updated');
  });

  it('rejects a binary whose checksum does not match', async () => {
    routes[CHECKSUM_URL] = () => stubResponse(checksumManifest(sha256('tampered content')));
    const updater = makeUpdater();

    const result = await updater.checkAndUpdate();

    expect(result.status).toBe('failed');
    expect(result.error).toContain('checksum mismatch');
    expect(fs.existsSync(getManagedYtDlpPath(managedDir, 'linux'))).toBe(false);
    expect(fs.existsSync(`${getManagedYtDlpPath(managedDir, 'linux')}.download`)).toBe(false);
  });

  it('rejects a binary that reports the wrong version', async () => {
    const wrongBinary = '#!/bin/sh\necho 1999.01.01\n';
    routes[ASSET_URL] = () => stubResponse(wrongBinary);
    routes[CHECKSUM_URL] = () => stubResponse(checksumManifest(sha256(wrongBinary)));
    const updater = makeUpdater();

    const result = await updater.checkAndUpdate();

    expect(result.status).toBe('failed');
    expect(result.error).toContain('reported version');
    expect(fs.existsSync(getManagedYtDlpPath(managedDir, 'linux'))).toBe(false);
    expect(fs.existsSync(`${getManagedYtDlpPath(managedDir, 'linux')}.download`)).toBe(false);
  });

  it('fails cleanly when the release has no matching asset', async () => {
    routes[YTDLP_LATEST_RELEASE_URL] = () =>
      stubResponse(releaseJson({ assets: [{ name: 'SHA2-256SUMS', browser_download_url: CHECKSUM_URL }] }));
    const updater = makeUpdater();

    const result = await updater.checkAndUpdate();

    expect(result.status).toBe('failed');
    expect(result.error).toContain('yt-dlp_linux');
  });
});

describe('compareYtDlpVersions', () => {
  it('orders date-based versions', () => {
    expect(compareYtDlpVersions('2026.06.09', '2026.06.09')).toBe(0);
    expect(compareYtDlpVersions('2026.06.30', '2026.06.09')).toBe(1);
    expect(compareYtDlpVersions('2025.12.31', '2026.01.01')).toBe(-1);
  });

  it('treats hotfix suffixes as newer', () => {
    expect(compareYtDlpVersions('2026.06.09.1', '2026.06.09')).toBe(1);
    expect(compareYtDlpVersions('2026.06.09', '2026.06.09.1')).toBe(-1);
  });
});

describe('parseChecksumManifest', () => {
  const hash = sha256('content');

  it('finds the hash for the requested asset', () => {
    const manifest = `${sha256('other')}  yt-dlp.exe\n${hash}  yt-dlp_linux\n`;
    expect(parseChecksumManifest(manifest, 'yt-dlp_linux')).toBe(hash);
  });

  it('supports the binary-mode asterisk prefix', () => {
    expect(parseChecksumManifest(`${hash} *yt-dlp_linux\n`, 'yt-dlp_linux')).toBe(hash);
  });

  it('returns null for unknown assets', () => {
    expect(parseChecksumManifest(`${hash}  yt-dlp_linux\n`, 'yt-dlp_macos')).toBeNull();
  });
});

describe('managed path helpers', () => {
  it('places the managed dir under userData', () => {
    expect(getManagedYtDlpDir('/data')).toBe(path.join('/data', 'yt-dlp-updates'));
  });

  it('appends .exe on Windows only', () => {
    expect(getManagedYtDlpPath('/managed', 'win32')).toBe(path.join('/managed', 'yt-dlp.exe'));
    expect(getManagedYtDlpPath('/managed', 'darwin')).toBe(path.join('/managed', 'yt-dlp'));
  });

  it('reads only a valid installed version from updater state', () => {
    const managedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-state-test-'));
    try {
      fs.writeFileSync(path.join(managedDir, 'update-state.json'), JSON.stringify({ version: '2026.07.04' }));
      expect(readManagedYtDlpVersion(managedDir)).toBe('2026.07.04');

      fs.writeFileSync(path.join(managedDir, 'update-state.json'), JSON.stringify({ version: '../invalid' }));
      expect(readManagedYtDlpVersion(managedDir)).toBeNull();
    } finally {
      fs.rmSync(managedDir, { recursive: true, force: true });
    }
  });
});
