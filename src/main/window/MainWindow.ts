import { app, BaseWindow, ipcMain, WebContentsView } from 'electron';
import * as path from 'path';
import {
  DEFAULT_WINDOW_WIDTH,
  DEFAULT_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  APP_NAME,
} from '../../shared/constants';
import { IPC_CHANNELS } from '../../shared/types';
import { TabManager } from './TabManager';
import { KeyboardShortcuts } from './KeyboardShortcuts';
import { DownloadManager } from '../download/DownloadManager';
import { MediaDetector } from '../media/MediaDetector';
import { SettingsManager } from '../settings/SettingsManager';
import { AutoUpdater } from '../updater/AutoUpdater';
import { AppMenu } from './AppMenu';
import { GoogleAuthManager } from '../auth/GoogleAuthManager';
import { YtDlpUpdater, getManagedYtDlpDir } from '../download/YtDlpUpdater';
import { readWindowState, trackWindowState } from './WindowState';

export class MainWindow {
  private window: BaseWindow;
  private appView: WebContentsView;
  private tabManager: TabManager;
  private keyboardShortcuts: KeyboardShortcuts;
  private downloadManager: DownloadManager;
  private mediaDetector: MediaDetector;
  private settingsManager: SettingsManager;
  private googleAuthManager: GoogleAuthManager;
  private autoUpdater: AutoUpdater;
  private ytdlpUpdater: YtDlpUpdater;
  private shellOverlayOpen = false;

  constructor() {
    const windowStatePath = path.join(app.getPath('userData'), 'window-state.json');
    const windowState = readWindowState(windowStatePath, MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT, {
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT,
    });

    this.window = new BaseWindow({
      width: windowState.width,
      height: windowState.height,
      ...(windowState.x !== undefined && windowState.y !== undefined ? { x: windowState.x, y: windowState.y } : {}),
      minWidth: MIN_WINDOW_WIDTH,
      minHeight: MIN_WINDOW_HEIGHT,
      title: APP_NAME,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 12, y: 10 },
      show: false,
    });
    if (windowState.isMaximized) {
      this.window.maximize();
    }
    trackWindowState(this.window, windowStatePath);

    const preloadPath = path.join(__dirname, '..', '..', 'preload', 'index.js');

