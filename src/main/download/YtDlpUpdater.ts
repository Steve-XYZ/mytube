import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { writeFileAtomic } from '../utils/fsAtomic';
import log from 'electron-log/main';

// Installed apps ship a yt-dlp snapshot, but YouTube changes frequently break
// old versions. This updater downloads the latest official release binary into
// a per-user managed directory (never into the packaged, code-signed bundle)
// and YtDlpController prefers that binary over the bundled one.

export const YTDLP_LATEST_RELEASE_URL = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';
export const YTDLP_CHECKSUM_ASSET = 'SHA2-256SUMS';

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MIN_CHECK_SPACING_MS = 20 * 60 * 60 * 1000;
const INITIAL_CHECK_DELAY_MS = 15_000;
const VERSION_PROBE_TIMEOUT_MS = 15_000;

export function getManagedYtDlpDir(userDataPath: string): string {
  return path.join(userDataPath, 'yt-dlp-updates');
}

export function getManagedYtDlpPath(managedDir: string, platform: NodeJS.Platform = process.platform): string {
  return path.join(managedDir, platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
}

/** Compare date-based yt-dlp versions like "2026.06.09" or "2026.06.09.1". */
export function compareYtDlpVersions(a: string, b: string): number {
  const partsA = a.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const partsB = b.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < length; i++) {
    const diff = (partsA[i] || 0) - (partsB[i] || 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface LatestRelease {
  tag_name?: string;
  assets?: ReleaseAsset[];
}

interface UpdaterState {
  version?: string;
  installedAt?: number;
  lastCheckAt?: number;
}

export type YtDlpUpdateStatus = 'updated' | 'up-to-date' | 'throttled' | 'failed';

export interface YtDlpUpdateResult {
  status: YtDlpUpdateStatus;
  version?: string;
  error?: string;
}

export interface YtDlpUpdaterOptions {
  managedDir: string;
  /** Effective version of the binary currently in use (managed or bundled). */
  currentVersionProvider: () => string | null;
  onUpdated?: (binaryPath: string, version: string) => void;
  fetchFn?: typeof fetch;
  platform?: NodeJS.Platform;
  minCheckSpacingMs?: number;
}

export class YtDlpUpdater {
  private managedDir: string;
  private currentVersionProvider: () => string | null;
  private onUpdated?: (binaryPath: string, version: string) => void;
  private fetchFn: typeof fetch;
  private platform: NodeJS.Platform;
  private minCheckSpacingMs: number;
  private initialTimer: ReturnType<typeof setTimeout> | null = null;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;

  constructor(options: YtDlpUpdaterOptions) {
    this.managedDir = options.managedDir;
    this.currentVersionProvider = options.currentVersionProvider;
    this.onUpdated = options.onUpdated;
    this.fetchFn = options.fetchFn ?? fetch;
    this.platform = options.platform ?? process.platform;
    this.minCheckSpacingMs = options.minCheckSpacingMs ?? DEFAULT_MIN_CHECK_SPACING_MS;
  }

  /** Check shortly after launch, then daily while the app runs. */
  start(): void {
    if (this.initialTimer || this.intervalTimer) return;
    this.initialTimer = setTimeout(() => void this.checkAndUpdate(), INITIAL_CHECK_DELAY_MS);
    this.intervalTimer = setInterval(() => void this.checkAndUpdate(), CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.initialTimer) {
      clearTimeout(this.initialTimer);
      this.initialTimer = null;
    }
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  async checkAndUpdate(force = false): Promise<YtDlpUpdateResult> {
    if (this.inFlight) {
      return { status: 'throttled' };
    }

    const state = this.readState();
    if (!force && state.lastCheckAt && Date.now() - state.lastCheckAt < this.minCheckSpacingMs) {
      return { status: 'throttled' };
    }

    this.inFlight = true;
    try {
      return await this.performCheck(state);
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      log.warn(`yt-dlp update check failed: ${error}`);
      return { status: 'failed', error };
    } finally {
      this.inFlight = false;
    }
  }

  private async performCheck(state: UpdaterState): Promise<YtDlpUpdateResult> {
    const release = (await this.fetchJson(YTDLP_LATEST_RELEASE_URL)) as LatestRelease;
    const latestVersion = (release.tag_name || '').trim();
    if (!latestVersion) {
      throw new Error('latest release feed did not contain a version tag');
    }

    this.writeState({ ...state, lastCheckAt: Date.now() });

    const currentVersion = this.currentVersionProvider();
    if (currentVersion && compareYtDlpVersions(latestVersion, currentVersion) <= 0) {
      log.info(`yt-dlp is up to date (${currentVersion})`);
      return { status: 'up-to-date', version: currentVersion };
    }

    const assetName = this.assetName();
    const asset = release.assets?.find((candidate) => candidate.name === assetName);
    if (!asset) {
      throw new Error(`release has no asset named ${assetName}`);
    }
    const checksumAsset = release.assets?.find((candidate) => candidate.name === YTDLP_CHECKSUM_ASSET);
    if (!checksumAsset) {
      throw new Error(`release has no ${YTDLP_CHECKSUM_ASSET} checksum manifest`);
    }

    log.info(`Updating yt-dlp ${currentVersion || '(none)'} -> ${latestVersion}`);
    const [binary, checksums] = await Promise.all([
      this.fetchBuffer(asset.browser_download_url),
      this.fetchText(checksumAsset.browser_download_url),
    ]);

    const expectedHash = parseChecksumManifest(checksums, assetName);
    if (!expectedHash) {
      throw new Error(`checksum manifest has no entry for ${assetName}`);
    }
    const actualHash = createHash('sha256').update(binary).digest('hex');
    if (actualHash !== expectedHash.toLowerCase()) {
      throw new Error(`checksum mismatch for ${assetName} (expected ${expectedHash}, got ${actualHash})`);
    }

    const finalPath = getManagedYtDlpPath(this.managedDir, this.platform);
    const stagingPath = `${finalPath}.download`;
    fs.mkdirSync(this.managedDir, { recursive: true });

    try {
      fs.writeFileSync(stagingPath, binary);
      fs.chmodSync(stagingPath, 0o755);

      const probedVersion = this.probeBinaryVersion(stagingPath);
      if (probedVersion !== latestVersion) {
        throw new Error(
          `downloaded binary reported version "${probedVersion ?? 'unknown'}" instead of "${latestVersion}"`,
        );
      }

      fs.renameSync(stagingPath, finalPath);
    } catch (err) {
      fs.rmSync(stagingPath, { force: true });
      throw err;
    }

    this.writeState({ version: latestVersion, installedAt: Date.now(), lastCheckAt: Date.now() });
    log.info(`yt-dlp updated to ${latestVersion}: ${finalPath}`);
    this.onUpdated?.(finalPath, latestVersion);
    return { status: 'updated', version: latestVersion };
  }

  private assetName(): string {
    switch (this.platform) {
      case 'darwin':
        return 'yt-dlp_macos';
      case 'win32':
        return 'yt-dlp.exe';
      default:
        return 'yt-dlp_linux';
    }
  }

  private probeBinaryVersion(binaryPath: string): string | null {
    const result = spawnSync(binaryPath, ['--version'], {
      encoding: 'utf8',
      timeout: VERSION_PROBE_TIMEOUT_MS,
    });
    if (result.error || result.status !== 0) return null;
    return result.stdout.trim() || null;
  }

  private stateFilePath(): string {
    return path.join(this.managedDir, 'update-state.json');
  }

  private readState(): UpdaterState {
    try {
      const raw = fs.readFileSync(this.stateFilePath(), 'utf-8');
      const parsed = JSON.parse(raw) as UpdaterState;
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  }

  private writeState(state: UpdaterState): void {
    try {
      writeFileAtomic(this.stateFilePath(), JSON.stringify(state, null, 2));
    } catch (err: unknown) {
      log.warn('Failed to persist yt-dlp updater state:', err instanceof Error ? err.message : String(err));
    }
  }

  private async fetchResponse(url: string): Promise<Response> {
    const response = await this.fetchFn(url, {
      headers: {
        'User-Agent': 'MyTube',
        Accept: 'application/octet-stream, application/vnd.github+json, text/plain',
      },
      redirect: 'follow',
    });
    if (!response.ok) {
      throw new Error(`request failed (${response.status}) for ${url}`);
    }
    return response;
  }

  private async fetchJson(url: string): Promise<unknown> {
    return (await this.fetchResponse(url)).json();
  }

  private async fetchText(url: string): Promise<string> {
    return (await this.fetchResponse(url)).text();
  }

  private async fetchBuffer(url: string): Promise<Buffer> {
    return Buffer.from(await (await this.fetchResponse(url)).arrayBuffer());
  }
}

/** Parse a `<sha256>  <filename>` manifest and return the hash for the asset. */
export function parseChecksumManifest(manifest: string, assetName: string): string | null {
  for (const line of manifest.split('\n')) {
    const match = line.trim().match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (match && match[2].trim() === assetName) {
      return match[1];
    }
  }
  return null;
}
