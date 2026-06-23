import { vi } from 'vitest';

// Mock electron-log before anything imports it
vi.mock('electron-log/main', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock electron module
vi.mock('electron', () => {
  const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>();

  return {
    app: {
      getPath: vi.fn((name: string) => {
        if (name === 'downloads') return '/tmp/test-downloads';
        if (name === 'userData') return '/tmp/test-userdata';
        return '/tmp/test';
      }),
      getAppPath: vi.fn(() => '/tmp/test-app'),
      isPackaged: false,
      dock: {
        setBadge: vi.fn(),
      },
      setLoginItemSettings: vi.fn(),
    },
    ipcMain: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        ipcHandlers.set(channel, handler);
      }),
      removeHandler: vi.fn((channel: string) => {
        ipcHandlers.delete(channel);
      }),
      // Helper for tests to invoke handlers
      _handlers: ipcHandlers,
    },
    dialog: {
      showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
      showSaveDialog: vi.fn().mockResolvedValue({ canceled: true }),
    },
    shell: {
      openPath: vi.fn(),
      showItemInFolder: vi.fn(),
    },
    nativeTheme: {
      themeSource: 'system',
    },
    Notification: Object.assign(
      vi.fn().mockImplementation(() => ({
        show: vi.fn(),
        on: vi.fn(),
      })),
      { isSupported: vi.fn(() => true) },
    ),
    BaseWindow: vi.fn(),
    WebContentsView: vi.fn(),
    session: {
      defaultSession: {
        webRequest: { onHeadersReceived: vi.fn() },
      },
    },
    Menu: {
      buildFromTemplate: vi.fn(),
      setApplicationMenu: vi.fn(),
    },
    webContents: {
      fromId: vi.fn(),
    },
  };
});
