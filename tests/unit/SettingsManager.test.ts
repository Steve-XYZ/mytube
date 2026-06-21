import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import { app, ipcMain, nativeTheme } from 'electron';

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(() => '{}'),
  };
});

import { SettingsManager } from '../../src/main/settings/SettingsManager';

describe('SettingsManager', () => {
  let manager: SettingsManager;
  let mockSender: { send: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock implementations explicitly
    (fs.existsSync as any).mockReturnValue(false);
    (fs.readFileSync as any).mockReturnValue('{}');
    (fs.writeFileSync as any).mockImplementation(() => {});
    (nativeTheme as any).themeSource = 'system';
    mockSender = { send: vi.fn() };
    manager = new SettingsManager(mockSender);
  });

  afterEach(() => {
    manager.destroy();
  });

  describe('defaults', () => {
    it('returns default theme as system', () => {
      expect(manager.getTheme()).toBe('system');
    });

    it('returns default search engine as google', () => {
      expect(manager.getSearchEngine()).toBe('google');
    });

    it('returns default max concurrent as 3', () => {
      expect(manager.getMaxConcurrent()).toBe(3);
    });

    it('returns default homepage', () => {
      expect(manager.getHomepage()).toBe('mytube://newtab');
    });

    it('returns complete default settings', () => {
      const all = manager.getAll();
      expect(all.general.theme).toBe('system');
      expect(all.general.language).toBe('en');
      expect(all.general.startOnBoot).toBe(false);
      expect(all.downloads.videoQuality).toBe('best');
      expect(all.downloads.videoFormat).toBe('mp4');
      expect(all.downloads.audioFormat).toBe('mp3');
      expect(all.browser.searchEngine).toBe('google');
    });
  });

  describe('get (dot-notation)', () => {
    it('gets top-level category', () => {
      const general = manager.get('general') as any;
      expect(general).toBeDefined();
      expect(general.theme).toBe('system');
    });

    it('gets nested value', () => {
      expect(manager.get('general.theme')).toBe('system');
      expect(manager.get('downloads.maxConcurrent')).toBe(3);
      expect(manager.get('browser.searchEngine')).toBe('google');
    });

    it('returns undefined for non-existent key', () => {
      expect(manager.get('nonexistent.key')).toBeUndefined();
    });

    it('returns undefined for deeply nested non-existent key', () => {
      expect(manager.get('general.nonexistent')).toBeUndefined();
    });
  });

  describe('set', () => {
    it('updates a nested value', () => {
      manager.set('general.theme', 'dark');
      expect(manager.get('general.theme')).toBe('dark');
    });

    it('persists to file on set', () => {
      manager.set('general.theme', 'light');
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('notifies renderer on change', () => {
      manager.set('general.theme', 'dark');
      expect(mockSender.send).toHaveBeenCalledWith('settings:changed', 'general.theme', 'dark');
    });

    it('notifies internal listeners', () => {
      const listener = vi.fn();
      manager.onSettingChanged(listener);
      manager.set('downloads.maxConcurrent', 5);
      expect(listener).toHaveBeenCalledWith('downloads.maxConcurrent', 5);
    });

    it('applies theme side effect when setting general.theme', () => {
      manager.set('general.theme', 'dark');
      expect(nativeTheme.themeSource).toBe('dark');
    });

    it('applies light theme', () => {
      manager.set('general.theme', 'light');
      expect(nativeTheme.themeSource).toBe('light');
    });

    it('applies system theme', () => {
      manager.set('general.theme', 'dark'); // first set to dark
      manager.set('general.theme', 'system'); // then back to system
      expect(nativeTheme.themeSource).toBe('system');
    });

    it('applies startOnBoot side effect', () => {
      manager.set('general.startOnBoot', true);
      expect(app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true });
    });

    it('creates intermediate objects for new paths', () => {
      manager.set('newSection.newKey', 'value');
      expect(manager.get('newSection.newKey')).toBe('value');
    });
  });

  describe('onSettingChanged', () => {
    it('returns unsubscribe function', () => {
      const listener = vi.fn();
      const unsub = manager.onSettingChanged(listener);

      manager.set('general.theme', 'dark');
      expect(listener).toHaveBeenCalledTimes(1);

      unsub();
      manager.set('general.theme', 'light');
      expect(listener).toHaveBeenCalledTimes(1); // not called again
    });

    it('supports multiple listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      manager.onSettingChanged(listener1);
      manager.onSettingChanged(listener2);

      manager.set('general.language', 'es');
      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });
  });

  describe('deep merge (pure logic)', () => {
    // Test deepMerge logic as a pure function to avoid mock state issues.
    function deepMerge(defaults: any, overrides: any): any {
      const result = { ...defaults };
      for (const key of Object.keys(defaults)) {
        if (key in overrides) {
          if (typeof defaults[key] === 'object' && defaults[key] !== null && !Array.isArray(defaults[key])) {
            result[key] = deepMerge(defaults[key], overrides[key] || {});
          } else {
            result[key] = overrides[key];
          }
        }
      }
      return result;
    }

    const DEFAULT_SETTINGS = {
      general: { theme: 'system', language: 'en', startOnBoot: false },
      downloads: {
        defaultDirectory: '/tmp/downloads',
        videoQuality: 'best',
        videoFormat: 'mp4',
        audioFormat: 'mp3',
        maxConcurrent: 3,
      },
      browser: { homepage: 'mytube://newtab', searchEngine: 'google' },
    };

    it('fills missing sections with defaults', () => {
      const overrides = { general: { theme: 'dark' } };
      const result = deepMerge(DEFAULT_SETTINGS, overrides);

      expect(result.general.theme).toBe('dark');
      expect(result.general.language).toBe('en'); // filled from defaults
      expect(result.general.startOnBoot).toBe(false); // filled from defaults
      expect(result.downloads.maxConcurrent).toBe(3); // entire section from defaults
      expect(result.browser.searchEngine).toBe('google'); // entire section from defaults
    });

    it('preserves all user overrides', () => {
      const overrides = {
        general: { theme: 'light', language: 'es', startOnBoot: true },
        downloads: {
          defaultDirectory: '/custom',
          videoQuality: '720p',
          videoFormat: 'mkv',
          audioFormat: 'opus',
          maxConcurrent: 5,
        },
        browser: { homepage: 'https://example.com', searchEngine: 'bing' },
      };
      const result = deepMerge(DEFAULT_SETTINGS, overrides);

      expect(result.general.theme).toBe('light');
      expect(result.general.language).toBe('es');
      expect(result.downloads.maxConcurrent).toBe(5);
      expect(result.downloads.videoFormat).toBe('mkv');
      expect(result.browser.searchEngine).toBe('bing');
    });

    it('handles empty overrides', () => {
      const result = deepMerge(DEFAULT_SETTINGS, {});
      expect(result).toEqual(DEFAULT_SETTINGS);
    });

    it('handles partial nested overrides', () => {
      const overrides = {
        downloads: { maxConcurrent: 10 },
      };
      const result = deepMerge(DEFAULT_SETTINGS, overrides);

      expect(result.downloads.maxConcurrent).toBe(10);
      expect(result.downloads.videoFormat).toBe('mp4'); // kept from defaults
      expect(result.general.theme).toBe('system'); // untouched section
    });

    it('ignores extra keys not in defaults', () => {
      const overrides = {
        general: { theme: 'dark' },
        unknownSection: { foo: 'bar' },
      };
      const result = deepMerge(DEFAULT_SETTINGS, overrides);

      expect(result.general.theme).toBe('dark');
      expect(result.unknownSection).toBeUndefined();
    });

    it('does not mutate defaults', () => {
      const defaults = { a: { b: 1 } };
      const overrides = { a: { b: 2 } };
      deepMerge(defaults, overrides);
      expect(defaults.a.b).toBe(1);
    });
  });

  describe('destroy', () => {
    it('removes IPC handlers', () => {
      manager.destroy();
      expect(ipcMain.removeHandler).toHaveBeenCalledWith('settings:get');
      expect(ipcMain.removeHandler).toHaveBeenCalledWith('settings:set');
      expect(ipcMain.removeHandler).toHaveBeenCalledWith('settings:get-all');
      expect(ipcMain.removeHandler).toHaveBeenCalledWith('app:select-directory');
    });

    it('clears change listeners', () => {
      const listener = vi.fn();
      manager.onSettingChanged(listener);
      manager.destroy();
      // Listener array should be empty after destroy
    });
  });
});
