import { contextBridge, ipcRenderer } from 'electron';

// Keep the preload self-contained. Sandboxed Electron preloads cannot rely on
// runtime imports from sibling compiled modules.
const IPC_CHANNELS = {
  TAB_CREATE: 'tab:create',
  TAB_CLOSE: 'tab:close',
  TAB_SWITCH: 'tab:switch',
  TAB_NAVIGATE: 'tab:navigate',
  TAB_GO_BACK: 'tab:go-back',
  TAB_GO_FORWARD: 'tab:go-forward',
  TAB_RELOAD: 'tab:reload',
  TAB_STOP: 'tab:stop',
  TAB_UPDATE: 'tab:update',
  TAB_LIST: 'tab:list',
  TAB_ACTIVE_CHANGED: 'tab:active-changed',
  ZOOM_IN: 'zoom:in',
  ZOOM_OUT: 'zoom:out',
  ZOOM_RESET: 'zoom:reset',
  FIND_IN_PAGE: 'find:in-page',
  FIND_NEXT: 'find:next',
  FIND_PREVIOUS: 'find:previous',
  FIND_STOP: 'find:stop',
  FIND_RESULT: 'find:result',
  DOWNLOAD_START: 'download:start',
  DOWNLOAD_PAUSE: 'download:pause',
  DOWNLOAD_RESUME: 'download:resume',
  DOWNLOAD_CANCEL: 'download:cancel',
  DOWNLOAD_PROGRESS: 'download:progress',
  DOWNLOAD_COMPLETE: 'download:complete',
  DOWNLOAD_ERROR: 'download:error',
  DOWNLOAD_LIST: 'download:list',
  MEDIA_DETECTED: 'media:detected',
  MEDIA_GET_INFO: 'media:get-info',
  MEDIA_GET_FORMATS: 'media:get-formats',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_GET_ALL: 'settings:get-all',
  APP_GET_VERSION: 'app:get-version',
  APP_SELECT_DIRECTORY: 'app:select-directory',
} as const;

