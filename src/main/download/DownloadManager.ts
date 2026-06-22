import { ipcMain, app, shell, Notification } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { DownloadItem, IPC_CHANNELS } from '../../shared/types';
import { YtDlpController, DownloadOptions, DownloadProgress } from './YtDlpController';
import type { SettingsManager } from '../settings/SettingsManager';
import log from 'electron-log/main';

type WebContentsSender = { send: (channel: string, ...args: unknown[]) => void };

interface StartDownloadOptions {
  formatId?: string;
  audioOnly?: boolean;
  title?: string;
}

const MAX_DOWNLOAD_HISTORY = 500;
const PROGRESS_THROTTLE_MS = 500;

export class DownloadManager {
  private ytdlp: YtDlpController;
  private downloads: Map<string, DownloadItem> = new Map();
  private appViewSender: WebContentsSender;
  private maxConcurrent = 3;
  private defaultDownloadDir: string;
  private stateFilePath: string;
  private settingsManager?: SettingsManager;
  private lastProgressUpdate: Map<string, number> = new Map();

  constructor(appViewSender: WebContentsSender, settingsManager?: SettingsManager) {
    this.ytdlp = new YtDlpController();
    this.appViewSender = appViewSender;
    this.settingsManager = settingsManager;

    this.defaultDownloadDir = settingsManager?.getDownloadDirectory() || path.join(app.getPath('downloads'), 'MyTube');
    if (settingsManager) {
      this.maxConcurrent = settingsManager.getMaxConcurrent();
      settingsManager.onSettingChanged((key, value) => {
        if (key === 'downloads.defaultDirectory') {
          this.defaultDownloadDir = value as string;
          if (!fs.existsSync(this.defaultDownloadDir)) {
            fs.mkdirSync(this.defaultDownloadDir, { recursive: true });
          }
        }
        if (key === 'downloads.maxConcurrent') {
          this.maxConcurrent = Math.max(1, Math.min(value as number, 10));
        }
      });
    }
    this.stateFilePath = path.join(app.getPath('userData'), 'downloads.json');

    // Ensure download directory exists
    if (!fs.existsSync(this.defaultDownloadDir)) {
      fs.mkdirSync(this.defaultDownloadDir, { recursive: true });
    }

    this.loadState();
    this.setupIpcHandlers();
  }

  private setupIpcHandlers(): void {
    ipcMain.handle(IPC_CHANNELS.DOWNLOAD_START, async (_event, url: string, options?: StartDownloadOptions) => {
      if (typeof url !== 'string' || !YtDlpController.validateUrl(url)) {
        throw new Error('Invalid download URL');
      }
      return this.startDownload(url, options);
    });

    ipcMain.handle(IPC_CHANNELS.DOWNLOAD_PAUSE, (_event, id: string) => {
      if (typeof id !== 'string') return false;
      return this.pauseDownload(id);
    });

    ipcMain.handle(IPC_CHANNELS.DOWNLOAD_RESUME, (_event, id: string) => {
      if (typeof id !== 'string') return false;
      return this.resumeDownload(id);
    });

    ipcMain.handle(IPC_CHANNELS.DOWNLOAD_CANCEL, (_event, id: string) => {
      if (typeof id !== 'string') return false;
      return this.cancelDownload(id);
    });

    ipcMain.handle(IPC_CHANNELS.DOWNLOAD_LIST, () => {
      return this.getDownloadList();
    });

    ipcMain.handle(IPC_CHANNELS.MEDIA_GET_INFO, async (_event, url: string) => {
      if (typeof url !== 'string' || !YtDlpController.validateUrl(url)) {
        return null;
      }
      try {
        return await this.ytdlp.getVideoInfo(url);
      } catch (err: unknown) {
        log.error('Failed to get media info:', getErrorMessage(err));
        return null;
      }
    });

    ipcMain.handle(IPC_CHANNELS.MEDIA_GET_FORMATS, async (_event, url: string) => {
      if (typeof url !== 'string' || !YtDlpController.validateUrl(url)) {
        return [];
      }
      try {
        return await this.ytdlp.getSimplifiedFormats(url);
      } catch (err: unknown) {
        log.error('Failed to get formats:', getErrorMessage(err));
        return [];
      }
    });

    // Open file / reveal in finder
    ipcMain.handle('download:open-file', (_event, id: string) => {
      if (typeof id !== 'string') return;
      const item = this.downloads.get(id);
      if (item && item.savePath && fs.existsSync(item.savePath)) {
        shell.openPath(item.savePath);
      }
    });

    ipcMain.handle('download:show-in-folder', (_event, id: string) => {
      if (typeof id !== 'string') return;
      const item = this.downloads.get(id);
      if (item && item.savePath && fs.existsSync(item.savePath)) {
        shell.showItemInFolder(item.savePath);
      }
    });

    ipcMain.handle('download:remove', (_event, id: string) => {
      if (typeof id !== 'string') return false;
      this.downloads.delete(id);
      this.saveState();
      return true;
    });

    ipcMain.handle('download:clear-completed', () => {
      for (const [id, item] of this.downloads) {
        if (item.status === 'completed' || item.status === 'failed') {
          this.downloads.delete(id);
        }
      }
      this.saveState();
      return true;
    });
  }

