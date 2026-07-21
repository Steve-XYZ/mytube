import { ipcMain, app, shell, Notification } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { DownloadItem, IPC_CHANNELS } from '../../shared/types';
import { YtDlpController, DownloadOptions, DownloadProgress } from './YtDlpController';
import type { DownloadTarget } from './DownloadTargetResolver';
import type { CapturedMediaFallback, MediaFallbackProvider } from './MediaFallbackProvider';
import type { SettingsManager } from '../settings/SettingsManager';
import { SqliteDownloadStateStore, type DownloadStateStore } from './DownloadQueueStore';
import log from 'electron-log/main';

type WebContentsSender = { send: (channel: string, ...args: unknown[]) => void };

interface StartDownloadOptions {
  formatId?: string;
  audioOnly?: boolean;
  title?: string;
}

const MAX_DOWNLOAD_HISTORY = 500;
const PROGRESS_THROTTLE_MS = 500;
const RESOLVED_TARGET_TTL_MS = 2 * 60 * 1000;

export class DownloadManager {
  private ytdlp: YtDlpController;
  private downloads: Map<string, DownloadItem> = new Map();
  private appViewSender: WebContentsSender;
  private maxConcurrent = 3;
  private defaultDownloadDir: string;
  private stateStore: DownloadStateStore;
  private settingsManager?: SettingsManager;
  private mediaFallbackProvider?: MediaFallbackProvider;
  private downloadTargets: Map<string, DownloadTarget> = new Map();
  private resolvedTargetsByPageUrl: Map<string, { target: DownloadTarget; expiresAt: number }> = new Map();
  private lastProgressUpdate: Map<string, number> = new Map();
  private attemptTokens: Map<string, number> = new Map();
  private isDrainingQueue = false;
  private destroyed = false;
  private nextQueueOrder = 1;

