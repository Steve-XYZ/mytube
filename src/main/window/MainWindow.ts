import { BaseWindow, WebContentsView } from 'electron';
import * as path from 'path';
import {
  DEFAULT_WINDOW_WIDTH,
  DEFAULT_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  APP_NAME,
} from '../../shared/constants';
import { TabManager } from './TabManager';
import { KeyboardShortcuts } from './KeyboardShortcuts';
import { DownloadManager } from '../download/DownloadManager';
import { MediaDetector } from '../media/MediaDetector';
import { SettingsManager } from '../settings/SettingsManager';
import { AutoUpdater } from '../updater/AutoUpdater';
import { AppMenu } from './AppMenu';

export class MainWindow {
  private window: BaseWindow;
  private appView: WebContentsView;
  private tabManager: TabManager;
  private keyboardShortcuts: KeyboardShortcuts;
  private downloadManager: DownloadManager;
  private mediaDetector: MediaDetector;
  private settingsManager: SettingsManager;
  private autoUpdater: AutoUpdater;

  constructor() {
    this.window = new BaseWindow({
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT,
      minWidth: MIN_WINDOW_WIDTH,
      minHeight: MIN_WINDOW_HEIGHT,
      title: APP_NAME,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 12, y: 10 },
      show: false,
    });

    const preloadPath = path.join(__dirname, '..', '..', 'preload', 'index.js');

    this.appView = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        preload: preloadPath,
      },
    });

    this.window.contentView.addChildView(this.appView);
    this.updateAppViewBounds();

    // Initialize managers
    this.settingsManager = new SettingsManager(this.appView.webContents);
    this.mediaDetector = new MediaDetector(this.appView.webContents);
    this.tabManager = new TabManager(this.window, this.appView, preloadPath, this.settingsManager, this.mediaDetector);
    this.keyboardShortcuts = new KeyboardShortcuts(this.window, this.tabManager, this.appView);
    this.downloadManager = new DownloadManager(this.appView.webContents, this.settingsManager);
    this.autoUpdater = new AutoUpdater(this.appView.webContents);

    // Set up native app menu
    new AppMenu(this.tabManager, this.appView);

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
        ? "default-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' http://localhost:*; style-src 'self' 'unsafe-inline'; img-src 'self' https: http: data:; connect-src 'self' http://localhost:* ws://localhost:*;"
        : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self' https:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';";

      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [csp],
        },
      });
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

    // Create the first tab
    this.tabManager.createTab();
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

  getWindow(): BaseWindow {
    return this.window;
  }

  getTabManager(): TabManager {
    return this.tabManager;
  }

  destroy(): void {
    this.keyboardShortcuts.destroy();
    this.downloadManager.destroy();
    this.mediaDetector.destroy();
    this.settingsManager.destroy();
    this.autoUpdater.destroy();
    this.tabManager.destroy();
    if (!this.window.isDestroyed()) {
      this.window.close();
    }
  }
}
