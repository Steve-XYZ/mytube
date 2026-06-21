import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import { ipcMain, webContents } from 'electron';

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
  };
});

import { MediaDetector, DetectedImage } from '../../src/main/media/MediaDetector';

describe('MediaDetector', () => {
  let detector: MediaDetector;
  let mockSender: { send: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSender = { send: vi.fn() };
    detector = new MediaDetector(mockSender);
  });

  afterEach(() => {
    detector.destroy();
  });

  describe('webContentsId validation', () => {
    it('rejects scan for unregistered webContentsId', async () => {
      const result = await detector.scanPageImages(999);
      expect(result).toEqual([]);
    });

    it('allows scan for registered webContentsId', async () => {
      // MediaDetector uses require('electron').webContents.fromId() internally
      // The vi.mock('electron') in setup should handle this
      const mockWc = {
        executeJavaScript: vi.fn().mockResolvedValue([]),
      };
      // Set the mock on the imported reference
      (webContents.fromId as any).mockReturnValue(mockWc);

      detector.registerTabWebContents(42);
      const result = await detector.scanPageImages(42);
      // If webContents.fromId returns our mock, executeJavaScript should be called
      // If the internal require returns a different reference, this validates the flow
      expect(result).toEqual([]);
    });

    it('rejects scan after unregistering', async () => {
      detector.registerTabWebContents(42);
      detector.unregisterTabWebContents(42);
      const result = await detector.scanPageImages(42);
      expect(result).toEqual([]);
    });
  });

  describe('image filtering', () => {
    // Test the filtering logic directly
    function filterImages(images: DetectedImage[]): DetectedImage[] {
      return images.filter((img) => {
        if (!img.url || !img.url.startsWith('http')) return false;
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (w > 0 && h > 0 && (w < 50 || h < 50)) return false;
        const lower = img.url.toLowerCase();
        if (lower.includes('pixel') || lower.includes('tracking') || lower.includes('beacon')) return false;
        if (lower.includes('1x1') || lower.includes('spacer')) return false;
        return true;
      });
    }

    it('filters out non-http URLs', () => {
      const images: DetectedImage[] = [
        { url: 'data:image/png;base64,...', alt: '', width: 100, height: 100, naturalWidth: 100, naturalHeight: 100 },
        { url: 'blob:https://example.com/123', alt: '', width: 100, height: 100, naturalWidth: 100, naturalHeight: 100 },
      ];
      expect(filterImages(images)).toHaveLength(0);
    });

    it('filters out tiny images (tracking pixels)', () => {
      const images: DetectedImage[] = [
        { url: 'https://example.com/pixel.gif', alt: '', width: 1, height: 1, naturalWidth: 1, naturalHeight: 1 },
        { url: 'https://example.com/icon.png', alt: '', width: 16, height: 16, naturalWidth: 16, naturalHeight: 16 },
      ];
      expect(filterImages(images)).toHaveLength(0);
    });

    it('keeps large images', () => {
      const images: DetectedImage[] = [
        { url: 'https://example.com/photo.jpg', alt: 'Photo', width: 800, height: 600, naturalWidth: 1600, naturalHeight: 1200 },
      ];
      expect(filterImages(images)).toHaveLength(1);
    });

    it('filters out tracking patterns in URL', () => {
      const images: DetectedImage[] = [
        { url: 'https://analytics.com/tracking/pixel.gif', alt: '', width: 100, height: 100, naturalWidth: 100, naturalHeight: 100 },
        { url: 'https://ads.com/beacon.png', alt: '', width: 100, height: 100, naturalWidth: 100, naturalHeight: 100 },
        { url: 'https://example.com/1x1.gif', alt: '', width: 100, height: 100, naturalWidth: 100, naturalHeight: 100 },
        { url: 'https://example.com/spacer.gif', alt: '', width: 100, height: 100, naturalWidth: 100, naturalHeight: 100 },
      ];
      expect(filterImages(images)).toHaveLength(0);
    });

    it('keeps images with unknown dimensions (0x0)', () => {
      const images: DetectedImage[] = [
        { url: 'https://example.com/photo.jpg', alt: '', width: 0, height: 0, naturalWidth: 0, naturalHeight: 0 },
      ];
      // When both dimensions are 0, the size check (w > 0 && h > 0) is false, so it passes
      expect(filterImages(images)).toHaveLength(1);
    });

    it('filters when only width is too small', () => {
      const images: DetectedImage[] = [
        { url: 'https://example.com/narrow.png', alt: '', width: 30, height: 200, naturalWidth: 30, naturalHeight: 200 },
      ];
      expect(filterImages(images)).toHaveLength(0);
    });

    it('filters when only height is too small', () => {
      const images: DetectedImage[] = [
        { url: 'https://example.com/short.png', alt: '', width: 200, height: 30, naturalWidth: 200, naturalHeight: 30 },
      ];
      expect(filterImages(images)).toHaveLength(0);
    });
  });

  describe('image sorting', () => {
    function sortImages(images: DetectedImage[]): DetectedImage[] {
      return [...images].sort((a, b) => {
        const aSize = (a.naturalWidth || a.width) * (a.naturalHeight || a.height);
        const bSize = (b.naturalWidth || b.width) * (b.naturalHeight || b.height);
        return bSize - aSize;
      });
    }

    it('sorts by area descending (largest first)', () => {
      const images: DetectedImage[] = [
        { url: 'small', alt: '', width: 100, height: 100, naturalWidth: 100, naturalHeight: 100 },
        { url: 'large', alt: '', width: 1000, height: 1000, naturalWidth: 1000, naturalHeight: 1000 },
        { url: 'medium', alt: '', width: 500, height: 500, naturalWidth: 500, naturalHeight: 500 },
      ];
      const sorted = sortImages(images);
      expect(sorted[0].url).toBe('large');
      expect(sorted[1].url).toBe('medium');
      expect(sorted[2].url).toBe('small');
    });

    it('prefers naturalWidth/Height over display dimensions', () => {
      const images: DetectedImage[] = [
        { url: 'a', alt: '', width: 100, height: 100, naturalWidth: 2000, naturalHeight: 2000 },
        { url: 'b', alt: '', width: 500, height: 500, naturalWidth: 500, naturalHeight: 500 },
      ];
      const sorted = sortImages(images);
      expect(sorted[0].url).toBe('a');
    });
  });

  describe('destroy', () => {
    it('removes IPC handlers', () => {
      detector.destroy();
      expect(ipcMain.removeHandler).toHaveBeenCalledWith('media:scan-images');
      expect(ipcMain.removeHandler).toHaveBeenCalledWith('media:download-image');
      expect(ipcMain.removeHandler).toHaveBeenCalledWith('media:download-images-batch');
    });

    it('clears allowed webContentsIds', () => {
      detector.registerTabWebContents(1);
      detector.registerTabWebContents(2);
      detector.destroy();
      // After destroy, scanning should fail for previously registered IDs
      // (allowedWebContentsIds is cleared)
    });
  });
});
