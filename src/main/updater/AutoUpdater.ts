import { autoUpdater, UpdateInfo } from 'electron-updater';
import { ipcMain } from 'electron';
import log from 'electron-log/main';

type WebContentsSender = { send: (channel: string, ...args: unknown[]) => void };

export function isAppAutoUpdateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MYTUBE_AUTO_UPDATE_ENABLED === '1';
}

export class AutoUpdater {
  private appViewSender: WebContentsSender;
  private enabled: boolean;

  constructor(appViewSender: WebContentsSender, enabled = isAppAutoUpdateEnabled()) {
    this.appViewSender = appViewSender;
    this.enabled = enabled;

    autoUpdater.logger = log;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    this.setupEvents();
    this.setupIpcHandlers();
  }

  private setupEvents(): void {
    autoUpdater.on('checking-for-update', () => {
      log.info('Checking for updates...');
      this.appViewSender.send('updater:checking');
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      log.info(`Update available: ${info.version}`);
      this.appViewSender.send('updater:available', {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: info.releaseNotes,
      });
    });

    autoUpdater.on('update-not-available', () => {
      log.info('No updates available.');
      this.appViewSender.send('updater:not-available');
    });

    autoUpdater.on('download-progress', (progress) => {
      this.appViewSender.send('updater:progress', {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      });
    });

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      log.info(`Update downloaded: ${info.version}`);
      this.appViewSender.send('updater:downloaded', {
        version: info.version,
      });
    });

    autoUpdater.on('error', (err) => {
      log.error('Auto-updater error:', err.message);
      this.appViewSender.send('updater:error', err.message);
    });
  }

  private setupIpcHandlers(): void {
    ipcMain.handle('updater:check', () => {
      this.checkForUpdates();
    });

    ipcMain.handle('updater:download', () => {
      this.downloadUpdate();
    });

    ipcMain.handle('updater:install', () => {
      this.quitAndInstall();
    });
  }

  checkForUpdates(): void {
    if (!this.enabled) {
      log.debug('App auto-update check skipped: no publish provider is configured');
      this.appViewSender.send('updater:disabled');
      return;
    }
    autoUpdater.checkForUpdates().catch((err) => {
      log.error('Failed to check for updates:', err.message);
    });
  }

  downloadUpdate(): void {
    if (!this.enabled) return;
    autoUpdater.downloadUpdate().catch((err) => {
      log.error('Failed to download update:', err.message);
    });
  }

  quitAndInstall(): void {
    if (!this.enabled) return;
    autoUpdater.quitAndInstall();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  destroy(): void {
    ipcMain.removeHandler('updater:check');
    ipcMain.removeHandler('updater:download');
    ipcMain.removeHandler('updater:install');
  }
}
