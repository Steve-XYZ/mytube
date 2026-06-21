import { app, ipcMain, nativeTheme, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { IPC_CHANNELS, AppSettings } from '../../shared/types';
import log from 'electron-log/main';

type WebContentsSender = { send: (channel: string, ...args: any[]) => void };

const DEFAULT_SETTINGS: AppSettings = {
  general: {
    theme: 'system',
    language: 'en',
    startOnBoot: false,
  },
  downloads: {
    defaultDirectory: path.join(app.getPath('downloads'), 'MyTube'),
    videoQuality: 'best',
    videoFormat: 'mp4',
    audioFormat: 'mp3',
    maxConcurrent: 3,
  },
  browser: {
    homepage: 'mytube://newtab',
    searchEngine: 'google',
  },
};

export class SettingsManager {
  private settings: AppSettings;
  private filePath: string;
  private appViewSender: WebContentsSender;
  private changeListeners: Array<(key: string, value: unknown) => void> = [];

  constructor(appViewSender: WebContentsSender) {
    this.appViewSender = appViewSender;
    this.filePath = path.join(app.getPath('userData'), 'settings.json');
    this.settings = this.loadSettings();

    this.setupIpcHandlers();
    this.applyTheme();

    log.info('SettingsManager initialized');
  }

  private loadSettings(): AppSettings {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const data = JSON.parse(raw);
        // Deep merge with defaults to handle new settings added in updates
        return this.deepMerge(DEFAULT_SETTINGS, data);
      }
    } catch (err: any) {
      log.error('Failed to load settings:', err.message);
      // Backup corrupted file before resetting to defaults
      this.backupCorruptedFile();
    }
    return { ...DEFAULT_SETTINGS };
  }

  private backupCorruptedFile(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const backupPath = `${this.filePath}.corrupted.${Date.now()}`;
        fs.copyFileSync(this.filePath, backupPath);
        log.info(`Corrupted settings backed up to: ${backupPath}`);
      }
    } catch (err: any) {
      log.error('Failed to backup corrupted settings:', err.message);
    }
  }

  private saveSettings(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.settings, null, 2), 'utf-8');
    } catch (err: any) {
      if (err.code === 'ENOSPC') {
        log.error('Disk full — cannot save settings');
      } else {
        log.error('Failed to save settings:', err.message);
      }
    }
  }

  private deepMerge(defaults: any, overrides: any): any {
    const result = { ...defaults };
    for (const key of Object.keys(defaults)) {
      if (key in overrides) {
        if (typeof defaults[key] === 'object' && defaults[key] !== null && !Array.isArray(defaults[key])) {
          result[key] = this.deepMerge(defaults[key], overrides[key] || {});
        } else {
          result[key] = overrides[key];
        }
      }
    }
    return result;
  }

  /** Valid top-level setting categories */
  private static readonly VALID_CATEGORIES = ['general', 'downloads', 'browser'];

  private setupIpcHandlers(): void {
    ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, (_event, key: string) => {
      if (typeof key !== 'string' || key.length === 0 || key.length > 100) return undefined;
      return this.get(key);
    });

    ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, (_event, key: string, value: unknown) => {
      if (typeof key !== 'string' || key.length === 0 || key.length > 100) return;
      // Only allow setting known categories
      const category = key.split('.')[0];
      if (!SettingsManager.VALID_CATEGORIES.includes(category)) {
        log.warn(`Rejected setting unknown category: ${key}`);
        return;
      }
      this.set(key, value);
    });

    ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_ALL, () => {
      return this.getAll();
    });

    ipcMain.handle(IPC_CHANNELS.APP_SELECT_DIRECTORY, async () => {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
      });
      if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
      }
      return null;
    });
  }

  get(key: string): unknown {
    const parts = key.split('.');
    let current: any = this.settings;
    for (const part of parts) {
      if (current == null || typeof current !== 'object') return undefined;
      current = current[part];
    }
    return current;
  }

  set(key: string, value: unknown): void {
    const parts = key.split('.');
    let current: any = this.settings;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in current)) current[parts[i]] = {};
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
    this.saveSettings();

    log.info(`Setting changed: ${key}`);

    // Apply side effects
    if (key === 'general.theme') {
      this.applyTheme();
    }

    if (key === 'general.startOnBoot') {
      this.applyStartOnBoot(value as boolean);
    }

    // Notify renderer of change
    this.appViewSender.send('settings:changed', key, value);

    // Notify internal listeners
    for (const listener of this.changeListeners) {
      listener(key, value);
    }
  }

  getAll(): AppSettings {
    return this.settings;
  }

  onSettingChanged(listener: (key: string, value: unknown) => void): () => void {
    this.changeListeners.push(listener);
    return () => {
      const idx = this.changeListeners.indexOf(listener);
      if (idx >= 0) this.changeListeners.splice(idx, 1);
    };
  }

  private applyTheme(): void {
    const theme = this.settings.general.theme;
    if (theme === 'light') {
      nativeTheme.themeSource = 'light';
    } else if (theme === 'dark') {
      nativeTheme.themeSource = 'dark';
    } else {
      nativeTheme.themeSource = 'system';
    }
  }

  private applyStartOnBoot(enabled: boolean): void {
    app.setLoginItemSettings({
      openAtLogin: enabled,
    });
  }

  // Convenience getters
  getDownloadDirectory(): string {
    return this.settings.downloads.defaultDirectory;
  }

  getMaxConcurrent(): number {
    return this.settings.downloads.maxConcurrent;
  }

  getSearchEngine(): string {
    return this.settings.browser.searchEngine;
  }

  getHomepage(): string {
    return this.settings.browser.homepage;
  }

  getTheme(): string {
    return this.settings.general.theme;
  }

  destroy(): void {
    ipcMain.removeHandler(IPC_CHANNELS.SETTINGS_GET);
    ipcMain.removeHandler(IPC_CHANNELS.SETTINGS_SET);
    ipcMain.removeHandler(IPC_CHANNELS.SETTINGS_GET_ALL);
    ipcMain.removeHandler(IPC_CHANNELS.APP_SELECT_DIRECTORY);
    this.changeListeners = [];
  }
}
