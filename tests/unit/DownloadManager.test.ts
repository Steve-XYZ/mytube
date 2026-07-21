import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import { ipcMain, Notification } from 'electron';

// Mock child_process before importing DownloadManager
vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
    pid: 12345,
  })),
  spawnSync: vi.fn(() => ({
    status: 0,
    stdout: '2026.01.01\n',
    stderr: '',
  })),
}));

// Mock fs for state persistence tests
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
    readFileSync: vi.fn(() => '[]'),
  };
});

import { DownloadManager } from '../../src/main/download/DownloadManager';
import type { DownloadStateStore } from '../../src/main/download/DownloadQueueStore';
import type { MediaFallbackProvider } from '../../src/main/download/MediaFallbackProvider';
import type { DownloadItem } from '../../src/shared/types';

class MemoryDownloadStateStore implements DownloadStateStore {
  items: DownloadItem[];

  constructor(items: DownloadItem[] = []) {
    this.items = structuredClone(items);
  }

  load(): DownloadItem[] {
    return structuredClone(this.items);
  }

  save(items: DownloadItem[]): void {
    this.items = structuredClone(items);
  }

  close(): void {}
}

describe('DownloadManager', () => {
  let manager: DownloadManager;
  let mockSender: { send: ReturnType<typeof vi.fn> };
  let stateStore: MemoryDownloadStateStore;

  beforeEach(() => {
    vi.clearAllMocks();
    (fs.existsSync as any).mockReturnValue(false);
    (fs.readFileSync as any).mockReturnValue('[]');
    vi.mocked(Notification.isSupported).mockReturnValue(false);
    mockSender = { send: vi.fn() };
    stateStore = new MemoryDownloadStateStore();
    manager = new DownloadManager(mockSender, undefined, undefined, stateStore);
  });

  afterEach(() => {
    manager.destroy();
  });

  function keepDownloadsPending(target: DownloadManager = manager): void {
    const controller = (
      target as unknown as {
        ytdlp: { download: (...args: unknown[]) => Promise<void> };
      }
    ).ytdlp;
    controller.download = vi.fn(async () => undefined);
  }

  describe('startDownload', () => {
    it('creates a download item with correct initial state', async () => {
      // Pass title to avoid yt-dlp call (which would timeout)
      const item = await manager.startDownload('https://youtube.com/watch?v=test', {
        title: 'Test Video',
      });
      expect(item.id).toBeDefined();
      expect(item.url).toBe('https://youtube.com/watch?v=test');
      expect(item.title).toBe('Test Video');
      expect(item.progress).toBe(0);
      expect(item.type).toBe('video');
    });

    it('sets audio type when audioOnly option is true', async () => {
      const item = await manager.startDownload('https://youtube.com/watch?v=test', {
        audioOnly: true,
        title: 'Audio Track',
      });
      expect(item.type).toBe('audio');
    });

    it('assigns unique IDs to each download', async () => {
      const item1 = await manager.startDownload('https://example.com/1', { title: 'A' });
      const item2 = await manager.startDownload('https://example.com/2', { title: 'B' });
      expect(item1.id).not.toBe(item2.id);
    });

    it('notifies renderer of new download', async () => {
      await manager.startDownload('https://youtube.com/watch?v=test', { title: 'Test' });
      expect(mockSender.send).toHaveBeenCalled();
    });

    it('stores the resolved target while retaining the source page for fallback context', async () => {
      const provider: MediaFallbackProvider = {
        resolveDownloadTarget: vi.fn(async (pageUrl: string) => ({
          pageUrl,
          url: 'https://www.instagram.com/reel/active123/',
          source: 'permalink',
        })),
        getMediaFallbackForPage: vi.fn(() => null),
      };
      const mgr = new DownloadManager(mockSender, undefined, provider, new MemoryDownloadStateStore());

      const item = await mgr.startDownload('https://www.instagram.com/explore/', { title: 'Active reel' });

      await vi.waitFor(() => expect(item.url).toBe('https://www.instagram.com/reel/active123/'));
      expect(item.sourcePageUrl).toBe('https://www.instagram.com/explore/');
      expect(provider.resolveDownloadTarget).toHaveBeenCalledWith('https://www.instagram.com/explore/');
      mgr.destroy();
    });

    it('does not persist a temporary resolved media URL', async () => {
      const pageUrl = 'https://example.com/watch/1';
      const provider: MediaFallbackProvider = {
        resolveDownloadTarget: vi.fn(async () => ({
          pageUrl,
          url: 'https://cdn.example.com/video.mp4?token=temporary',
          source: 'active-media',
        })),
        getMediaFallbackForPage: vi.fn(() => null),
      };
      const store = new MemoryDownloadStateStore();
      const mgr = new DownloadManager(mockSender, undefined, provider, store);
      keepDownloadsPending(mgr);

      const item = await mgr.startDownload(pageUrl, { title: 'Video' });
      await vi.waitFor(() => expect(item.url).toContain('token=temporary'));

      expect(store.items[0].url).toBe(pageUrl);
      expect(store.items[0].sourcePageUrl).toBe(pageUrl);
      mgr.destroy();
    });

    it('downloads the same target that was resolved for the metadata dialog', async () => {
      const pageUrl = 'https://www.instagram.com/explore/';
      const provider: MediaFallbackProvider = {
        resolveDownloadTarget: vi.fn(async () => ({
          pageUrl,
          url: 'https://www.instagram.com/reel/active123/',
          source: 'permalink',
        })),
        getMediaFallbackForPage: vi.fn(() => null),
      };
      const mgr = new DownloadManager(mockSender, undefined, provider, new MemoryDownloadStateStore());
      const controller = (mgr as unknown as { ytdlp: Record<string, unknown> }).ytdlp;
      controller.getVideoInfo = vi.fn(async (url: string) => ({
        id: 'active123',
        title: 'Active reel',
        url,
        formats: [],
      }));
      controller.simplifyVideoFormats = vi.fn(() => []);
      const handlers = (ipcMain as unknown as { _handlers: Map<string, (...args: unknown[]) => unknown> })._handlers;

      await handlers.get('media:get-info')?.({}, pageUrl);
      const item = await mgr.startDownload(pageUrl, { title: 'Active reel' });

      expect(item.url).toBe('https://www.instagram.com/reel/active123/');
      expect(provider.resolveDownloadTarget).toHaveBeenCalledTimes(1);
      mgr.destroy();
    });
  });

  describe('getDownloadList', () => {
    it('returns active queue items in FIFO order', async () => {
      keepDownloadsPending();
      manager.setMaxConcurrent(1);
      const first = await manager.startDownload('https://example.com/1', { title: 'First' });
      const second = await manager.startDownload('https://example.com/2', { title: 'Second' });
      const downloads = (manager as unknown as { downloads: Map<string, { createdAt: number }> }).downloads;
      downloads.get(first.id)!.createdAt = 1;
      downloads.get(second.id)!.createdAt = 2;

      const list = manager.getDownloadList();
      expect(list.map((item) => item.id)).toEqual([first.id, second.id]);
    });

    it('returns empty array when no downloads', () => {
      const list = manager.getDownloadList();
      expect(list).toEqual([]);
    });
  });

  describe('pauseDownload', () => {
    it('returns false for non-existent download', () => {
      expect(manager.pauseDownload('nonexistent')).toBe(false);
    });

    it('starts the next queued item after pausing the active download', async () => {
      keepDownloadsPending();
      manager.setMaxConcurrent(1);
      const first = await manager.startDownload('https://example.com/1', { title: 'First' });
      const second = await manager.startDownload('https://example.com/2', { title: 'Second' });

      expect(manager.pauseDownload(first.id)).toBe(true);

      await vi.waitFor(() =>
        expect(manager.getDownloadList().find((item) => item.id === second.id)?.status).toBe('downloading'),
      );
    });
  });

  describe('resumeDownload', () => {
    it('returns false for non-existent download', () => {
      expect(manager.resumeDownload('nonexistent')).toBe(false);
    });
  });

  describe('retryDownload', () => {
    it('returns false for non-existent download', () => {
      expect(manager.retryDownload('nonexistent')).toBe(false);
    });

    it('requeues a failed download and clears its error', async () => {
      let fail: ((error: string) => void) | undefined;
      const controller = (
        manager as unknown as {
          ytdlp: { download: (...args: unknown[]) => Promise<void> };
        }
      ).ytdlp;
      controller.download = vi.fn(async (...args: unknown[]) => {
        fail = args[5] as (error: string) => void;
      });
      const item = await manager.startDownload('https://example.com/1', { title: 'Test' });
      await vi.waitFor(() => expect(fail).toBeDefined());
      fail?.('Network failed');
      (manager as unknown as { maxConcurrent: number }).maxConcurrent = 0;

      const result = manager.retryDownload(item.id);

      expect(result).toBe(true);
      const retried = manager.getDownloadList().find((d) => d.id === item.id);
      expect(retried?.status).toBe('queued');
      expect(retried?.error).toBeUndefined();
      expect(retried?.progress).toBe(0);
    });

    it('re-resolves the source page before retrying an expired media target', async () => {
      const pageUrl = 'https://example.com/watch/1';
      const provider: MediaFallbackProvider = {
        resolveDownloadTarget: vi
          .fn()
          .mockResolvedValueOnce({ pageUrl, url: 'https://cdn.example.com/expired.mp4', source: 'active-media' })
          .mockResolvedValueOnce({ pageUrl, url: 'https://cdn.example.com/fresh.mp4', source: 'active-media' }),
        getMediaFallbackForPage: vi.fn(() => null),
      };
      const mgr = new DownloadManager(mockSender, undefined, provider, new MemoryDownloadStateStore());
      let fail: ((error: string) => void) | undefined;
      const controller = (
        mgr as unknown as {
          ytdlp: { download: (...args: unknown[]) => Promise<void> };
        }
      ).ytdlp;
      controller.download = vi.fn(async (...args: unknown[]) => {
        fail ??= args[5] as (error: string) => void;
      });
      const item = await mgr.startDownload(pageUrl, { title: 'Video' });
      await vi.waitFor(() => expect(fail).toBeDefined());
      fail?.('Expired URL');

      expect(mgr.retryDownload(item.id)).toBe(true);

      await vi.waitFor(() => expect(item.url).toBe('https://cdn.example.com/fresh.mp4'));
      expect(provider.resolveDownloadTarget).toHaveBeenCalledTimes(2);
      mgr.destroy();
    });
  });

  describe('cancelDownload', () => {
    it('returns false for non-existent download', () => {
      expect(manager.cancelDownload('nonexistent')).toBe(false);
    });

    it('marks a cancelled download distinctly from a failure', async () => {
      const item = await manager.startDownload('https://example.com/1', { title: 'Test' });
      const result = manager.cancelDownload(item.id);
      expect(result).toBe(true);

      const list = manager.getDownloadList();
      const cancelled = list.find((d) => d.id === item.id);
      expect(cancelled?.status).toBe('cancelled');
      expect(cancelled?.error).toBeUndefined();
    });

    it('ignores a late completion callback after cancellation', async () => {
      let complete: ((filePath: string) => void) | undefined;
      const controller = (
        manager as unknown as {
          ytdlp: { download: (...args: unknown[]) => Promise<void> };
        }
      ).ytdlp;
      controller.download = vi.fn(async (...args: unknown[]) => {
        complete = args[4] as (filePath: string) => void;
      });
      const item = await manager.startDownload('https://example.com/1', { title: 'Test' });
      await vi.waitFor(() => expect(complete).toBeDefined());

      manager.cancelDownload(item.id);
      complete?.('/tmp/late.mp4');

      expect(manager.getDownloadList().find((download) => download.id === item.id)?.status).toBe('cancelled');
    });
  });

  describe('setMaxConcurrent', () => {
    it('clamps to minimum of 1', () => {
      manager.setMaxConcurrent(0);
      manager.setMaxConcurrent(-5);
      // Should not throw
    });

    it('clamps to maximum of 10', () => {
      manager.setMaxConcurrent(100);
      // Should not throw
    });

    it('fills newly available slots immediately', async () => {
      keepDownloadsPending();
      manager.setMaxConcurrent(1);
      await manager.startDownload('https://example.com/1', { title: 'First' });
      await manager.startDownload('https://example.com/2', { title: 'Second' });
      await manager.startDownload('https://example.com/3', { title: 'Third' });

      manager.setMaxConcurrent(3);

      await vi.waitFor(() =>
        expect(manager.getDownloadList().filter((item) => item.status === 'downloading')).toHaveLength(3),
      );
    });
  });

  describe('queue controls', () => {
    it('pauses and resumes the whole queue without leaving a slot stalled', async () => {
      keepDownloadsPending();
      manager.setMaxConcurrent(1);
      await manager.startDownload('https://example.com/1', { title: 'First' });
      await manager.startDownload('https://example.com/2', { title: 'Second' });
      await manager.startDownload('https://example.com/3', { title: 'Third' });
      await vi.waitFor(() =>
        expect(manager.getDownloadList().some((item) => item.status === 'downloading')).toBe(true),
      );

      expect(manager.pauseAllDownloads()).toBe(3);
      expect(manager.getDownloadList().every((item) => item.status === 'paused')).toBe(true);

      manager.setMaxConcurrent(2);
      expect(manager.resumeAllDownloads()).toBe(3);
      await vi.waitFor(() =>
        expect(manager.getDownloadList().filter((item) => item.status === 'downloading')).toHaveLength(2),
      );
      expect(manager.getDownloadList().filter((item) => item.status === 'queued')).toHaveLength(1);
    });

    it('cancels waiting items without cancelling an active download', async () => {
      keepDownloadsPending();
      manager.setMaxConcurrent(1);
      const active = await manager.startDownload('https://example.com/1', { title: 'Active' });
      const waiting = await manager.startDownload('https://example.com/2', { title: 'Waiting' });
      await vi.waitFor(() =>
        expect(manager.getDownloadList().find((item) => item.id === active.id)?.status).toBe('downloading'),
      );

      expect(manager.cancelPendingDownloads()).toBe(1);

      expect(manager.getDownloadList().find((item) => item.id === active.id)?.status).toBe('downloading');
      expect(manager.getDownloadList().find((item) => item.id === waiting.id)?.status).toBe('cancelled');
    });

    it('reorders waiting items and updates their queue positions', async () => {
      keepDownloadsPending();
      manager.setMaxConcurrent(1);
      await manager.startDownload('https://example.com/1', { title: 'Active' });
      const second = await manager.startDownload('https://example.com/2', { title: 'Second' });
      const third = await manager.startDownload('https://example.com/3', { title: 'Third' });

      expect(manager.moveDownload(third.id, 'top')).toBe(true);

      const waiting = manager.getDownloadList().filter((item) => item.status === 'queued');
      expect(waiting.map((item) => item.id)).toEqual([third.id, second.id]);
      expect(waiting.map((item) => item.queuePosition)).toEqual([1, 2]);
    });
  });

  describe('state persistence', () => {
    it('loads state from the durable store on construction', () => {
      const store = new MemoryDownloadStateStore([
        {
          id: 'saved-1',
          url: 'https://example.com',
          title: 'Saved Video',
          filename: 'video.mp4',
          savePath: '/tmp/video.mp4',
          type: 'video',
          status: 'completed',
          progress: 100,
          createdAt: Date.now() - 10000,
        },
      ]);

      const mgr = new DownloadManager(mockSender, undefined, undefined, store);
      const list = mgr.getDownloadList();
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe('saved-1');
      expect(list[0].title).toBe('Saved Video');
      mgr.destroy();
    });

    it('handles a store read failure gracefully', () => {
      const brokenStore: DownloadStateStore = {
        load: () => {
          throw new Error('corrupted database');
        },
        save: () => undefined,
        close: () => undefined,
      };

      const mgr = new DownloadManager(mockSender, undefined, undefined, brokenStore);
      const list = mgr.getDownloadList();
      expect(list).toEqual([]);
      mgr.destroy();
    });

    it('handles an empty store', () => {
      const mgr = new DownloadManager(mockSender, undefined, undefined, new MemoryDownloadStateStore());
      expect(mgr.getDownloadList()).toEqual([]);
      mgr.destroy();
    });

    it('restores interrupted in-progress downloads as paused', () => {
      const store = new MemoryDownloadStateStore([
        {
          id: 'interrupted-1',
          url: 'https://example.com/video',
          title: 'Interrupted Video',
          filename: 'video.mp4',
          savePath: '',
          type: 'video',
          status: 'downloading',
          progress: 42,
          speed: '1 MiB/s',
          eta: '00:12',
          createdAt: Date.now() - 10000,
        },
      ]);

      const mgr = new DownloadManager(mockSender, undefined, undefined, store);
      const [restored] = mgr.getDownloadList();

      expect(restored.status).toBe('paused');
      expect(restored.id).toBe('interrupted-1');
      mgr.destroy();
    });

    it('automatically resumes downloads that were already queued', async () => {
      const store = new MemoryDownloadStateStore([
        {
          id: 'queued-1',
          url: 'https://example.com/video',
          title: 'Queued Video',
          filename: '',
          savePath: '',
          type: 'video',
          status: 'queued',
          progress: 0,
          createdAt: Date.now() - 10000,
        },
      ]);
      const mgr = new DownloadManager(mockSender, undefined, undefined, store);
      keepDownloadsPending(mgr);

      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(mgr.getDownloadList()[0].status).toBe('downloading');
      mgr.destroy();
    });
  });

  describe('destroy', () => {
    it('removes all IPC handlers', () => {
      manager.destroy();
      expect(ipcMain.removeHandler).toHaveBeenCalledWith('download:start');
      expect(ipcMain.removeHandler).toHaveBeenCalledWith('download:pause');
      expect(ipcMain.removeHandler).toHaveBeenCalledWith('download:resume');
      expect(ipcMain.removeHandler).toHaveBeenCalledWith('download:retry');
      expect(ipcMain.removeHandler).toHaveBeenCalledWith('download:cancel');
      expect(ipcMain.removeHandler).toHaveBeenCalledWith('download:pause-all');
      expect(ipcMain.removeHandler).toHaveBeenCalledWith('download:resume-all');
      expect(ipcMain.removeHandler).toHaveBeenCalledWith('download:cancel-pending');
      expect(ipcMain.removeHandler).toHaveBeenCalledWith('download:move');
      expect(ipcMain.removeHandler).toHaveBeenCalledWith('download:list');
      expect(ipcMain.removeHandler).toHaveBeenCalledWith('download:open-file');
      expect(ipcMain.removeHandler).toHaveBeenCalledWith('download:show-in-folder');
      expect(ipcMain.removeHandler).toHaveBeenCalledWith('download:remove');
      expect(ipcMain.removeHandler).toHaveBeenCalledWith('download:clear-completed');
    });
  });
});
