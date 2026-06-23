import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { app, session, type Cookie } from 'electron';
import { VideoInfo, VideoFormat } from '../../shared/types';
import log from 'electron-log/main';

export interface DownloadOptions {
  formatId?: string;
  outputDir: string;
  outputTemplate?: string;
  audioOnly?: boolean;
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
  youtubeClient?: 'mweb';
  usePotProvider?: boolean;
  useYouTubeCookies?: boolean;
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

  private ytdlpPath: string;
  private ffmpegPath: string;
  private activeProcesses: Map<string, ChildProcess> = new Map();
  private binariesAvailable: boolean = false;
  private nodeRuntimePath: string | null = null;
  private potProviderServerHome: string | null = null;

  constructor() {
    this.ytdlpPath = this.resolveBinaryPath('yt-dlp');
    this.ffmpegPath = this.resolveBinaryDir();
    this.nodeRuntimePath = this.resolveNodeRuntimePath();
    this.potProviderServerHome = this.resolvePotProviderServerHome();

    // Verify binaries exist at startup
    this.binariesAvailable = fs.existsSync(this.ytdlpPath);
    if (!this.binariesAvailable) {
      log.error(`yt-dlp binary not found at: ${this.ytdlpPath}`);
    }
    if (!fs.existsSync(path.join(this.ffmpegPath, `ffmpeg${process.platform === 'win32' ? '.exe' : ''}`))) {
      log.warn(`ffmpeg binary not found in: ${this.ffmpegPath}`);
    }

    log.info(`yt-dlp path: ${this.ytdlpPath} (exists: ${this.binariesAvailable})`);
    log.info(`ffmpeg dir: ${this.ffmpegPath}`);
    if (this.nodeRuntimePath) {
      log.info(`yt-dlp JS runtime: ${this.nodeRuntimePath}`);
    }
    if (this.potProviderServerHome) {
      log.info(`yt-dlp YouTube PO token provider: ${this.potProviderServerHome}`);
    }
  }

  /** Check if yt-dlp binary is available */
  isBinaryAvailable(): boolean {
    return this.binariesAvailable;
  }