const electronAPI = {
  // Tab management
  createTab: (url?: string) => ipcRenderer.invoke(IPC_CHANNELS.TAB_CREATE, url),
  closeTab: (tabId: string) => ipcRenderer.invoke(IPC_CHANNELS.TAB_CLOSE, tabId),
  switchTab: (tabId: string) => ipcRenderer.invoke(IPC_CHANNELS.TAB_SWITCH, tabId),
  navigate: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.TAB_NAVIGATE, url),
  goBack: () => ipcRenderer.invoke(IPC_CHANNELS.TAB_GO_BACK),
  goForward: () => ipcRenderer.invoke(IPC_CHANNELS.TAB_GO_FORWARD),
  reload: () => ipcRenderer.invoke(IPC_CHANNELS.TAB_RELOAD),
  stopLoading: () => ipcRenderer.invoke(IPC_CHANNELS.TAB_STOP),
  getTabs: () => ipcRenderer.invoke(IPC_CHANNELS.TAB_LIST),

  // Zoom
  zoomIn: () => ipcRenderer.invoke(IPC_CHANNELS.ZOOM_IN),
  zoomOut: () => ipcRenderer.invoke(IPC_CHANNELS.ZOOM_OUT),
  zoomReset: () => ipcRenderer.invoke(IPC_CHANNELS.ZOOM_RESET),

  // Find in page
  findInPage: (text: string) => ipcRenderer.invoke(IPC_CHANNELS.FIND_IN_PAGE, text),
  findNext: (text: string) => ipcRenderer.invoke(IPC_CHANNELS.FIND_NEXT, text),
  findPrevious: (text: string) => ipcRenderer.invoke(IPC_CHANNELS.FIND_PREVIOUS, text),
  stopFind: () => ipcRenderer.invoke(IPC_CHANNELS.FIND_STOP),

  // Download management
  startDownload: (url: string, options?: Record<string, unknown>) =>
    ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_START, url, options),
  pauseDownload: (downloadId: string) => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_PAUSE, downloadId),
  resumeDownload: (downloadId: string) => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_RESUME, downloadId),
  cancelDownload: (downloadId: string) => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_CANCEL, downloadId),
  getDownloads: () => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_LIST),
  openDownloadFile: (id: string) => ipcRenderer.invoke('download:open-file', id),
  showInFolder: (id: string) => ipcRenderer.invoke('download:show-in-folder', id),
  removeDownload: (id: string) => ipcRenderer.invoke('download:remove', id),
  clearCompletedDownloads: () => ipcRenderer.invoke('download:clear-completed'),

  // Media detection
  getMediaInfo: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.MEDIA_GET_INFO, url),
  getMediaFormats: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.MEDIA_GET_FORMATS, url),

  // Image scanning and downloading
  scanPageImages: (tabWebContentsId: number) => ipcRenderer.invoke('media:scan-images', tabWebContentsId),
  downloadImage: (url: string, referer?: string) => ipcRenderer.invoke('media:download-image', url, referer),
  downloadImagesBatch: (
    images: Array<{ url: string; filename?: string }>,
    options?: { referer?: string; subDir?: string },
  ) => ipcRenderer.invoke('media:download-images-batch', images, options),

  // Settings
  getSetting: (key: string) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET, key),
  setSetting: (key: string, value: unknown) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, key, value),
  getAllSettings: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_ALL),

  // App
  getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_VERSION),
  selectDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.APP_SELECT_DIRECTORY),

  // === Event listeners (main -> renderer) ===

  onTabUpdate: (callback: (tab: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, tab: unknown) => callback(tab);
    ipcRenderer.on(IPC_CHANNELS.TAB_UPDATE, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TAB_UPDATE, handler);
    };
  },
  onActiveTabChanged: (callback: (tabId: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, tabId: string) => callback(tabId);
    ipcRenderer.on(IPC_CHANNELS.TAB_ACTIVE_CHANGED, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TAB_ACTIVE_CHANGED, handler);
    };
  },
  onDownloadProgress: (callback: (download: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, download: unknown) => callback(download);
    ipcRenderer.on(IPC_CHANNELS.DOWNLOAD_PROGRESS, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.DOWNLOAD_PROGRESS, handler);
    };
  },
  onDownloadComplete: (callback: (download: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, download: unknown) => callback(download);
    ipcRenderer.on(IPC_CHANNELS.DOWNLOAD_COMPLETE, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.DOWNLOAD_COMPLETE, handler);
    };
  },
  onDownloadError: (callback: (download: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, download: unknown) => callback(download);
    ipcRenderer.on(IPC_CHANNELS.DOWNLOAD_ERROR, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.DOWNLOAD_ERROR, handler);
    };
  },
  onMediaDetected: (callback: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.MEDIA_DETECTED, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.MEDIA_DETECTED, handler);
    };
  },
  onImageBatchProgress: (callback: (progress: { completed: number; total: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: { completed: number; total: number }) =>
      callback(progress);
    ipcRenderer.on('media:batch-progress', handler);
    return () => {
      ipcRenderer.removeListener('media:batch-progress', handler);
    };
  },
  onFindResult: (callback: (result: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, result: unknown) => callback(result);
    ipcRenderer.on(IPC_CHANNELS.FIND_RESULT, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.FIND_RESULT, handler);
    };
  },

  // Shortcut events from main process
  onFocusUrl: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('shortcut:focus-url', handler);
    return () => {
      ipcRenderer.removeListener('shortcut:focus-url', handler);
    };
  },
  onToggleFind: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('shortcut:toggle-find', handler);
    return () => {
      ipcRenderer.removeListener('shortcut:toggle-find', handler);
    };
  },
  onEscape: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('shortcut:escape', handler);
    return () => {
      ipcRenderer.removeListener('shortcut:escape', handler);
    };
  },
  onDownloadMedia: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('shortcut:download-media', handler);
    return () => {
      ipcRenderer.removeListener('shortcut:download-media', handler);
    };
  },
  onToggleDownloads: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('shortcut:toggle-downloads', handler);
    return () => {
      ipcRenderer.removeListener('shortcut:toggle-downloads', handler);
    };
  },
  onSettingsChanged: (callback: (key: string, value: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, key: string, value: unknown) => callback(key, value);
    ipcRenderer.on('settings:changed', handler);
    return () => {
      ipcRenderer.removeListener('settings:changed', handler);
    };
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ElectronAPI = typeof electronAPI;
