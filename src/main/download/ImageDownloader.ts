import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { randomUUID } from 'crypto';
import log from 'electron-log/main';

export interface ImageDownloadResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

export class ImageDownloader {
  private defaultDir: string;

  constructor() {
    this.defaultDir = path.join(app.getPath('downloads'), 'MyTube', 'Images');
    if (!fs.existsSync(this.defaultDir)) {
      fs.mkdirSync(this.defaultDir, { recursive: true });
    }
  }

  async downloadImage(
    url: string,
    options?: {
      savePath?: string;
      referer?: string;
      filename?: string;
    },
  ): Promise<ImageDownloadResult> {
    try {
      const filename = this.sanitizeFilename(options?.filename || this.getFilenameFromUrl(url));
      let savePath = options?.savePath
        ? path.join(path.dirname(options.savePath), this.sanitizeFilename(path.basename(options.savePath)))
        : path.join(this.defaultDir, filename);

      // Prevent path traversal — ensure savePath stays under defaultDir
      const resolved = path.resolve(savePath);
      if (!resolved.startsWith(this.defaultDir)) {
        savePath = path.join(this.defaultDir, filename);
      }

      // Ensure unique filename
      const finalPath = this.ensureUniquePath(savePath);

      await this.httpDownload(url, finalPath, options?.referer);

      log.info(`Image downloaded: ${finalPath}`);
      return { success: true, filePath: finalPath };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Image download failed: ${url}`, message);
      return { success: false, error: message };
    }
  }

  async downloadBatch(
    images: Array<{ url: string; filename?: string }>,
    options?: { referer?: string; subDir?: string },
    onProgress?: (completed: number, total: number) => void,
  ): Promise<ImageDownloadResult[]> {
    const dir = options?.subDir ? path.join(this.defaultDir, this.sanitizeFilename(options.subDir)) : this.defaultDir;

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const results: ImageDownloadResult[] = [];
    const total = images.length;

    // Download in batches of 5 to avoid overwhelming the network
    const batchSize = 5;
    for (let i = 0; i < images.length; i += batchSize) {
      const batch = images.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((img) =>
          this.downloadImage(img.url, {
            savePath: path.join(dir, img.filename || this.getFilenameFromUrl(img.url)),
            referer: options?.referer,
          }),
        ),
      );
      results.push(...batchResults);
      onProgress?.(Math.min(i + batchSize, total), total);
    }

    return results;
  }

  setDefaultDir(dir: string): void {
    this.defaultDir = dir;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  getDefaultDir(): string {
    return this.defaultDir;
  }

  private httpDownload(url: string, destPath: string, referer?: string, redirectCount = 0): Promise<void> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      };
      if (referer) {
        headers['Referer'] = referer;
      }

      const client = url.startsWith('https') ? https : http;
      const request = client.get(url, { headers }, (response) => {
        // Handle redirects (max 5)
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          if (redirectCount >= 5) {
            reject(new Error('Too many redirects'));
            return;
          }
          this.httpDownload(response.headers.location, destPath, referer, redirectCount + 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (response.statusCode && response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }

        const dir = path.dirname(destPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        const file = fs.createWriteStream(destPath);
        response.pipe(file);

        file.on('finish', () => {
          file.close();
          resolve();
        });

        file.on('error', (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
      });

      request.on('error', (err) => {
        reject(err);
      });

      // Timeout after 30 seconds
      request.setTimeout(30000, () => {
        request.destroy();
        reject(new Error('Download timed out'));
      });
    });
  }

  private getFilenameFromUrl(url: string): string {
    try {
      const u = new URL(url);
      const pathname = u.pathname;
      const basename = path.basename(pathname);

      if (basename && basename.includes('.')) {
        return this.sanitizeFilename(basename);
      }

      // Generate filename from URL hash
      const ext = this.guessExtension(url);
      return `image_${randomUUID().slice(0, 8)}${ext}`;
    } catch {
      return `image_${randomUUID().slice(0, 8)}.jpg`;
    }
  }

  private guessExtension(url: string): string {
    const lower = url.toLowerCase();
    if (lower.includes('.png') || lower.includes('format=png')) return '.png';
    if (lower.includes('.gif')) return '.gif';
    if (lower.includes('.webp') || lower.includes('format=webp')) return '.webp';
    if (lower.includes('.svg')) return '.svg';
    if (lower.includes('.bmp')) return '.bmp';
    return '.jpg';
  }

  private sanitizeFilename(name: string): string {
    return (
      name
        // eslint-disable-next-line no-control-regex
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
        .replace(/\s+/g, '_')
        .slice(0, 200)
    );
  }

  private ensureUniquePath(filePath: string): string {
    if (!fs.existsSync(filePath)) return filePath;

    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext);

    let counter = 1;
    let newPath = filePath;
    while (fs.existsSync(newPath)) {
      newPath = path.join(dir, `${base} (${counter})${ext}`);
      counter++;
    }
    return newPath;
  }
}