  private resolveBinaryPath(name: string): string {
    const ext = process.platform === 'win32' ? '.exe' : '';
    const binaryName = `${name}${ext}`;

    // In production: binaries are in resources/bin/
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'bin', binaryName);
    }

    // In development: binaries are in project root bin/
    return path.join(app.getAppPath(), 'bin', binaryName);
  }

  private resolveBinaryDir(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'bin');
    }
    return path.join(app.getAppPath(), 'bin');
  }

  private resolveNodeRuntimePath(): string | null {
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

  private resolvePotProviderServerHome(): string | null {
    const binDir = this.resolveBinaryDir();
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

    const args: string[] = ['--newline', '--no-playlist', '--no-warnings'];

    // Format selection
    if (options.audioOnly) {
      args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
    } else if (options.formatId) {
      args.push('-f', options.formatId);
    } else {
      // Best video+audio merged into mp4
      args.push('-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b');
      args.push('--merge-output-format', 'mp4');
    }

    // Output template
    const template = options.outputTemplate || '%(title)s [%(id)s].%(ext)s';
    const outputPath = path.join(options.outputDir, template);
    args.push('-o', outputPath);

    // Continue partial downloads
    args.push('--continue');

    // Add URL
    args.push(url);

    const profile = this.getDownloadProfile(url, options);
    let fullArgs: string[];
    let cleanup: () => void;
    try {
      ({ args: fullArgs, cleanup } = await this.withCommonArgs(args, url, profile));
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : String(err));
      return;
    }

    log.info(`Starting download ${downloadId}: yt-dlp ${fullArgs.join(' ')}`);

    const proc = spawn(this.ytdlpPath, fullArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.activeProcesses.set(downloadId, proc);
    let lastFilename = '';

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
      const msg = data.toString().trim();
      if (msg && !msg.startsWith('WARNING')) {
        log.warn(`yt-dlp stderr [${downloadId}]: ${msg}`);
      }
    });

    proc.on('close', (code) => {
      this.activeProcesses.delete(downloadId);
      cleanup();

      if (code === 0) {
        log.info(`Download ${downloadId} completed: ${lastFilename}`);
        onComplete(lastFilename);
      } else if (code === null) {
        // Process was killed (cancelled)
        log.info(`Download ${downloadId} cancelled`);
        onError('Download cancelled');
      } else {
        log.error(`Download ${downloadId} failed with code ${code}`);
        onError(`Download failed (exit code ${code})`);
      }
    });

    proc.on('error', (err: NodeJS.ErrnoException) => {
      this.activeProcesses.delete(downloadId);
      cleanup();
      log.error(`Download ${downloadId} process error:`, err);
      if (err.code === 'ENOENT') {
        this.binariesAvailable = false;
        onError('yt-dlp binary not found. Please reinstall the application.');
      } else {
        onError(`Failed to start download: ${err.message}`);
      }
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
            stderr += data.toString();
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

    if (isYouTube) {
      commonArgs.push(
        '--add-headers',
        `User-Agent:${DEFAULT_BROWSER_USER_AGENT}`,
        '--add-headers',
        'Accept-Language:en-US,en;q=0.9',
        '--add-headers',
        'Referer:https://www.youtube.com/',
      );

      if (profile.youtubeClient) {
        commonArgs.push('--extractor-args', `youtube:player_client=${profile.youtubeClient}`);
      }

      if (profile.usePotProvider && this.potProviderServerHome) {
        commonArgs.push('--extractor-args', `youtubepot-bgutilscript:server_home=${this.potProviderServerHome}`);
      }
    }

    if (sourceUrl && (!isYouTube || profile.useYouTubeCookies)) {
      const cookieFilePath = await this.writeCookieFile(sourceUrl);
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
      return [{ name: 'default' }];
    }

    const profiles: YtDlpExecutionProfile[] = [
      {
        name: 'youtube-public',
        useYouTubeCookies: false,
      },
    ];

    if (this.potProviderServerHome) {
      profiles.push({
        name: 'youtube-mweb-pot',
        youtubeClient: 'mweb',
        usePotProvider: true,
        useYouTubeCookies: false,
      });
    }

    return profiles;
  }

  private getDownloadProfile(sourceUrl: string, options: DownloadOptions): YtDlpExecutionProfile {
    if (!this.isYouTubeUrl(sourceUrl) || options.formatId || !this.potProviderServerHome) {
      return {
        name: this.isYouTubeUrl(sourceUrl) ? 'youtube-public' : 'default',
        useYouTubeCookies: false,
      };
    }

    return {
      name: 'youtube-mweb-pot',
      youtubeClient: 'mweb',
      usePotProvider: true,
      useYouTubeCookies: false,
    };
  }

  private shouldTryNextProfile(sourceUrl: string, err: unknown, profile: YtDlpExecutionProfile): boolean {
    if (!this.isYouTubeUrl(sourceUrl) || !this.potProviderServerHome || profile.usePotProvider) {
      return false;
    }

    return this.isYouTubeTokenOrBotError(this.getErrorMessage(err));
  }

  private getUserFacingExtractionError(err: unknown, sourceUrl: string): string {
    const message = this.getErrorMessage(err);
    if (this.isYouTubeUrl(sourceUrl) && this.isYouTubeTokenOrBotError(message)) {
      return [
        'YouTube blocked anonymous extraction for this network/session.',
        'MyTube avoids Google login inside Electron because Google marks embedded browsers as untrusted.',
        this.potProviderServerHome
          ? 'The PO-token fallback was available but YouTube still rejected this video.'
          : 'Run pnpm run setup to install the local YouTube PO-token provider, then retry.',
      ].join(' ');
    }

    return message;
  }

  private isYouTubeTokenOrBotError(message: string): boolean {
    return /sign in to confirm|not a bot|po token|http error 403|login_required/i.test(message);
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

  private async writeCookieFile(sourceUrl: string): Promise<string | null> {
    try {
      const cookies = await session.defaultSession.cookies.get({ url: sourceUrl });
      if (!cookies.length) return null;

      const filePath = path.join(app.getPath('userData'), `yt-dlp-cookies-${randomUUID()}.txt`);
      const lines = [
        '# Netscape HTTP Cookie File',
        '# Generated by MyTube for a local yt-dlp request.',
        ...cookies.map((cookie) => this.formatCookie(cookie, sourceUrl)),
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
