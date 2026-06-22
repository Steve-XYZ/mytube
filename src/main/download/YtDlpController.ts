import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
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

export class YtDlpController {
  private ytdlpPath: string;
  private ffmpegPath: string;
  private activeProcesses: Map<string, ChildProcess> = new Map();
  private binariesAvailable: boolean = false;

  constructor() {
    this.ytdlpPath = this.resolveBinaryPath('yt-dlp');
    this.ffmpegPath = this.resolveBinaryDir();

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

    const output = await this.execYtDlp(['--dump-json', '--no-playlist', '--no-warnings', url]);

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

  download(
    downloadId: string,
    url: string,
    options: DownloadOptions,
    onProgress: ProgressCallback,
    onComplete: CompleteCallback,
    onError: ErrorCallback,
  ): void {
    if (!YtDlpController.validateUrl(url)) {
      onError('Invalid URL: only http and https URLs are supported');
      return;
    }
    if (!this.binariesAvailable) {
      onError('yt-dlp binary not found. Please reinstall the application.');
      return;
    }

    const args: string[] = ['--newline', '--no-playlist', '--ffmpeg-location', this.ffmpegPath, '--no-warnings'];

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

    log.info(`Starting download ${downloadId}: yt-dlp ${args.join(' ')}`);

    const proc = spawn(this.ytdlpPath, args, {
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

  private async execYtDlp(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const fullArgs = ['--ffmpeg-location', this.ffmpegPath, ...args];
      const proc = spawn(this.ytdlpPath, fullArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`yt-dlp exited with code ${code}: ${stderr.trim()}`));
        }
      });

      proc.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') {
          this.binariesAvailable = false;
          reject(new Error('yt-dlp binary not found. Please reinstall the application.'));
        } else {
          reject(new Error(`Failed to execute yt-dlp: ${err.message}`));
        }
      });

      // Timeout after 30 seconds for info queries
      setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error('yt-dlp timed out'));
      }, 30000);
    });
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
