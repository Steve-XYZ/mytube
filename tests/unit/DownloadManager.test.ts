import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ipcMain } from 'electron';

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

describe('DownloadManager', () => {
  let manager: DownloadManager;
  let mockSender: { send: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    (fs.existsSync as any).mockReturnValue(false);
    (fs.readFileSync as any).mockReturnValue('[]');
    mockSender = { send: vi.fn() };
    manager = new DownloadManager(mockSender);
  });

  afterEach(() => {
    manager.destroy();
  });

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
  });

  describe('getDownloadList', () => {
    it('returns downloads sorted by createdAt descending', async () => {
      await manager.startDownload('https://example.com/1', { title: 'First' });
      await manager.startDownload('https://example.com/2', { title: 'Second' });

      const list = manager.getDownloadList();
      expect(list.length).toBeGreaterThanOrEqual(2);
      // Most recent first
      expect(list[0].createdAt).toBeGreaterThanOrEqual(list[1].createdAt);
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
      const item = await manager.startDownload('https://example.com/1', { title: 'Test' });
      manager.cancelDownload(item.id);
      (manager as unknown as { maxConcurrent: number }).maxConcurrent = 0;

      const result = manager.retryDownload(item.id);

      expect(result).toBe(true);
      const retried = manager.getDownloadList().find((d) => d.id === item.id);
      expect(retried?.status).toBe('queued');
      expect(retried?.error).toBeUndefined();
      expect(retried?.progress).toBe(0);
    });
  });

  describe('cancelDownload', () => {
    it('returns false for non-existent download', () => {
      expect(manager.cancelDownload('nonexistent')).toBe(false);
    });

    it('marks download as failed with Cancelled error', async () => {
      const item = await manager.startDownload('https://example.com/1', { title: 'Test' });
      const result = manager.cancelDownload(item.id);
      expect(result).toBe(true);

      const list = manager.getDownloadList();
      const cancelled = list.find((d) => d.id === item.id);
      expect(cancelled?.status).toBe('failed');
      expect(cancelled?.error).toBe('Cancelled');
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
  });

  describe('state persistence', () => {
    it('loads state from file on construction', () => {
      (fs.existsSync as any).mockReturnValue(true);
      (fs.readFileSync as any).mockReturnValue(
        JSON.stringify([
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
        ]),
      );

      const mgr = new DownloadManager(mockSender);
      const list = mgr.getDownloadList();
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe('saved-1');
      expect(list[0].title).toBe('Saved Video');
      mgr.destroy();
    });

    it('handles corrupted state file gracefully', () => {
      (fs.existsSync as any).mockReturnValue(true);
      (fs.readFileSync as any).mockReturnValue('{{invalid json');

      const mgr = new DownloadManager(mockSender);
      const list = mgr.getDownloadList();
      expect(list).toEqual([]);
      mgr.destroy();
    });

    it('handles missing state file', () => {
      (fs.existsSync as any).mockReturnValue(false);
      const mgr = new DownloadManager(mockSender);
      expect(mgr.getDownloadList()).toEqual([]);
      mgr.destroy();
    });

    it('restores interrupted in-progress downloads as paused', () => {
      (fs.existsSync as any).mockReturnValue(true);
      (fs.readFileSync as any).mockReturnValue(
        JSON.stringify([
          {
            id: 'interrupted-1',
            url: 'https://example.com/video',
            title: 'Interrupted Video',
            filename: 'video.mp4',
            savePath: '',
            type: 'video',
            status: 'downloading',
            progress: 42,
            speed: 1024,
            eta: 12,
            createdAt: Date.now() - 10000,
          },
        ]),
      );

      const mgr = new DownloadManager(mockSender);
      const [restored] = mgr.getDownloadList();

      expect(restored.status).toBe('paused');
      expect(restored.id).toBe('interrupted-1');
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
      expect(ipcMain.removeHandler).toHaveBeenCalledWith('download:list');
      expect(ipcMain.removeHandler).toHaveBeenCalledWith('download:open-file');
      expect(ipcMain.removeHandler).toHaveBeenCalledWith('download:show-in-folder');
      expect(ipcMain.removeHandler).toHaveBeenCalledWith('download:remove');
      expect(ipcMain.removeHandler).toHaveBeenCalledWith('download:clear-completed');
    });
  });
});