  async startDownload(url: string, options?: StartDownloadOptions): Promise<DownloadItem> {
    const id = randomUUID();

    const item: DownloadItem = {
      id,
      url,
      title: options?.title || 'Fetching info...',
      filename: '',
      savePath: '',
      type: options?.audioOnly ? 'audio' : 'video',
      status: 'queued',
      progress: 0,
      createdAt: Date.now(),
    };

    this.downloads.set(id, item);
    this.notifyUpdate(item);

    // Fetch video info for title if not provided
    if (!options?.title) {
      try {
        const info = await this.ytdlp.getVideoInfo(url);
        item.title = info.title;
        item.thumbnail = info.thumbnail;
        this.notifyUpdate(item);
      } catch {
        item.title = this.extractTitleFromUrl(url);
      }
    }

    // Check concurrent limit
    this.processQueue();

    return item;
  }

  private processQueue(): void {
    const activeCount = Array.from(this.downloads.values()).filter((d) => d.status === 'downloading').length;

    if (activeCount >= this.maxConcurrent) return;

    const nextQueued = Array.from(this.downloads.values()).find((d) => d.status === 'queued');

    if (!nextQueued) return;

    this.executeDownload(nextQueued);
  }

  private executeDownload(item: DownloadItem): void {
    // Verify download directory still exists before starting
    try {
      if (!fs.existsSync(this.defaultDownloadDir)) {
        fs.mkdirSync(this.defaultDownloadDir, { recursive: true });
      }
    } catch (err: unknown) {
      log.error('Cannot create download directory:', getErrorMessage(err));
      item.status = 'failed';
      item.error = 'Download directory is not accessible. Check settings.';
      this.notifyUpdate(item);
      this.processQueue();
      return;
    }

    item.status = 'downloading';
    this.notifyUpdate(item);
    this.updateDockBadge();

    const downloadOptions: DownloadOptions = {
      outputDir: this.defaultDownloadDir,
      formatId: item.format,
      audioOnly: item.type === 'audio',
    };

    this.ytdlp.download(
      item.id,
      item.url,
      downloadOptions,
      // onProgress — throttled to avoid flooding IPC
      (progress: DownloadProgress) => {
        item.progress = progress.percent;
        item.speed = progress.speed;
        item.eta = progress.eta;
        item.totalSize = progress.totalSize;
        if (progress.filename) {
          item.filename = path.basename(progress.filename);
        }
        const now = Date.now();
        const lastUpdate = this.lastProgressUpdate.get(item.id) || 0;
        if (now - lastUpdate >= PROGRESS_THROTTLE_MS || progress.percent >= 100) {
          this.lastProgressUpdate.set(item.id, now);
          this.appViewSender.send(IPC_CHANNELS.DOWNLOAD_PROGRESS, { ...item });
        }
      },
      // onComplete
      (filePath: string) => {
        this.lastProgressUpdate.delete(item.id);
        item.status = 'completed';
        item.progress = 100;
        item.completedAt = Date.now();
        item.savePath = filePath;
        item.filename = path.basename(filePath);
        item.speed = undefined;
        item.eta = undefined;
        this.trimHistory();
        this.saveState();
        this.appViewSender.send(IPC_CHANNELS.DOWNLOAD_COMPLETE, { ...item });
        this.notifyUpdate(item);
        this.showDownloadNotification(item);
        this.updateDockBadge();
        // Process next in queue
        this.processQueue();
      },
      // onError
      (error: string) => {
        this.lastProgressUpdate.delete(item.id);
        if (error === 'Download cancelled') {
          // Already handled by cancel
          return;
        }
        item.status = 'failed';
        item.error = error;
        item.speed = undefined;
        item.eta = undefined;
        this.saveState();
        this.appViewSender.send(IPC_CHANNELS.DOWNLOAD_ERROR, { ...item });
        this.notifyUpdate(item);
        this.updateDockBadge();
        this.processQueue();
      },
    );
  }

  pauseDownload(id: string): boolean {
    const item = this.downloads.get(id);
    if (!item || item.status !== 'downloading') return false;
    this.ytdlp.cancel(id);
    item.status = 'paused';
    item.speed = undefined;
    item.eta = undefined;
    this.notifyUpdate(item);
    this.saveState();
    return true;
  }

  resumeDownload(id: string): boolean {
    const item = this.downloads.get(id);
    if (!item || item.status !== 'paused') return false;
    item.status = 'queued';
    this.notifyUpdate(item);
    this.processQueue();
    return true;
  }

