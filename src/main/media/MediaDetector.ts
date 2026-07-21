import { ipcMain } from 'electron';

import { ImageDownloader } from '../download/ImageDownloader';
import log from 'electron-log/main';

export interface DetectedImage {
  url: string;
  alt: string;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
}

type WebContentsSender = { send: (channel: string, ...args: unknown[]) => void };

export class MediaDetector {
  private imageDownloader: ImageDownloader;
  private appViewSender: WebContentsSender;
  private allowedWebContentsIds: Set<number> = new Set();

  constructor(appViewSender: WebContentsSender) {
    this.imageDownloader = new ImageDownloader();
    this.appViewSender = appViewSender;
    this.setupIpcHandlers();
  }

  registerTabWebContents(id: number): void {
    this.allowedWebContentsIds.add(id);
  }

  unregisterTabWebContents(id: number): void {
    this.allowedWebContentsIds.delete(id);
  }

  private setupIpcHandlers(): void {
    // Scan current page for images
    ipcMain.handle('media:scan-images', async (_event, tabWebContentsId: number) => {
      return this.scanPageImages(tabWebContentsId);
    });

    // Download a single image by URL
    ipcMain.handle('media:download-image', async (_event, url: string, referer?: string) => {
      return this.imageDownloader.downloadImage(url, { referer });
    });

    // Download multiple images
    ipcMain.handle(
      'media:download-images-batch',
      async (
        _event,
        images: Array<{ url: string; filename?: string }>,
        options?: { referer?: string; subDir?: string },
      ) => {
        const results = await this.imageDownloader.downloadBatch(images, options, (completed, total) => {
          this.appViewSender.send('media:batch-progress', { completed, total });
        });
        return results;
      },
    );

    ipcMain.handle('media:show-image-in-folder', (_event, filePath: string) => {
      if (typeof filePath !== 'string') return false;
      return this.imageDownloader.showInFolder(filePath);
    });
  }

  async scanPageImages(webContentsId: number): Promise<DetectedImage[]> {
    try {
      // Validate webContentsId belongs to a known tab
      if (!this.allowedWebContentsIds.has(webContentsId)) {
        log.warn(`Rejected scan request for unknown webContentsId: ${webContentsId}`);
        return [];
      }

      const { webContents } = require('electron');
      const wc = webContents.fromId(webContentsId);
      if (!wc) return [];

      // Scan in bounded batches so large pages never monopolize the renderer.
      const images: DetectedImage[] = await wc.executeJavaScript(`
        (async function() {
          const MAX_IMAGES = 500;
          const MAX_BACKGROUND_CANDIDATES = 1500;
          const BACKGROUND_BATCH_SIZE = 100;
          const images = [];
          const seen = new Set();

          // Collect <img> elements
          Array.from(document.images).slice(0, MAX_IMAGES).forEach(img => {
            const url = img.currentSrc || img.src;
            if (!url || url.startsWith('data:') || seen.has(url)) return;
            seen.add(url);

            images.push({
              url: url,
              alt: img.alt || '',
              width: img.offsetWidth || 0,
              height: img.offsetHeight || 0,
              naturalWidth: img.naturalWidth || 0,
              naturalHeight: img.naturalHeight || 0,
            });
          });

          // Backgrounds are expensive because they require computed styles.
          // Restrict the candidate set and yield between small batches.
          const backgroundCandidates = Array.from(document.querySelectorAll(
            'body, main, header, footer, section, article, aside, div, a, button, figure, [style*="background"]'
          )).slice(0, MAX_BACKGROUND_CANDIDATES);
          for (let start = 0; start < backgroundCandidates.length && images.length < MAX_IMAGES; start += BACKGROUND_BATCH_SIZE) {
            const batch = backgroundCandidates.slice(start, start + BACKGROUND_BATCH_SIZE);
            for (const el of batch) {
              if (el.offsetWidth === 0 || el.offsetHeight === 0) continue;
              const bg = getComputedStyle(el).backgroundImage;
              if (bg && bg !== 'none') {
                const match = bg.match(/url\\(["']?(https?:\\/\\/[^"')]+)["']?\\)/);
                if (match && !seen.has(match[1])) {
                  seen.add(match[1]);
                  images.push({
                    url: match[1],
                    alt: '',
                    width: el.offsetWidth || 0,
                    height: el.offsetHeight || 0,
                    naturalWidth: 0,
                    naturalHeight: 0,
                  });
                }
              }
            }
            await new Promise(resolve => setTimeout(resolve, 0));
          }

          // Collect <picture> <source> elements
          Array.from(document.querySelectorAll('picture source')).slice(0, MAX_IMAGES).forEach(source => {
            const srcset = source.srcset;
            if (srcset) {
              const urls = srcset.split(',').map(s => s.trim().split(' ')[0]);
              urls.forEach(url => {
                if (images.length < MAX_IMAGES && url && !url.startsWith('data:') && !seen.has(url)) {
                  seen.add(url);
                  images.push({
                    url: url,
                    alt: '',
                    width: 0,
                    height: 0,
                    naturalWidth: 0,
                    naturalHeight: 0,
                  });
                }
              });
            }
          });

          return images;
        })()
      `);

      // Filter: keep only meaningful images (not tiny icons/spacers)
      const filtered = images.filter((img) => {
        // Must have a valid URL
        if (!img.url || !img.url.startsWith('http')) return false;

        // Filter out tiny images (likely icons, spacers, tracking pixels)
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (w > 0 && h > 0 && (w < 50 || h < 50)) return false;

        // Filter out common tracking/ad patterns
        const lower = img.url.toLowerCase();
        if (lower.includes('pixel') || lower.includes('tracking') || lower.includes('beacon')) return false;
        if (lower.includes('1x1') || lower.includes('spacer')) return false;

        return true;
      });

      // Sort by size (largest first)
      filtered.sort((a, b) => {
        const aSize = (a.naturalWidth || a.width) * (a.naturalHeight || a.height);
        const bSize = (b.naturalWidth || b.width) * (b.naturalHeight || b.height);
        return bSize - aSize;
      });

      log.info(`Scanned page: found ${filtered.length} images (${images.length} total)`);
      return filtered;
    } catch (err: unknown) {
      log.error('Failed to scan page images:', err instanceof Error ? err.message : String(err));
      return [];
    }
  }

  getImageDownloader(): ImageDownloader {
    return this.imageDownloader;
  }

  destroy(): void {
    ipcMain.removeHandler('media:scan-images');
    ipcMain.removeHandler('media:download-image');
    ipcMain.removeHandler('media:download-images-batch');
    ipcMain.removeHandler('media:show-image-in-folder');
    this.allowedWebContentsIds.clear();
  }
}