  constructor(
    appViewSender: WebContentsSender,
    settingsManager?: SettingsManager,
    mediaFallbackProvider?: MediaFallbackProvider,
    stateStore?: DownloadStateStore,
  ) {
    this.ytdlp = new YtDlpController();
    this.appViewSender = appViewSender;
    this.settingsManager = settingsManager;
    this.mediaFallbackProvider = mediaFallbackProvider;

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
          this.processQueue();
        }
      });
    }
    const userDataDir = app.getPath('userData');
    this.stateStore =
      stateStore ||
      new SqliteDownloadStateStore(
        path.join(userDataDir, 'downloads.sqlite3'),
        path.join(userDataDir, 'downloads.json'),
      );

    // Ensure download directory exists
    if (!fs.existsSync(this.defaultDownloadDir)) {
      fs.mkdirSync(this.defaultDownloadDir, { recursive: true });
    }

    this.loadState();
    this.setupIpcHandlers();
    setImmediate(() => {
      if (!this.destroyed) this.processQueue();
    });
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

    ipcMain.handle(IPC_CHANNELS.DOWNLOAD_RETRY, (_event, id: string) => {
      if (typeof id !== 'string') return false;
      return this.retryDownload(id);
    });

    ipcMain.handle(IPC_CHANNELS.DOWNLOAD_CANCEL, (_event, id: string) => {
      if (typeof id !== 'string') return false;
      return this.cancelDownload(id);
    });

    ipcMain.handle(IPC_CHANNELS.DOWNLOAD_PAUSE_ALL, () => this.pauseAllDownloads());
    ipcMain.handle(IPC_CHANNELS.DOWNLOAD_RESUME_ALL, () => this.resumeAllDownloads());
    ipcMain.handle(IPC_CHANNELS.DOWNLOAD_CANCEL_PENDING, () => this.cancelPendingDownloads());
    ipcMain.handle(IPC_CHANNELS.DOWNLOAD_MOVE, (_event, id: string, direction: string) => {
      if (typeof id !== 'string' || !['up', 'down', 'top', 'bottom'].includes(direction)) return false;
      return this.moveDownload(id, direction as 'up' | 'down' | 'top' | 'bottom');
    });

    ipcMain.handle(IPC_CHANNELS.DOWNLOAD_LIST, () => {
      return this.getDownloadList();
    });

    ipcMain.handle(IPC_CHANNELS.MEDIA_GET_INFO, async (_event, url: string) => {
      if (typeof url !== 'string' || !YtDlpController.validateUrl(url)) {
        return null;
      }
      const target = await this.resolveDownloadTarget(url, false);
      try {
        const info = await this.ytdlp.getVideoInfo(target.url);
        return {
          ...info,
          url,
          formats: this.ytdlp.simplifyVideoFormats(info.formats),
        };
      } catch (err: unknown) {
        log.error('Failed to get media info:', getErrorMessage(err));
        const fallback = target.fallback || this.mediaFallbackProvider?.getMediaFallbackForPage(url);
        if (fallback) {
          return this.getFallbackVideoInfo(url, fallback);
        }
        return { error: getUserFacingYtDlpError(err) };
      }
    });

    ipcMain.handle(IPC_CHANNELS.MEDIA_GET_FORMATS, async (_event, url: string) => {
      if (typeof url !== 'string' || !YtDlpController.validateUrl(url)) {
        return [];
      }
      const target = await this.resolveDownloadTarget(url, false);
      try {
        const info = await this.ytdlp.getVideoInfo(target.url);
        return this.ytdlp.simplifyVideoFormats(info.formats);
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
      this.downloadTargets.delete(id);
      this.saveState();
      return true;
    });

    ipcMain.handle('download:clear-completed', () => {
      for (const [id, item] of this.downloads) {
        if (item.status === 'completed' || item.status === 'failed' || item.status === 'cancelled') {
          this.downloads.delete(id);
          this.downloadTargets.delete(id);
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
      sourcePageUrl: url,
      title: options?.title || 'Fetching info...',
      filename: '',
      savePath: '',
      type: options?.audioOnly ? 'audio' : 'video',
      status: 'queued',
      progress: 0,
      format: options?.formatId,
      createdAt: Date.now(),
      queueOrder: this.nextQueueOrder++,
    };

    this.downloads.set(id, item);
    this.notifyUpdate(item);
    this.saveState();
    this.processQueue();

    return item;
  }

  private processQueue(): void {
    if (this.isDrainingQueue) return;
    this.isDrainingQueue = true;

    try {
      for (;;) {
        const activeCount = Array.from(this.downloads.values()).filter((d) => this.isActiveStatus(d.status)).length;
        if (activeCount >= this.maxConcurrent) return;

        const nextQueued = Array.from(this.downloads.values())
          .filter((d) => d.status === 'queued')
          .sort((a, b) => (a.queueOrder ?? a.createdAt) - (b.queueOrder ?? b.createdAt))[0];
        if (!nextQueued) return;

        this.prepareDownload(nextQueued);
      }
    } finally {
      this.isDrainingQueue = false;
    }
  }

  private prepareDownload(item: DownloadItem): void {
    const attemptToken = (this.attemptTokens.get(item.id) || 0) + 1;
    this.attemptTokens.set(item.id, attemptToken);
    item.attempt = (item.attempt || 0) + 1;
    item.status = 'resolving';
    item.error = undefined;
    this.notifyUpdate(item);
    this.saveState();

    void this.resolveAndExecute(item, attemptToken);
  }

  private async resolveAndExecute(item: DownloadItem, attemptToken: number): Promise<void> {
    const pageUrl = item.sourcePageUrl || item.url;
    try {
      const useCached = item.attempt === 1;
      const target = await this.resolveDownloadTarget(pageUrl, useCached);
      if (this.attemptTokens.get(item.id) !== attemptToken) return;

      item.url = target.url;
      item.sourcePageUrl = target.pageUrl;
      item.targetResolvedAt = Date.now();
      this.downloadTargets.set(item.id, target);
      if (item.title === 'Fetching info...') {
        item.title = target.title || this.extractTitleFromUrl(pageUrl);
        void this.hydrateMetadata(item, target.url, attemptToken);
      }
      this.executeDownload(item, target.fallback, attemptToken);
    } catch (error) {
      if (this.attemptTokens.get(item.id) !== attemptToken) return;
      item.status = 'needs-refresh';
      item.error = `Could not refresh this media source: ${getErrorMessage(error)}`;
      this.downloadTargets.delete(item.id);
      this.notifyUpdate(item);
      this.saveState();
      this.appViewSender.send(IPC_CHANNELS.DOWNLOAD_ERROR, { ...item });
      this.processQueue();
    }
  }

  private async hydrateMetadata(item: DownloadItem, url: string, attemptToken: number): Promise<void> {
    try {
      const info = await this.ytdlp.getVideoInfo(url);
      if (this.attemptTokens.get(item.id) !== attemptToken) return;
      item.title = info.title;
      item.thumbnail = info.thumbnail;
      this.notifyUpdate(item);
      this.saveState();
    } catch {
      // The download itself remains authoritative; metadata is optional.
    }
  }

  private executeDownload(item: DownloadItem, fallback: CapturedMediaFallback | undefined, attemptToken: number): void {
    // Verify download directory still exists before starting
    try {
      if (!fs.existsSync(this.defaultDownloadDir)) {
        fs.mkdirSync(this.defaultDownloadDir, { recursive: true });
      }
    } catch (err: unknown) {
      log.error('Cannot create download directory:', getErrorMessage(err));
      item.status = 'failed';
      item.error = 'Download directory is not accessible. Check settings.';
      this.downloadTargets.delete(item.id);
      this.notifyUpdate(item);
      this.saveState();
      this.processQueue();
      return;
    }

    item.status = 'downloading';
    item.error = undefined;
    this.notifyUpdate(item);
    this.saveState();
    this.updateDockBadge();

    const downloadUrl = fallback?.url || item.url;
    const prefs = this.settingsManager?.getDownloadPreferences();
    const downloadOptions: DownloadOptions = {
      outputDir: this.defaultDownloadDir,
      formatId: fallback ? undefined : item.format,
      audioOnly: item.type === 'audio' || prefs?.videoQuality === 'audio-only',
      videoQuality: prefs?.videoQuality,
      videoFormat: prefs?.videoFormat,
      audioFormat: prefs?.audioFormat,
      speedLimitKbps: prefs?.speedLimitKbps,
      httpHeaders: fallback?.requestHeaders,
      refererUrl: fallback?.pageUrl,
      cookieSourceUrls: fallback ? [fallback.pageUrl] : undefined,
    };

    this.ytdlp.download(
      item.id,
      downloadUrl,
      downloadOptions,
      // onProgress — throttled to avoid flooding IPC
      (progress: DownloadProgress) => {
        if (this.attemptTokens.get(item.id) !== attemptToken) return;
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
        if (this.attemptTokens.get(item.id) !== attemptToken) return;
        this.lastProgressUpdate.delete(item.id);
        this.downloadTargets.delete(item.id);
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
        if (this.attemptTokens.get(item.id) !== attemptToken) return;
        this.lastProgressUpdate.delete(item.id);
        if (error === 'Download cancelled') {
          // Already handled by cancel
          return;
        }

        if (!fallback) {
          const nextFallback = this.mediaFallbackProvider?.getMediaFallbackForPage(item.sourcePageUrl || item.url);
          if (nextFallback) {
            log.info(`Retrying download ${item.id} with captured media fallback`);
            item.status = 'retrying';
            item.progress = 0;
            item.speed = undefined;
            item.eta = undefined;
            item.totalSize = undefined;
            this.notifyUpdate(item);
            this.saveState();
            this.executeDownload(item, nextFallback, attemptToken);
            return;
          }
        }

        item.status = 'failed';
        this.downloadTargets.delete(item.id);
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
    if (!item || (!this.isActiveStatus(item.status) && item.status !== 'queued')) return false;
    if (this.isActiveStatus(item.status)) {
      this.invalidateAttempt(id);
      this.ytdlp.cancel(id);
    }
    this.downloadTargets.delete(id);
    item.targetResolvedAt = undefined;
    item.status = 'paused';
    item.speed = undefined;
    item.eta = undefined;
    this.notifyUpdate(item);
    this.saveState();
    this.processQueue();
    return true;
  }

  pauseAllDownloads(): number {
    let paused = 0;
    for (const item of this.downloads.values()) {
      if (!this.isActiveStatus(item.status) && item.status !== 'queued') continue;
      if (this.isActiveStatus(item.status)) {
        this.invalidateAttempt(item.id);
        this.ytdlp.cancel(item.id);
      }
      this.downloadTargets.delete(item.id);
      item.targetResolvedAt = undefined;
      item.status = 'paused';
      item.speed = undefined;
      item.eta = undefined;
      this.notifyUpdate(item);
      paused += 1;
    }
    if (paused > 0) {
      this.saveState();
      this.updateDockBadge();
    }
    return paused;
  }

  resumeDownload(id: string): boolean {
    const item = this.downloads.get(id);
    if (!item || (item.status !== 'paused' && item.status !== 'needs-refresh')) return false;
    item.status = 'queued';
    item.queueOrder = this.nextQueueOrder++;
    item.error = undefined;
    this.notifyUpdate(item);
    this.saveState();
    this.processQueue();
    return true;
  }

  resumeAllDownloads(): number {
    const paused = Array.from(this.downloads.values())
      .filter((item) => item.status === 'paused' || item.status === 'needs-refresh')
      .sort((a, b) => (a.queueOrder ?? a.createdAt) - (b.queueOrder ?? b.createdAt));
    for (const item of paused) {
      item.status = 'queued';
      item.queueOrder = this.nextQueueOrder++;
      item.error = undefined;
      item.targetResolvedAt = undefined;
      this.downloadTargets.delete(item.id);
      this.notifyUpdate(item);
    }
    if (paused.length > 0) {
      this.saveState();
      this.processQueue();
    }
    return paused.length;
  }

  retryDownload(id: string): boolean {
    const item = this.downloads.get(id);
    if (!item || (item.status !== 'failed' && item.status !== 'needs-refresh')) return false;

    item.status = 'queued';
    item.queueOrder = this.nextQueueOrder++;
    item.error = undefined;
    item.progress = 0;
    item.speed = undefined;
    item.eta = undefined;
    item.totalSize = undefined;
    item.downloadedSize = undefined;
    item.targetResolvedAt = undefined;
    this.downloadTargets.delete(id);
    this.notifyUpdate(item);
    this.saveState();
    this.processQueue();
    return true;
  }

  cancelDownload(id: string): boolean {
    const item = this.downloads.get(id);
    if (!item || item.status === 'completed' || item.status === 'cancelled') return false;

    if (this.isActiveStatus(item.status)) {
      this.invalidateAttempt(id);
      this.ytdlp.cancel(id);
    }

    item.status = 'cancelled';
    item.error = undefined;
    item.cancelledAt = Date.now();
    this.downloadTargets.delete(item.id);
    item.speed = undefined;
    item.eta = undefined;
    this.notifyUpdate(item);
    this.saveState();
    this.processQueue();
    return true;
  }

  cancelPendingDownloads(): number {
    let cancelled = 0;
    for (const item of this.downloads.values()) {
      if (!['resolving', 'retrying', 'queued', 'paused', 'needs-refresh'].includes(item.status)) continue;
      if (this.isActiveStatus(item.status)) {
        this.invalidateAttempt(item.id);
        this.ytdlp.cancel(item.id);
      }
      item.status = 'cancelled';
      item.error = undefined;
      item.cancelledAt = Date.now();
      item.speed = undefined;
      item.eta = undefined;
      this.downloadTargets.delete(item.id);
      this.notifyUpdate(item);
      cancelled += 1;
    }
    if (cancelled > 0) {
      this.saveState();
      this.updateDockBadge();
      this.processQueue();
    }
    return cancelled;
  }

  moveDownload(id: string, direction: 'up' | 'down' | 'top' | 'bottom'): boolean {
    const queue = Array.from(this.downloads.values())
      .filter((item) => item.status === 'queued')
      .sort((a, b) => (a.queueOrder ?? a.createdAt) - (b.queueOrder ?? b.createdAt));
    const index = queue.findIndex((item) => item.id === id);
    if (index < 0 || queue.length < 2) return false;

    let targetIndex = index;
    if (direction === 'up') targetIndex = Math.max(0, index - 1);
    if (direction === 'down') targetIndex = Math.min(queue.length - 1, index + 1);
    if (direction === 'top') targetIndex = 0;
    if (direction === 'bottom') targetIndex = queue.length - 1;
    if (targetIndex === index) return false;

    const [moved] = queue.splice(index, 1);
    queue.splice(targetIndex, 0, moved);
    const firstOrder = Math.min(...queue.map((item) => item.queueOrder ?? item.createdAt));
    queue.forEach((item, queueIndex) => {
      item.queueOrder = firstOrder + queueIndex;
      this.notifyUpdate(item);
    });
    this.nextQueueOrder = Math.max(this.nextQueueOrder, firstOrder + queue.length);
    this.saveState();
    return true;
  }

  getDownloadList(): DownloadItem[] {
    const queue = Array.from(this.downloads.values())
      .filter((item) => item.status === 'queued')
      .sort((a, b) => (a.queueOrder ?? a.createdAt) - (b.queueOrder ?? b.createdAt));
    const positions = new Map(queue.map((item, index) => [item.id, index + 1]));

    return Array.from(this.downloads.values())
      .sort((a, b) => {
        const aQueued = this.isQueueStatus(a.status);
        const bQueued = this.isQueueStatus(b.status);
        if (aQueued !== bQueued) return aQueued ? -1 : 1;
        return aQueued ? (a.queueOrder ?? a.createdAt) - (b.queueOrder ?? b.createdAt) : b.createdAt - a.createdAt;
      })
      .map((item) => ({ ...item, queuePosition: positions.get(item.id) }));
  }

  setMaxConcurrent(max: number): void {
    this.maxConcurrent = Math.max(1, Math.min(max, 10));
    this.processQueue();
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
      if (item.status === 'completed' || item.status === 'failed' || item.status === 'cancelled') {
        this.downloads.delete(item.id);
      }
    }
  }

  private saveState(): void {
    try {
      const items = Array.from(this.downloads.values()).map((item) => ({
        ...item,
        url: item.sourcePageUrl || item.url,
        targetResolvedAt: undefined,
        speed: undefined,
        eta: undefined,
      }));
      this.stateStore.save(items);
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
      const data = this.stateStore.load();
      for (const item of data) {
        if (!item || typeof item.id !== 'string') continue;
        if (item.status === 'downloading' || item.status === 'resolving' || item.status === 'retrying') {
          item.status = 'paused';
        }
        item.queueOrder ??= item.createdAt;
        this.nextQueueOrder = Math.max(this.nextQueueOrder, item.queueOrder + 1);
        this.downloads.set(item.id, item);
      }
      log.info(`Loaded ${this.downloads.size} downloads from state`);
    } catch (err) {
      log.error('Failed to load download state:', err);
    }
  }

  // ==================== Helpers ====================

  private notifyUpdate(item: DownloadItem): void {
    this.appViewSender.send(IPC_CHANNELS.DOWNLOAD_PROGRESS, { ...item });
  }

  private isActiveStatus(status: DownloadItem['status']): boolean {
    return status === 'resolving' || status === 'downloading' || status === 'retrying';
  }

  private isQueueStatus(status: DownloadItem['status']): boolean {
    return this.isActiveStatus(status) || status === 'queued' || status === 'paused' || status === 'needs-refresh';
  }

  private invalidateAttempt(id: string): void {
    this.attemptTokens.set(id, (this.attemptTokens.get(id) || 0) + 1);
    this.lastProgressUpdate.delete(id);
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
      (d) => this.isActiveStatus(d.status) || d.status === 'queued',
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

  private getFallbackVideoInfo(url: string, fallback: CapturedMediaFallback) {
    return {
      id: 'captured-media',
      title: fallback.title || this.extractTitleFromUrl(url),
      url,
      formats: [],
    };
  }

  private async resolveDownloadTarget(pageUrl: string, useCached: boolean): Promise<DownloadTarget> {
    const cached = this.resolvedTargetsByPageUrl.get(pageUrl);
    if (useCached && cached && cached.expiresAt > Date.now()) {
      return cached.target;
    }

    let target: DownloadTarget;
    if (this.mediaFallbackProvider) {
      target = await this.mediaFallbackProvider.resolveDownloadTarget(pageUrl);
    } else {
      target = { pageUrl, url: pageUrl, source: 'page' };
    }

    this.resolvedTargetsByPageUrl.set(pageUrl, {
      target,
      expiresAt: Date.now() + RESOLVED_TARGET_TTL_MS,
    });
    return target;
  }

  getYtDlpVersion(): string | null {
    return this.ytdlp.getYtDlpVersion();
  }

  /** Re-resolve the yt-dlp binary after a runtime update lands. */
  refreshYtDlpBinary(): void {
    this.ytdlp.refreshYtDlpBinary();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.ytdlp.cancelAll();
    for (const id of this.downloads.keys()) {
      this.invalidateAttempt(id);
    }
    this.downloadTargets.clear();
    this.resolvedTargetsByPageUrl.clear();
    this.saveState();
    this.stateStore.close();
    this.updateDockBadge();

    ipcMain.removeHandler(IPC_CHANNELS.DOWNLOAD_START);
    ipcMain.removeHandler(IPC_CHANNELS.DOWNLOAD_PAUSE);
    ipcMain.removeHandler(IPC_CHANNELS.DOWNLOAD_RESUME);
    ipcMain.removeHandler(IPC_CHANNELS.DOWNLOAD_RETRY);
    ipcMain.removeHandler(IPC_CHANNELS.DOWNLOAD_CANCEL);
    ipcMain.removeHandler(IPC_CHANNELS.DOWNLOAD_PAUSE_ALL);
    ipcMain.removeHandler(IPC_CHANNELS.DOWNLOAD_RESUME_ALL);
    ipcMain.removeHandler(IPC_CHANNELS.DOWNLOAD_CANCEL_PENDING);
    ipcMain.removeHandler(IPC_CHANNELS.DOWNLOAD_MOVE);
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

function getUserFacingYtDlpError(err: unknown): string {
  return getErrorMessage(err)
    .replace(/^yt-dlp exited with code \d+:\s*/i, '')
    .replace(/^ERROR:\s*/i, '')
    .trim();
}

function getErrorCode(err: unknown): unknown {
  return typeof err === 'object' && err !== null && 'code' in err ? (err as { code?: unknown }).code : undefined;
}
