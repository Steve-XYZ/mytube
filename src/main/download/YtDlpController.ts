import { spawn, spawnSync, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { app, session, type Cookie } from 'electron';
import { VideoInfo, VideoFormat } from '../../shared/types';
import log from 'electron-log/main';
import { classifyMediaUrl } from './MediaUrlClassifier';
import { getManagedYtDlpDir, getManagedYtDlpPath, readManagedYtDlpVersion } from './YtDlpUpdater';

export interface DownloadOptions {
  formatId?: string;
  outputDir: string;
  outputTemplate?: string;
  audioOnly?: boolean;
  videoQuality?: 'best' | '1080p' | '720p' | '480p' | 'audio-only';
  videoFormat?: 'mp4' | 'mkv' | 'webm';
  audioFormat?: 'mp3' | 'm4a' | 'opus';
  speedLimitKbps?: number;
  httpHeaders?: Record<string, string>;
  refererUrl?: string;
  cookieSourceUrls?: string[];
}

export interface DownloadProgress {
  percent: number;
  totalSize: string;
  speed: string;
  eta: string;
  filename: string;
}

type ProgressCallback = (progress: DownloadProgress) => void;
type CompleteCallback = (filePath: string) => void;
type ErrorCallback = (error: string) => void;

interface YtDlpRawFormat {
  format_id?: string;
  ext?: string;
  resolution?: string;
  width?: number;
  height?: number;
  fps?: number;
  vcodec?: string;
  acodec?: string;
  filesize?: number;
  filesize_approx?: number;
}

interface YtDlpJson {
  id?: string;
  title?: string;
  description?: string;
  thumbnail?: string;
  duration?: number;
  uploader?: string;
  channel?: string;
  formats?: YtDlpRawFormat[];
}

interface YtDlpExecutionProfile {
  name: string;
  impersonate?: string;
  youtubeClient?: 'mweb';
  usePotProvider?: boolean;
  useYouTubeCookies?: boolean;
  useBrowserHeaders?: boolean;
}

interface YtDlpRequestContext {
  httpHeaders?: Record<string, string>;
  refererUrl?: string;
  cookieSourceUrls?: string[];
}

const DEFAULT_BROWSER_USER_AGENT = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${
  process.versions.chrome || '120.0.0.0'
} Safari/537.36`;
const VIDEO_INFO_CACHE_TTL_MS = 5 * 60 * 1000;
const METADATA_MAX_RUNTIME_MS = 10 * 60 * 1000;
const METADATA_IDLE_TIMEOUT_MS = 2 * 60 * 1000;

export class YtDlpController {
  private static videoInfoCache: Map<string, { info: VideoInfo; expiresAt: number }> = new Map();
  private static videoInfoRequests: Map<string, Promise<VideoInfo>> = new Map();
  private static ytdlpVersionCache: Map<string, string | null> = new Map();

  private ytdlpPath: string;
  private ffmpegPath: string;
  private activeProcesses: Map<string, ChildProcess> = new Map();
  private binariesAvailable: boolean = false;
  private nodeRuntimePath: string | null = null;
  private potProviderServerHome: string | null = null;
  private ytdlpVersion: string | null = null;

  constructor() {
    this.ytdlpPath = this.resolveBinaryPath('yt-dlp');
    this.ffmpegPath = this.resolveBinaryDir();
    this.nodeRuntimePath = this.resolveNodeRuntimePath();
    this.potProviderServerHome = this.resolvePotProviderServerHome();

    this.initializeYtDlpBinary();
    if (!fs.existsSync(path.join(this.ffmpegPath, `ffmpeg${process.platform === 'win32' ? '.exe' : ''}`))) {
      log.warn(`ffmpeg binary not found in: ${this.ffmpegPath}`);
    }

    log.info(`yt-dlp path: ${this.ytdlpPath} (exists: ${this.binariesAvailable})`);
    if (this.ytdlpVersion) {
      log.info(`yt-dlp version: ${this.ytdlpVersion}`);
    }
    log.info(`ffmpeg dir: ${this.ffmpegPath}`);
    if (this.nodeRuntimePath) {
      log.info(`yt-dlp JS runtime: ${this.nodeRuntimePath}`);
    }
    if (this.potProviderServerHome) {
      log.info(`yt-dlp YouTube PO token provider: ${this.potProviderServerHome}`);
    }
  }

  /**
   * Prefer a checksum-verified runtime update without synchronously launching
   * it on the main thread. The updater performs a slower background probe and
   * repairs a damaged managed binary. MYTUBE_BIN_DIR pins the binary for tests.
   */
  private initializeYtDlpBinary(): void {
    const bundledPath = this.resolveBinaryPath('yt-dlp');
    this.ytdlpPath = bundledPath;
    this.binariesAvailable = fs.existsSync(bundledPath);

    if (!process.env.MYTUBE_BIN_DIR) {
      const managedDir = getManagedYtDlpDir(app.getPath('userData'));
      const managedPath = getManagedYtDlpPath(managedDir);
      if (fs.existsSync(managedPath)) {
        const managedVersion = readManagedYtDlpVersion(managedDir) || this.detectYtDlpVersion(managedPath);
        if (managedVersion) {
          this.ytdlpPath = managedPath;
          this.binariesAvailable = true;
          this.ytdlpVersion = managedVersion;
          return;
        }
        log.warn(`Managed yt-dlp update at ${managedPath} has no valid state or version; using bundled binary`);
      }
    }

    if (!this.binariesAvailable) {
      log.error(`yt-dlp binary not found at: ${bundledPath}`);
      this.ytdlpVersion = null;
      return;
    }
    this.ytdlpVersion = this.detectYtDlpVersion(bundledPath);
  }

  /** Re-resolve the yt-dlp binary (called after a runtime update lands). */
  refreshYtDlpBinary(): void {
    this.initializeYtDlpBinary();
    log.info(`yt-dlp binary refreshed: ${this.ytdlpPath} (version: ${this.ytdlpVersion ?? 'unknown'})`);
  }

  getYtDlpVersion(): string | null {
    return this.ytdlpVersion;
  }

  /** Check if yt-dlp binary is available */
  isBinaryAvailable(): boolean {
    return this.binariesAvailable;
  }

  private resolveBinaryPath(name: string): string {
    const ext = process.platform === 'win32' ? '.exe' : '';
    return path.join(this.resolveBinaryDir(), `${name}${ext}`);
  }

  private resolveBinaryDir(): string {
    // Test support: point the app at stub/local media binaries.
    if (process.env.MYTUBE_BIN_DIR) {
      return process.env.MYTUBE_BIN_DIR;
    }

    // In production every platform/arch binary is flattened into resources/bin/.
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'bin');
    }

    // In development binaries are staged per platform/arch (bin/<os>/<arch>/) so
    // a single checkout can build every target. Resolve the host's folder.
    return path.join(app.getAppPath(), 'bin', this.getPlatformDir());
  }

  /**
   * Platform-independent resources (the PO-token provider server and yt-dlp
   * plugins) live in resources/bin/ when packaged and under bin/shared/ in dev.
   */
  private resolveSharedResourceDir(): string {
    if (process.env.MYTUBE_BIN_DIR) {
      return process.env.MYTUBE_BIN_DIR;
    }
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'bin');
    }
    return path.join(app.getAppPath(), 'bin', 'shared');
  }

  private getPlatformDir(): string {
    const os = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux';
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    return path.join(os, arch);
  }

  private resolveNodeRuntimePath(): string | null {
    if (app.isPackaged) {
      // Electron can run as its bundled Node.js runtime when this environment
      // variable is set. This keeps the packaged PO-token provider independent
      // from a system-wide Node.js installation.
      return process.execPath;
    }

    const pathDirs = (process.env.PATH || '').split(path.delimiter);
    const executable = process.platform === 'win32' ? 'node.exe' : 'node';

    for (const dir of pathDirs) {
      const candidate = path.join(dir, executable);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // Try next PATH entry.
      }
    }

    return null;
  }

  private detectYtDlpVersion(binaryPath: string): string | null {
    if (YtDlpController.ytdlpVersionCache.has(binaryPath)) {
      return YtDlpController.ytdlpVersionCache.get(binaryPath) || null;
    }

    const result = spawnSync(binaryPath, ['--version'], {
      encoding: 'utf8',
      timeout: 2000,
      env: this.getYtDlpEnvironment(),
    });

    if (result.error || result.status !== 0) {
      log.warn('Unable to detect yt-dlp version:', result.error?.message || result.stderr?.trim() || result.status);
      YtDlpController.ytdlpVersionCache.set(binaryPath, null);
      return null;
    }

    const version = result.stdout.trim() || null;
    YtDlpController.ytdlpVersionCache.set(binaryPath, version);
    return version;
  }

  private getYtDlpEnvironment(): NodeJS.ProcessEnv {
    if (!app.isPackaged) {
      return process.env;
    }

    return {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
    };
  }

  private resolvePotProviderServerHome(): string | null {
    const binDir = this.resolveSharedResourceDir();
    const serverHome = path.join(binDir, 'bgutil-ytdlp-pot-provider', 'server');
    const generateScript = path.join(serverHome, 'build', 'generate_once.js');
    const pluginScript = path.join(
      binDir,
      'yt-dlp-plugins',
      'bgutil-ytdlp-pot-provider',
      'yt_dlp_plugins',
      'extractor',
      'getpot_bgutil_script.py',
    );

    if (fs.existsSync(generateScript) && fs.existsSync(pluginScript)) {
      return serverHome;
    }

    return null;
  }

  /** Validate that a URL is safe to pass to yt-dlp */
  static validateUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  }

  /** Sanitize text from yt-dlp output to prevent XSS when displayed in renderer */
  static sanitizeText(text: string): string {
    if (!text || typeof text !== 'string') return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }

  async getVideoInfo(url: string): Promise<VideoInfo> {
    if (!YtDlpController.validateUrl(url)) {
      throw new Error('Invalid URL: only http and https URLs are supported');
    }
    if (!this.binariesAvailable) {
      throw new Error('yt-dlp binary not found. Please reinstall the application.');
    }

    const cacheKey = this.getInfoCacheKey(url);
    const cached = YtDlpController.videoInfoCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.info;
    }

    const inFlight = YtDlpController.videoInfoRequests.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const request = this.fetchVideoInfo(url).then((info) => {
      YtDlpController.videoInfoCache.set(cacheKey, {
        info,
        expiresAt: Date.now() + VIDEO_INFO_CACHE_TTL_MS,
      });
      return info;
    });

    YtDlpController.videoInfoRequests.set(cacheKey, request);

    try {
      return await request;
    } finally {
      YtDlpController.videoInfoRequests.delete(cacheKey);
    }
  }

  private async fetchVideoInfo(url: string): Promise<VideoInfo> {
    let output = '';
    let lastError: unknown;

    for (const profile of this.getExtractionProfiles(url)) {
      try {
        output = await this.execYtDlp(['--dump-json', '--no-playlist', '--no-warnings', url], url, profile);
        break;
      } catch (err: unknown) {
        if (profile.impersonate && lastError && this.isImpersonationUnavailable(this.getErrorMessage(err))) {
          break;
        }
        lastError = err;
        if (!this.shouldTryNextProfile(url, err, profile)) {
          break;
        }
        log.warn(`yt-dlp extraction profile "${profile.name}" failed; trying fallback profile`);
      }
    }

    if (!output) {
      throw new Error(this.getUserFacingExtractionError(lastError, url));
    }

    const data = JSON.parse(output) as YtDlpJson;

    const formats: VideoFormat[] = (data.formats || [])
      .filter((f): f is YtDlpRawFormat & { format_id: string; ext: string } => Boolean(f.format_id && f.ext))
      .map((f) => ({
        formatId: f.format_id,
        ext: f.ext,
        resolution: f.resolution || (f.height ? `${f.width}x${f.height}` : undefined),
        fps: f.fps,
        vcodec: f.vcodec === 'none' ? undefined : f.vcodec,
        acodec: f.acodec === 'none' ? undefined : f.acodec,
        filesize: f.filesize || f.filesize_approx,
        filesizeApprox: f.filesize_approx,
        label: this.buildFormatLabel(f),
        hasVideo: f.vcodec !== 'none' && !!f.vcodec,
        hasAudio: f.acodec !== 'none' && !!f.acodec,
      }));

    return {
      id: data.id || '',
      title: YtDlpController.sanitizeText(data.title || '') || 'Unknown',
      description: data.description,
      thumbnail: data.thumbnail,
      duration: data.duration,
      uploader: YtDlpController.sanitizeText(data.uploader || data.channel || ''),
      url,
      formats,
    };
  }

  async getSimplifiedFormats(url: string): Promise<VideoFormat[]> {
    const info = await this.getVideoInfo(url);
    return this.simplifyFormats(info.formats);
  }

  simplifyVideoFormats(formats: VideoFormat[]): VideoFormat[] {
    return this.simplifyFormats(formats);
  }

  async download(
    downloadId: string,
    url: string,
    options: DownloadOptions,
    onProgress: ProgressCallback,
    onComplete: CompleteCallback,
    onError: ErrorCallback,
  ): Promise<void> {
    if (!YtDlpController.validateUrl(url)) {
      onError('Invalid URL: only http and https URLs are supported');
      return;
    }
    if (!this.binariesAvailable) {
      onError('yt-dlp binary not found. Please reinstall the application.');
      return;
    }

    const baseArgs = this.buildDownloadArgs(url, options);
    const profiles = this.getDownloadProfiles(url, options);

    let lastError = 'Download failed';
    for (let i = 0; i < profiles.length; i++) {
      const profile = profiles[i];
      const isLastProfile = i === profiles.length - 1;
      const outcome = await this.attemptDownload(downloadId, baseArgs, url, options, profile, onProgress);

      if (outcome.status === 'completed') {
        onComplete(outcome.filename);
        return;
      }
      if (outcome.status === 'cancelled') {
        onError('Download cancelled');
        return;
      }

      if (profile.impersonate && lastError !== 'Download failed' && this.isImpersonationUnavailable(outcome.error)) {
        break;
      }
      lastError = outcome.error;
      if (!isLastProfile && this.shouldRetryDownloadWithNextProfile(url, outcome.error, profile)) {
        log.warn(`Download ${downloadId} profile "${profile.name}" failed; retrying with fallback profile`);
        continue;
      }
      break;
    }

    onError(lastError);
  }

  /** Build the format/output arguments shared by every download attempt. */
  private buildDownloadArgs(url: string, options: DownloadOptions): string[] {
    const args: string[] = ['--newline', '--no-playlist', '--no-warnings'];

    if (options.audioOnly || options.videoQuality === 'audio-only') {
      args.push('-x', '--audio-format', options.audioFormat || 'mp3', '--audio-quality', '0');
    } else if (options.formatId) {
      args.push('-f', options.formatId);
    } else {
      const mergeFormat = options.videoFormat || 'mp4';
      args.push('-f', this.buildQualitySelector(options.videoQuality, mergeFormat));
      args.push('--merge-output-format', mergeFormat);
    }

    const template = options.outputTemplate || '%(title)s [%(id)s].%(ext)s';
    args.push('-o', path.join(options.outputDir, template));
    args.push('--continue');
    if (options.speedLimitKbps && options.speedLimitKbps > 0) {
      args.push('--limit-rate', `${Math.floor(options.speedLimitKbps)}K`);
    }
    args.push(url);
    return args;
  }

  private buildQualitySelector(
    quality: DownloadOptions['videoQuality'] = 'best',
    mergeFormat: DownloadOptions['videoFormat'] = 'mp4',
  ): string {
    const maxHeight = quality && quality !== 'best' && quality !== 'audio-only' ? Number.parseInt(quality, 10) : 0;
    const heightFilter = maxHeight > 0 ? `[height<=${maxHeight}]` : '';

    if (mergeFormat === 'mp4') {
      return `bv*${heightFilter}[ext=mp4]+ba[ext=m4a]/b${heightFilter}[ext=mp4]/bv*${heightFilter}+ba/b${heightFilter}`;
    }

    return `bv*${heightFilter}+ba/b${heightFilter}`;
  }

  /** Run a single download attempt with one extraction profile. */
  private attemptDownload(
    downloadId: string,
    baseArgs: string[],
    url: string,
    options: DownloadOptions,
    profile: YtDlpExecutionProfile,
    onProgress: ProgressCallback,
  ): Promise<{ status: 'completed' | 'cancelled' | 'error'; filename: string; error: string }> {
    return new Promise((resolve) => {
      this.withCommonArgs(baseArgs, url, profile, options)
        .then(({ args: fullArgs, cleanup }) => {
          log.info(`Starting download ${downloadId} [${profile.name}]: yt-dlp ${this.getSafeArgsForLog(fullArgs)}`);

          const proc = spawn(this.ytdlpPath, fullArgs, {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: this.getYtDlpEnvironment(),
          });

          this.activeProcesses.set(downloadId, proc);
          let lastFilename = '';
          let stderrTail = '';

          proc.stdout?.on('data', (data: Buffer) => {
            const lines = data.toString().split('\n');
            for (const line of lines) {
              const progress = this.parseProgressLine(line);
              if (progress) {
                if (progress.filename) lastFilename = progress.filename;
                onProgress(progress);
              }

              // Detect destination/merge lines
              const destMatch = line.match(/\[(?:download|Merger)\].*?Destination:\s*(.+)/);
              if (destMatch) {
                lastFilename = destMatch[1].trim();
              }

              const mergeMatch = line.match(/\[Merger\]\s*Merging formats into "(.+?)"/);
              if (mergeMatch) {
                lastFilename = mergeMatch[1].trim();
              }

              // Already downloaded
              const alreadyMatch = line.match(/\[download\]\s*(.+?)\s*has already been downloaded/);
              if (alreadyMatch) {
                lastFilename = alreadyMatch[1].trim();
              }
            }
          });

          proc.stderr?.on('data', (data: Buffer) => {
            const msg = this.redactSensitiveTextForLog(data.toString().trim());
            if (msg) {
              stderrTail = `${stderrTail}\n${msg}`.slice(-2000);
              if (!msg.startsWith('WARNING')) {
                log.warn(`yt-dlp stderr [${downloadId}]: ${msg}`);
              }
            }
          });

          proc.on('close', (code) => {
            this.activeProcesses.delete(downloadId);
            cleanup();

            if (code === 0) {
              log.info(`Download ${downloadId} completed: ${lastFilename}`);
              resolve({ status: 'completed', filename: lastFilename, error: '' });
            } else if (code === null) {
              // Process was killed (cancelled)
              log.info(`Download ${downloadId} cancelled`);
              resolve({ status: 'cancelled', filename: lastFilename, error: 'Download cancelled' });
            } else {
              log.error(`Download ${downloadId} [${profile.name}] failed with code ${code}`);
              const detail = this.getUserFacingExtractionError(new Error(stderrTail.trim()), url);
              resolve({
                status: 'error',
                filename: lastFilename,
                error: detail || `Download failed (exit code ${code})`,
              });
            }
          });

          proc.on('error', (err: NodeJS.ErrnoException) => {
            this.activeProcesses.delete(downloadId);
            cleanup();
            log.error(`Download ${downloadId} process error:`, err);
            if (err.code === 'ENOENT') {
              this.binariesAvailable = false;
              resolve({
                status: 'error',
                filename: lastFilename,
                error: 'yt-dlp binary not found. Please reinstall the application.',
              });
            } else {
              resolve({ status: 'error', filename: lastFilename, error: `Failed to start download: ${err.message}` });
            }
          });
        })
        .catch((err: unknown) => {
          resolve({ status: 'error', filename: '', error: err instanceof Error ? err.message : String(err) });
        });
    });
  }

  cancel(downloadId: string): boolean {
    const proc = this.activeProcesses.get(downloadId);
    if (!proc) return false;
    proc.kill('SIGTERM');
    this.activeProcesses.delete(downloadId);
    return true;
  }

  cancelAll(): void {
    for (const [_id, proc] of this.activeProcesses) {
      proc.kill('SIGTERM');
    }
    this.activeProcesses.clear();
  }

  private async execYtDlp(args: string[], sourceUrl?: string, profile?: YtDlpExecutionProfile): Promise<string> {
    return new Promise((resolve, reject) => {
      this.withCommonArgs(args, sourceUrl, profile)
        .then(({ args: fullArgs, cleanup }) => {
          const proc = spawn(this.ytdlpPath, fullArgs, {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: this.getYtDlpEnvironment(),
          });

          let stdout = '';
          let stderr = '';
          let settled = false;

          let idleTimer: ReturnType<typeof setTimeout> | null = null;
          const maxRuntimeTimer = setTimeout(() => {
            proc.kill('SIGTERM');
            finish(() => reject(new Error('yt-dlp metadata extraction timed out after 10 minutes')));
          }, METADATA_MAX_RUNTIME_MS);

          const finish = (fn: () => void) => {
            if (settled) return;
            settled = true;
            clearTimeout(maxRuntimeTimer);
            if (idleTimer) clearTimeout(idleTimer);
            cleanup();
            fn();
          };

          const resetIdleTimer = () => {
            if (idleTimer) clearTimeout(idleTimer);
            idleTimer = setTimeout(() => {
              proc.kill('SIGTERM');
              finish(() => reject(new Error('yt-dlp metadata extraction stalled with no output for 2 minutes')));
            }, METADATA_IDLE_TIMEOUT_MS);
          };

          resetIdleTimer();

          proc.stdout?.on('data', (data: Buffer) => {
            stdout += data.toString();
            resetIdleTimer();
          });

          proc.stderr?.on('data', (data: Buffer) => {
            stderr += this.redactSensitiveTextForLog(data.toString());
            resetIdleTimer();
          });

          proc.on('close', (code) => {
            if (code === 0) {
              finish(() => resolve(stdout.trim()));
            } else {
              finish(() => reject(new Error(`yt-dlp exited with code ${code}: ${stderr.trim()}`)));
            }
          });

          proc.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'ENOENT') {
              this.binariesAvailable = false;
              finish(() => reject(new Error('yt-dlp binary not found. Please reinstall the application.')));
            } else {
              finish(() => reject(new Error(`Failed to execute yt-dlp: ${err.message}`)));
            }
          });
        })
        .catch((err: unknown) => {
          reject(err instanceof Error ? err : new Error(String(err)));
        });
    });
  }

  private async withCommonArgs(
    args: string[],
    sourceUrl?: string,
    profile: YtDlpExecutionProfile = { name: 'default' },
    requestContext: YtDlpRequestContext = {},
  ): Promise<{ args: string[]; cleanup: () => void }> {
    const commonArgs = [
      '--ffmpeg-location',
      this.ffmpegPath,
      '--socket-timeout',
      '30',
      '--retries',
      '10',
      '--fragment-retries',
      '10',
      '--retry-sleep',
      'http:exp=1:20',
      '--retry-sleep',
      'fragment:exp=1:20',
    ];
    const cleanupCallbacks: Array<() => void> = [];
    const isYouTube = sourceUrl ? this.isYouTubeUrl(sourceUrl) : false;

    if (this.nodeRuntimePath) {
      commonArgs.push('--js-runtimes', `node:${this.nodeRuntimePath}`);
    }
    if (profile.impersonate) {
      commonArgs.push('--impersonate', profile.impersonate);
    }

    const headers = new Map<string, string>();
    const setHeader = (name: string, value?: string) => {
      if (!value) return;
      headers.set(name.toLowerCase(), `${this.formatHeaderName(name)}:${value}`);
    };

    if (sourceUrl && (isYouTube || profile.useBrowserHeaders)) {
      setHeader('User-Agent', DEFAULT_BROWSER_USER_AGENT);
      setHeader('Accept-Language', 'en-US,en;q=0.9');

      setHeader('Referer', requestContext.refererUrl || this.getRefererForUrl(sourceUrl) || undefined);
    }

    for (const [name, value] of Object.entries(requestContext.httpHeaders || {})) {
      if (this.isAllowedDownloadHeader(name)) {
        setHeader(name, value);
      }
    }

    for (const header of headers.values()) {
      commonArgs.push('--add-headers', header);
    }

    if (isYouTube) {
      if (profile.youtubeClient) {
        commonArgs.push('--extractor-args', `youtube:player_client=${profile.youtubeClient}`);
      }

      if (profile.usePotProvider && this.potProviderServerHome) {
        // Point yt-dlp at the bundled bgutil plugin explicitly. Auto-discovery only
        // searches next to the yt-dlp executable, which doesn't hold in the dev
        // layout (binary in bin/<os>/<arch>/, plugin in bin/shared/).
        commonArgs.push('--plugin-dirs', path.join(this.resolveSharedResourceDir(), 'yt-dlp-plugins'));
        commonArgs.push('--extractor-args', `youtubepot-bgutilscript:server_home=${this.potProviderServerHome}`);
      }
    }

    if (sourceUrl && (!isYouTube || profile.useYouTubeCookies)) {
      const cookieFilePath = await this.writeCookieFile([sourceUrl, ...(requestContext.cookieSourceUrls || [])]);
      if (cookieFilePath) {
        commonArgs.push('--cookies', cookieFilePath);
        cleanupCallbacks.push(() => fs.unlink(cookieFilePath, () => {}));
      }
    }

    return {
      args: [...commonArgs, ...args],
      cleanup: () => {
        for (const callback of cleanupCallbacks) {
          callback();
        }
      },
    };
  }

  private getExtractionProfiles(sourceUrl: string): YtDlpExecutionProfile[] {
    if (!this.isYouTubeUrl(sourceUrl)) {
      return [
        { name: 'browser-context', useBrowserHeaders: true },
        { name: 'browser-impersonated', useBrowserHeaders: true, impersonate: 'chrome' },
      ];
    }

    const profiles: YtDlpExecutionProfile[] = [
      {
        name: 'youtube-public',
        useYouTubeCookies: false,
        useBrowserHeaders: true,
      },
    ];

    if (this.potProviderServerHome) {
      profiles.push({
        name: 'youtube-mweb-pot',
        youtubeClient: 'mweb',
        usePotProvider: true,
        useYouTubeCookies: false,
        useBrowserHeaders: true,
      });
    }

    return profiles;
  }

  /**
   * Ordered profiles to try for a download. For a "best" YouTube download the
   * mweb+PO-token profile (full DASH formats, up to 4K) is tried first and the
   * public profile is kept as a fallback so the download degrades gracefully
   * (e.g. to 360p) instead of hard-failing if the preferred profile yields no
   * formats. A specific formatId came from the public extraction, so it uses the
   * public profile directly.
   */
  private getDownloadProfiles(sourceUrl: string, options: DownloadOptions): YtDlpExecutionProfile[] {
    if (!this.isYouTubeUrl(sourceUrl)) {
      return [
        { name: 'browser-context', useBrowserHeaders: true },
        { name: 'browser-impersonated', useBrowserHeaders: true, impersonate: 'chrome' },
      ];
    }

    const profiles: YtDlpExecutionProfile[] = [];
    if (!options.formatId && this.potProviderServerHome) {
      profiles.push({
        name: 'youtube-mweb-pot',
        youtubeClient: 'mweb',
        usePotProvider: true,
        useYouTubeCookies: false,
        useBrowserHeaders: true,
      });
    }
    profiles.push({ name: 'youtube-public', useYouTubeCookies: false, useBrowserHeaders: true });
    return profiles;
  }

  private shouldRetryDownloadWithNextProfile(
    sourceUrl: string,
    error: string,
    profile: YtDlpExecutionProfile,
  ): boolean {
    if (!this.isYouTubeUrl(sourceUrl)) {
      return !profile.impersonate && this.isAntiBotError(error);
    }

    // Only worth falling back from the mweb/PO-token profile; the public profile
    // is already the most permissive option.
    if (!this.isYouTubeUrl(sourceUrl) || !profile.usePotProvider) {
      return false;
    }
    return this.isRecoverableYouTubeDownloadError(error);
  }

  private isRecoverableYouTubeDownloadError(message: string): boolean {
    return (
      this.isYouTubeTokenOrBotError(message) ||
      /requested format is not available|only images are available|no video formats|unable to extract|nsig|n challenge/i.test(
        message,
      )
    );
  }

  private shouldTryNextProfile(sourceUrl: string, err: unknown, profile: YtDlpExecutionProfile): boolean {
    if (!this.isYouTubeUrl(sourceUrl)) {
      return !profile.impersonate && this.isAntiBotError(this.getErrorMessage(err));
    }

    if (!this.isYouTubeUrl(sourceUrl) || !this.potProviderServerHome || profile.usePotProvider) {
      return false;
    }

    return this.isYouTubeTokenOrBotError(this.getErrorMessage(err));
  }

  private getUserFacingExtractionError(err: unknown, sourceUrl: string): string {
    const message = this.getErrorMessage(err);
    const media = classifyMediaUrl(sourceUrl);

    if (!media.isMediaPage) {
      return media.reason || 'Open a specific video, post, reel, or track before downloading.';
    }

    if (this.isYouTubeUrl(sourceUrl) && this.isYouTubeTokenOrBotError(message)) {
      return [
        'YouTube blocked anonymous extraction for this network/session.',
        'MyTube avoids Google login inside Electron because Google marks embedded browsers as untrusted.',
        this.potProviderServerHome
          ? 'The PO-token fallback was available but YouTube still rejected this video.'
          : 'Run pnpm run setup to install the local YouTube PO-token provider, then retry.',
      ].join(' ');
    }

    if (this.isLoginOrCookieError(message)) {
      return [
        'This site requires a fresh logged-in browser session.',
        'Open the site in MyTube, sign in if needed, refresh the media page, and try again.',
      ].join(' ');
    }

    if (this.isAntiBotError(message)) {
      return [
        'This site blocked the downloader with an anti-bot or rate-limit challenge.',
        'Open the page in MyTube with the same network, complete any challenge, refresh the page, and retry.',
      ].join(' ');
    }

    if (this.isDrmError(message)) {
      return 'This media appears to be DRM-protected and cannot be downloaded by MyTube.';
    }

    if (this.isFfmpegError(message)) {
      return 'The download needs ffmpeg, but ffmpeg failed or is missing. Run pnpm run setup and retry.';
    }

    if (this.isExtractorDataError(message)) {
      const versionText = this.ytdlpVersion ? ` Bundled yt-dlp version: ${this.ytdlpVersion}.` : '';
      return [
        `${this.getPlatformLabel(sourceUrl)} changed its page format or this URL is not exposed as downloadable media.`,
        'Refresh yt-dlp with pnpm run setup, then retry with a direct media post URL.',
        versionText,
      ]
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    return this.stripYtDlpNoise(message);
  }

  private isYouTubeTokenOrBotError(message: string): boolean {
    return /sign in to confirm|not a bot|po token|http error 403|login_required/i.test(message);
  }

  private isLoginOrCookieError(message: string): boolean {
    return /login required|login_required|private video|private content|this video is private|sign in|not logged in|cookies/i.test(
      message,
    );
  }

  private isAntiBotError(message: string): boolean {
    return /captcha|cloudflare|too many requests|http error 429|http error 403|forbidden|blocked|not a bot/i.test(
      message,
    );
  }

  private isImpersonationUnavailable(message: string): boolean {
    return /impersonat(?:e|ion).*not available|no impersonate target|unsupported impersonation/i.test(message);
  }

  private isDrmError(message: string): boolean {
    return /drm|widevine|protected content|copyright protected/i.test(message);
  }

  private isFfmpegError(message: string): boolean {
    return /ffmpeg|ffprobe|postprocessing|merger/i.test(message);
  }

  private isExtractorDataError(message: string): boolean {
    return /unable to extract|please report this issue|unsupported url|no video formats|no media found|does not contain a video|requested format is not available/i.test(
      message,
    );
  }

  private stripYtDlpNoise(message: string): string {
    return message
      .replace(/^yt-dlp exited with code \d+:\s*/i, '')
      .replace(/^ERROR:\s*/i, '')
      .replace(/\s*please report this issue.*$/i, '')
      .trim();
  }

  private getPlatformLabel(sourceUrl: string): string {
    const platform = classifyMediaUrl(sourceUrl).platform;
    return platform === 'unknown' ? 'The site' : platform[0].toUpperCase() + platform.slice(1);
  }

  private getErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  private getInfoCacheKey(sourceUrl: string): string {
    try {
      const parsed = new URL(sourceUrl);
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return sourceUrl;
    }
  }

  private isYouTubeUrl(sourceUrl: string): boolean {
    try {
      const host = new URL(sourceUrl).hostname.replace(/^www\./, '');
      return host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com';
    } catch {
      return false;
    }
  }

  private getRefererForUrl(sourceUrl: string): string | null {
    try {
      const parsed = new URL(sourceUrl);
      if (this.isYouTubeUrl(sourceUrl)) {
        return 'https://www.youtube.com/';
      }

      return `${parsed.protocol}//${parsed.host}/`;
    } catch {
      return null;
    }
  }

  private isAllowedDownloadHeader(headerName: string): boolean {
    return ['user-agent', 'referer', 'origin', 'accept', 'accept-language'].includes(headerName.toLowerCase());
  }

  private formatHeaderName(headerName: string): string {
    return headerName
      .toLowerCase()
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('-');
  }

  private getSafeArgsForLog(args: string[]): string {
    return args
      .map((arg, index) => {
        if (args[index - 1] === '--cookies') {
          return '[cookies-file]';
        }

        if (YtDlpController.validateUrl(arg)) {
          return this.redactUrlForLog(arg);
        }

        const headerUrlMatch = arg.match(/^([^:]+:)(https?:\/\/.+)$/);
        if (headerUrlMatch) {
          return `${headerUrlMatch[1]}${this.redactUrlForLog(headerUrlMatch[2])}`;
        }

        return arg;
      })
      .join(' ');
  }

  private redactSensitiveTextForLog(text: string): string {
    return text
      .replace(/https?:\/\/[^\s'"<>]+/g, (url) => this.redactUrlForLog(url))
      .replace(/[^\s'"<>]*yt-dlp-cookies-[^\s'"<>]+\.txt/g, '[cookies-file]');
  }

  private redactUrlForLog(url: string): string {
    try {
      const parsed = new URL(url);
      if (parsed.search) {
        parsed.search = '?[redacted]';
      }
      return parsed.toString();
    } catch {
      return url;
    }
  }

  private async writeCookieFile(sourceUrls: string | string[]): Promise<string | null> {
    try {
      const urls = Array.isArray(sourceUrls) ? sourceUrls : [sourceUrls];
      const cookieMap = new Map<string, { cookie: Cookie; sourceUrl: string }>();

      for (const sourceUrl of urls) {
        const cookies = await session.defaultSession.cookies.get({ url: sourceUrl });
        for (const cookie of cookies) {
          cookieMap.set(`${cookie.domain || new URL(sourceUrl).hostname}\t${cookie.path || '/'}\t${cookie.name}`, {
            cookie,
            sourceUrl,
          });
        }
      }

      const cookieEntries = Array.from(cookieMap.values());
      if (!cookieEntries.length) return null;

      const filePath = path.join(app.getPath('userData'), `yt-dlp-cookies-${randomUUID()}.txt`);
      const lines = [
        '# Netscape HTTP Cookie File',
        '# Generated by MyTube for a local yt-dlp request.',
        ...cookieEntries.map(({ cookie, sourceUrl }) => this.formatCookie(cookie, sourceUrl)),
      ];
      fs.writeFileSync(filePath, `${lines.join('\n')}\n`, { mode: 0o600 });
      return filePath;
    } catch (err: unknown) {
      log.warn(
        'Could not export Electron session cookies for yt-dlp:',
        err instanceof Error ? err.message : String(err),
      );
      return null;
    }
  }

  private formatCookie(cookie: Cookie, sourceUrl: string): string {
    const sourceHost = new URL(sourceUrl).hostname;
    const rawDomain = cookie.domain || sourceHost;
    const domain = cookie.httpOnly ? `#HttpOnly_${rawDomain}` : rawDomain;
    const includeSubdomains = rawDomain.startsWith('.') ? 'TRUE' : 'FALSE';
    const pathName = cookie.path || '/';
    const secure = cookie.secure ? 'TRUE' : 'FALSE';
    const expires = Math.floor(cookie.expirationDate || 0);
    return [domain, includeSubdomains, pathName, secure, expires, cookie.name, cookie.value].join('\t');
  }

  private parseProgressLine(line: string): DownloadProgress | null {
    // [download]  45.2% of  150.00MiB at    5.00MiB/s ETA 00:16
    // [download] 100% of  150.00MiB in 00:30
    const match = line.match(
      /\[download\]\s+([\d.]+)%\s+of\s+~?([\d.]+\w+)\s+(?:at\s+([\d.]+\w+\/s)\s+ETA\s+(\S+)|in\s+\S+)/,
    );

    if (match) {
      return {
        percent: parseFloat(match[1]),
        totalSize: match[2] || '',
        speed: match[3] || '',
        eta: match[4] || '00:00',
        filename: '',
      };
    }

    // Simple percentage line
    const simpleMatch = line.match(/\[download\]\s+([\d.]+)%/);
    if (simpleMatch) {
      return {
        percent: parseFloat(simpleMatch[1]),
        totalSize: '',
        speed: '',
        eta: '',
        filename: '',
      };
    }

    return null;
  }

  private buildFormatLabel(f: YtDlpRawFormat): string {
    const parts: string[] = [];

    if (f.height) {
      parts.push(`${f.height}p`);
    } else if (f.resolution && f.resolution !== 'audio only') {
      parts.push(f.resolution);
    }

    if (f.fps && f.fps > 30) {
      parts.push(`${f.fps}fps`);
    }

    if (f.vcodec && f.vcodec !== 'none') {
      const codec = f.vcodec.split('.')[0];
      parts.push(codec);
    }

    if (f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none')) {
      parts.push(f.acodec.split('.')[0]);
    }

    parts.push(f.ext || 'unknown');

    const size = f.filesize || f.filesize_approx;
    if (size) {
      parts.push(this.formatBytes(size));
    }

    if (f.vcodec === 'none' && f.acodec && f.acodec !== 'none') {
      return `Audio: ${parts.join(' - ')}`;
    }

    return parts.join(' - ');
  }

  /** Reduce the raw format list to user-friendly presets */
  private simplifyFormats(formats: VideoFormat[]): VideoFormat[] {
    const result: VideoFormat[] = [];
    const seenResolutions = new Set<string>();

    // Video+audio combined or best video for each resolution
    const videoFormats = formats
      .filter((f) => f.hasVideo)
      .sort((a, b) => {
        const aRes = this.extractHeight(a.resolution);
        const bRes = this.extractHeight(b.resolution);
        return bRes - aRes;
      });

    for (const f of videoFormats) {
      const height = this.extractHeight(f.resolution);
      const key = `${height}p`;
      if (height > 0 && !seenResolutions.has(key)) {
        seenResolutions.add(key);
        result.push({
          ...f,
          label: `${key}${f.fps && f.fps > 30 ? ` ${f.fps}fps` : ''} (${f.ext})`,
        });
      }
    }

    // Best audio-only
    const audioFormats = formats
      .filter((f) => f.hasAudio && !f.hasVideo)
      .sort((a, b) => (b.filesize || 0) - (a.filesize || 0));

    if (audioFormats.length > 0) {
      const best = audioFormats[0];
      result.push({
        ...best,
        label: `Audio only (${best.ext}${best.filesize ? ' - ' + this.formatBytes(best.filesize) : ''})`,
      });
    }

    return result;
  }

  private extractHeight(resolution?: string): number {
    if (!resolution) return 0;
    const match = resolution.match(/(\d+)/);
    return match ? parseInt(match[1]) : 0;
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
  }
}