    this.appView = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        preload: preloadPath,
      },
    });
    this.appView.setBackgroundColor('#00000000');

    this.window.contentView.addChildView(this.appView);
    this.updateAppViewBounds();

    // Initialize managers
    this.settingsManager = new SettingsManager(this.appView.webContents);
    this.googleAuthManager = new GoogleAuthManager();
    this.mediaDetector = new MediaDetector(this.appView.webContents);
    this.tabManager = new TabManager(this.window, this.appView, preloadPath, this.settingsManager, this.mediaDetector);
    this.keyboardShortcuts = new KeyboardShortcuts(this.window, this.tabManager, this.appView);
    this.downloadManager = new DownloadManager(this.appView.webContents, this.settingsManager, this.tabManager);
    this.autoUpdater = new AutoUpdater(this.appView.webContents);

    // Keep yt-dlp fresh on installed apps: YouTube changes routinely break
    // older snapshots, so a runtime updater matters more than app releases.
    // MYTUBE_BIN_DIR pins binaries for tests, so the updater stays off there.
    this.ytdlpUpdater = new YtDlpUpdater({
      managedDir: getManagedYtDlpDir(app.getPath('userData')),
      currentVersionProvider: () => this.downloadManager.getYtDlpVersion(),
      onUpdated: () => this.downloadManager.refreshYtDlpBinary(),
    });
    const ytdlpAutoUpdateEnabled = () =>
      !process.env.MYTUBE_BIN_DIR && this.settingsManager.get('downloads.autoUpdateYtDlp') !== false;
    if (ytdlpAutoUpdateEnabled()) {
      this.ytdlpUpdater.start();
    }
    this.settingsManager.onSettingChanged((key) => {
      if (key !== 'downloads.autoUpdateYtDlp') return;
      if (ytdlpAutoUpdateEnabled()) {
        this.ytdlpUpdater.start();
      } else {
        this.ytdlpUpdater.stop();
      }
    });

    // Set up native app menu
    new AppMenu(this.tabManager, this.appView);

    ipcMain.handle(IPC_CHANNELS.APP_SHELL_OVERLAY_SET, (_event, open: boolean) => {
      this.setShellOverlayOpen(open);
    });

    // Handle window resize
    this.window.on('resize', () => {
      this.updateAppViewBounds();
      this.tabManager.updateAllTabBounds();
    });

    // Set CSP headers for the app shell
    this.appView.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      if (details.webContentsId !== this.appView.webContents.id) {
        callback({ responseHeaders: details.responseHeaders });
        return;
      }

      const isDev = process.env.NODE_ENV === 'development' || process.env.VITE_DEV_SERVER_URL;
      const csp = isDev
        ? "default-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:*; style-src 'self' 'unsafe-inline'; img-src 'self' https: http: data:; connect-src 'self' http://localhost:* ws://localhost:*;"
        : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self' https:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';";

      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [csp],
        },
      });
    });

    this.appView.webContents.on('console-message', (event) => {
      if (event.level === 'warning' || event.level === 'error') {
        console.warn(`[app-shell] ${event.message} (${event.sourceId}:${event.lineNumber})`);
      }
    });
    this.appView.webContents.on('preload-error', (_event, failedPreloadPath, error) => {
      console.error(`[app-shell] preload failed: ${failedPreloadPath}`, error);
    });
    this.appView.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      console.error(`[app-shell] load failed (${errorCode} ${errorDescription}): ${validatedURL}`);
    });

    // Load the renderer
    this.loadRenderer();

    // Show window once the app shell is loaded
    this.appView.webContents.on('did-finish-load', () => {
      this.window.show();

      // Check for updates after launch (only in production)
      if (!process.env.VITE_DEV_SERVER_URL && process.env.NODE_ENV !== 'development') {
        setTimeout(() => this.autoUpdater.checkForUpdates(), 5000);
      }
    });

    // Restore the previous session's tabs, or start with a fresh tab.
    this.tabManager.restoreSession();
  }

  private loadRenderer(): void {
    if (process.env.NODE_ENV === 'development' || process.env.VITE_DEV_SERVER_URL) {
      const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
      this.appView.webContents.loadURL(devUrl);
    } else {
      const htmlPath = path.join(__dirname, '..', '..', 'renderer', 'index.html');
      this.appView.webContents.loadFile(htmlPath);
    }
  }

  private updateAppViewBounds(): void {
    const bounds = this.window.getBounds();
    this.appView.setBounds({
      x: 0,
      y: 0,
      width: bounds.width,
      height: bounds.height,
    });
  }

  private setShellOverlayOpen(open: boolean): void {
    if (this.shellOverlayOpen === open) return;
    this.shellOverlayOpen = open;

    if (open) {
      this.window.contentView.addChildView(this.appView);
    } else {
      this.window.contentView.addChildView(this.appView, 0);
    }
  }

  getWindow(): BaseWindow {
    return this.window;
  }

  getTabManager(): TabManager {
    return this.tabManager;
  }

  destroy(): void {
    this.ytdlpUpdater.stop();
    this.keyboardShortcuts.destroy();
    this.downloadManager.destroy();
    this.mediaDetector.destroy();
    this.settingsManager.destroy();
    this.googleAuthManager.destroy();
    this.autoUpdater.destroy();
    this.tabManager.destroy();
    ipcMain.removeHandler(IPC_CHANNELS.APP_SHELL_OVERLAY_SET);
    if (!this.window.isDestroyed()) {
      this.window.close();
    }
  }
}
