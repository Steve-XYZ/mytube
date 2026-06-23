import { describe, it, expect } from 'vitest';
import { IPC_CHANNELS } from '../../src/shared/types';
import {
  APP_NAME,
  DEFAULT_URL,
  NEW_TAB_URL,
  TAB_BAR_HEIGHT,
  NAV_BAR_HEIGHT,
  HEADER_HEIGHT,
} from '../../src/shared/constants';

describe('IPC_CHANNELS', () => {
  it('has all tab channels defined', () => {
    expect(IPC_CHANNELS.TAB_CREATE).toBe('tab:create');
    expect(IPC_CHANNELS.TAB_CLOSE).toBe('tab:close');
    expect(IPC_CHANNELS.TAB_SWITCH).toBe('tab:switch');
    expect(IPC_CHANNELS.TAB_NAVIGATE).toBe('tab:navigate');
    expect(IPC_CHANNELS.TAB_GO_BACK).toBe('tab:go-back');
    expect(IPC_CHANNELS.TAB_GO_FORWARD).toBe('tab:go-forward');
    expect(IPC_CHANNELS.TAB_RELOAD).toBe('tab:reload');
    expect(IPC_CHANNELS.TAB_STOP).toBe('tab:stop');
    expect(IPC_CHANNELS.TAB_UPDATE).toBe('tab:update');
    expect(IPC_CHANNELS.TAB_LIST).toBe('tab:list');
    expect(IPC_CHANNELS.TAB_ACTIVE_GET).toBe('tab:active-get');
    expect(IPC_CHANNELS.TAB_ACTIVE_CHANGED).toBe('tab:active-changed');
  });

  it('has all download channels defined', () => {
    expect(IPC_CHANNELS.DOWNLOAD_START).toBe('download:start');
    expect(IPC_CHANNELS.DOWNLOAD_PAUSE).toBe('download:pause');
    expect(IPC_CHANNELS.DOWNLOAD_RESUME).toBe('download:resume');
    expect(IPC_CHANNELS.DOWNLOAD_CANCEL).toBe('download:cancel');
    expect(IPC_CHANNELS.DOWNLOAD_PROGRESS).toBe('download:progress');
    expect(IPC_CHANNELS.DOWNLOAD_COMPLETE).toBe('download:complete');
    expect(IPC_CHANNELS.DOWNLOAD_ERROR).toBe('download:error');
    expect(IPC_CHANNELS.DOWNLOAD_LIST).toBe('download:list');
  });

  it('has all media channels defined', () => {
    expect(IPC_CHANNELS.MEDIA_DETECTED).toBe('media:detected');
    expect(IPC_CHANNELS.MEDIA_GET_INFO).toBe('media:get-info');
    expect(IPC_CHANNELS.MEDIA_GET_FORMATS).toBe('media:get-formats');
  });

  it('has all settings channels defined', () => {
    expect(IPC_CHANNELS.SETTINGS_GET).toBe('settings:get');
    expect(IPC_CHANNELS.SETTINGS_SET).toBe('settings:set');
    expect(IPC_CHANNELS.SETTINGS_GET_ALL).toBe('settings:get-all');
    expect(IPC_CHANNELS.APP_SHELL_OVERLAY_SET).toBe('app:shell-overlay-set');
  });

  it('has zoom channels defined', () => {
    expect(IPC_CHANNELS.ZOOM_IN).toBe('zoom:in');
    expect(IPC_CHANNELS.ZOOM_OUT).toBe('zoom:out');
    expect(IPC_CHANNELS.ZOOM_RESET).toBe('zoom:reset');
  });

  it('has find channels defined', () => {
    expect(IPC_CHANNELS.FIND_IN_PAGE).toBe('find:in-page');
    expect(IPC_CHANNELS.FIND_NEXT).toBe('find:next');
    expect(IPC_CHANNELS.FIND_PREVIOUS).toBe('find:previous');
    expect(IPC_CHANNELS.FIND_STOP).toBe('find:stop');
    expect(IPC_CHANNELS.FIND_RESULT).toBe('find:result');
  });

  it('channel names follow namespace:action convention', () => {
    const channels = Object.values(IPC_CHANNELS);
    for (const channel of channels) {
      expect(channel).toMatch(/^[a-z]+:[a-z-]+$/);
    }
  });

  it('all channel values are unique', () => {
    const channels = Object.values(IPC_CHANNELS);
    const unique = new Set(channels);
    expect(unique.size).toBe(channels.length);
  });
});

describe('Constants', () => {
  it('has correct app name', () => {
    expect(APP_NAME).toBe('MyTube');
  });

  it('has valid default URL', () => {
    expect(DEFAULT_URL).toBe('https://www.google.com');
    expect(() => new URL(DEFAULT_URL)).not.toThrow();
  });

  it('has custom protocol for new tab', () => {
    expect(NEW_TAB_URL).toBe('mytube://newtab');
  });

  it('has consistent header height', () => {
    expect(HEADER_HEIGHT).toBe(TAB_BAR_HEIGHT + NAV_BAR_HEIGHT);
  });

  it('has reasonable tab bar height', () => {
    expect(TAB_BAR_HEIGHT).toBeGreaterThan(20);
    expect(TAB_BAR_HEIGHT).toBeLessThan(100);
  });

  it('has reasonable nav bar height', () => {
    expect(NAV_BAR_HEIGHT).toBeGreaterThan(20);
    expect(NAV_BAR_HEIGHT).toBeLessThan(100);
  });
});