  cancelDownload(id: string): boolean {
    const item = this.downloads.get(id);
    if (!item) return false;

    if (item.status === 'downloading') {
      this.ytdlp.cancel(id);
    }

    item.status = 'failed';
    item.error = 'Cancelled';
    item.speed = undefined;
    item.eta = undefined;
    this.notifyUpdate(item);
    this.saveState();
    this.processQueue();
    return true;
  }

  getDownloadList(): DownloadItem[] {
    return Array.from(this.downloads.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  setMaxConcurrent(max: number): void {
    this.maxConcurrent = Math.max(1, Math.min(max, 10));
  }

  setDefaultDownloadDir(dir: string): void {
    this.defaultDownloadDir = dir;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // ==================== Persistence ====================

  /** Remove oldest completed/failed downloads to keep history manageable */
  private trimHistory(): void {
    const all = Array.from(this.downloads.values()).sort((a, b) => b.createdAt - a.createdAt);
    if (all.length <= MAX_DOWNLOAD_HISTORY) return;

    const toRemove = all.slice(MAX_DOWNLOAD_HISTORY);
    for (const item of toRemove) {
      if (item.status === 'completed' || item.status === 'failed') {
        this.downloads.delete(item.id);
      }
    }
  }

  private saveState(): void {
    try {
      const items = Array.from(this.downloads.values())
        .filter((d) => d.status === 'completed' || d.status === 'paused')
        .map((d) => ({ ...d, speed: undefined, eta: undefined }));
      fs.writeFileSync(this.stateFilePath, JSON.stringify(items, null, 2));
    } catch (err: unknown) {
      if (getErrorCode(err) === 'ENOSPC') {
        log.error('Disk full — cannot save download state');
      } else {
        log.error('Failed to save download state:', err);
      }
    }
  }

  private loadState(): void {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        const data = JSON.parse(fs.readFileSync(this.stateFilePath, 'utf-8'));
        for (const item of data) {
          // Reset paused downloads to queued on restart
          if (item.status === 'paused') {
            item.status = 'paused'; // Keep paused, user must manually resume
          }
          this.downloads.set(item.id, item);
        }
        log.info(`Loaded ${this.downloads.size} downloads from state`);
      }
    } catch (err) {
      log.error('Failed to load download state:', err);
      this.backupCorruptedState();
    }
  }

  // ==================== Helpers ====================

  private backupCorruptedState(): void {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        const backupPath = `${this.stateFilePath}.corrupted.${Date.now()}`;
        fs.copyFileSync(this.stateFilePath, backupPath);
        fs.writeFileSync(this.stateFilePath, '[]');
        log.info(`Corrupted download state backed up to: ${backupPath}`);
      }
    } catch (err: unknown) {
      log.error('Failed to backup corrupted download state:', getErrorMessage(err));
    }
  }

  private notifyUpdate(item: DownloadItem): void {
    this.appViewSender.send(IPC_CHANNELS.DOWNLOAD_PROGRESS, { ...item });
  }

  private showDownloadNotification(item: DownloadItem): void {
    if (!Notification.isSupported()) return;
    const notif = new Notification({
      title: 'Download Complete',
      body: item.title || item.filename,
      silent: false,
    });
    notif.on('click', () => {
      if (item.savePath && fs.existsSync(item.savePath)) {
        shell.showItemInFolder(item.savePath);
      }
    });
    notif.show();
  }

  private updateDockBadge(): void {
    if (process.platform !== 'darwin') return;
    const activeCount = Array.from(this.downloads.values()).filter(
      (d) => d.status === 'downloading' || d.status === 'queued',
    ).length;
    app.dock?.setBadge(activeCount > 0 ? String(activeCount) : '');
  }

  private extractTitleFromUrl(url: string): string {
    try {
      const u = new URL(url);
      return u.hostname + u.pathname;
    } catch {
      return url.slice(0, 60);
    }
  }

  destroy(): void {
    this.ytdlp.cancelAll();
    this.saveState();
    this.updateDockBadge();

    ipcMain.removeHandler(IPC_CHANNELS.DOWNLOAD_START);
    ipcMain.removeHandler(IPC_CHANNELS.DOWNLOAD_PAUSE);
    ipcMain.removeHandler(IPC_CHANNELS.DOWNLOAD_RESUME);
    ipcMain.removeHandler(IPC_CHANNELS.DOWNLOAD_CANCEL);
    ipcMain.removeHandler(IPC_CHANNELS.DOWNLOAD_LIST);
    ipcMain.removeHandler(IPC_CHANNELS.MEDIA_GET_INFO);
    ipcMain.removeHandler(IPC_CHANNELS.MEDIA_GET_FORMATS);
    ipcMain.removeHandler('download:open-file');
    ipcMain.removeHandler('download:show-in-folder');
    ipcMain.removeHandler('download:remove');
    ipcMain.removeHandler('download:clear-completed');
  }
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function getErrorCode(err: unknown): unknown {
  return typeof err === 'object' && err !== null && 'code' in err ? (err as { code?: unknown }).code : undefined;
}
