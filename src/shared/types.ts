// ===== Tab Types =====
export type MediaDetectionState = 'none' | 'detecting' | 'detected' | 'unsupported';

export interface TabInfo {
  id: string;
  title: string;
  url: string;
  favicon?: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  isSecure: boolean;
  zoomLevel: number;
  webContentsId: number;
  mediaState: MediaDetectionState;
  mediaTitle?: string;
}

// ===== Download Types =====
export type DownloadStatus = 'queued' | 'downloading' | 'paused' | 'completed' | 'failed';

export interface DownloadItem {
  id: string;
  url: string;
  title: string;
  filename: string;
  savePath: string;
  type: 'video' | 'image' | 'audio';
  status: DownloadStatus;
  progress: number;
  speed?: string;
  eta?: string;
  totalSize?: string;
  downloadedSize?: string;
  format?: string;
  thumbnail?: string;
  error?: string;
  createdAt: number;
  completedAt?: number;
}

export interface VideoFormat {
  formatId: string;
  ext: string;
  resolution?: string;
  fps?: number;
  vcodec?: string;
  acodec?: string;
  filesize?: number;
  filesizeApprox?: number;
  label: string;
  hasVideo: boolean;
  hasAudio: boolean;
}

export interface VideoInfo {
  id: string;
  title: string;
  description?: string;
  thumbnail?: string;
  duration?: number;
  uploader?: string;
  url: string;
  formats: VideoFormat[];
}

// ===== Auth Types =====
export interface GoogleAuthStatus {
  configured: boolean;
  signedIn: boolean;
  email?: string;
  name?: string;
  picture?: string;
  youtubeChannelTitle?: string;
  scopes?: string[];
  error?: string;
}

// ===== IPC Channel Types =====
export const IPC_CHANNELS = {
  // Tab management
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
  TAB_ACTIVE_GET: 'tab:active-get',
  TAB_ACTIVE_CHANGED: 'tab:active-changed',

  // Zoom
  ZOOM_IN: 'zoom:in',
  ZOOM_OUT: 'zoom:out',
  ZOOM_RESET: 'zoom:reset',

  // Find in page
  FIND_IN_PAGE: 'find:in-page',
  FIND_NEXT: 'find:next',
  FIND_PREVIOUS: 'find:previous',
  FIND_STOP: 'find:stop',
  FIND_RESULT: 'find:result',

  // Context menu
  CONTEXT_MENU_OPEN_LINK: 'context:open-link',
  CONTEXT_MENU_COPY_LINK: 'context:copy-link',
  CONTEXT_MENU_SAVE_IMAGE: 'context:save-image',

  // Download management
  DOWNLOAD_START: 'download:start',
  DOWNLOAD_PAUSE: 'download:pause',
  DOWNLOAD_RESUME: 'download:resume',
  DOWNLOAD_RETRY: 'download:retry',
  DOWNLOAD_CANCEL: 'download:cancel',
  DOWNLOAD_PROGRESS: 'download:progress',
  DOWNLOAD_COMPLETE: 'download:complete',
  DOWNLOAD_ERROR: 'download:error',
  DOWNLOAD_LIST: 'download:list',

  // Media detection
  MEDIA_DETECTED: 'media:detected',
  MEDIA_GET_INFO: 'media:get-info',
  MEDIA_GET_FORMATS: 'media:get-formats',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_GET_ALL: 'settings:get-all',

  // Auth
  AUTH_GOOGLE_STATUS: 'auth:google-status',
  AUTH_GOOGLE_SIGN_IN: 'auth:google-sign-in',
  AUTH_GOOGLE_SIGN_OUT: 'auth:google-sign-out',

  // App
  // Site permissions
  PERMISSION_REQUEST: 'permission:request',
  PERMISSION_RESPOND: 'permission:respond',
  PERMISSION_CLEAR_ALL: 'permission:clear-all',

  // History & bookmarks
  HISTORY_LIST: 'history:list',
  HISTORY_DELETE: 'history:delete',
  HISTORY_CLEAR: 'history:clear',
  BOOKMARK_TOGGLE: 'bookmark:toggle',
  BOOKMARK_LIST: 'bookmark:list',
  BOOKMARK_REMOVE: 'bookmark:remove',
  BOOKMARK_STATUS: 'bookmark:status',
  BOOKMARK_CHANGED: 'bookmark:changed',

  APP_GET_VERSION: 'app:get-version',
  APP_SELECT_DIRECTORY: 'app:select-directory',
  APP_SHELL_OVERLAY_SET: 'app:shell-overlay-set',
} as const;

// ===== Find In Page =====
export interface FindInPageResult {
  activeMatchOrdinal: number;
  matches: number;
}

// ===== History & Bookmarks =====
export interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  visitedAt: number;
}

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  createdAt: number;
}

// ===== Settings Types =====
export interface AppSettings {
  general: {
    theme: 'light' | 'dark' | 'system';
    language: 'en' | 'es';
    startOnBoot: boolean;
  };
  downloads: {
    defaultDirectory: string;
    videoQuality: 'best' | '1080p' | '720p' | '480p' | 'audio-only';
    videoFormat: 'mp4' | 'mkv' | 'webm';
    audioFormat: 'mp3' | 'm4a' | 'opus';
    maxConcurrent: number;
    speedLimitKbps: number;
    autoUpdateYtDlp: boolean;
  };
  browser: {
    homepage: string;
    searchEngine: 'google' | 'duckduckgo' | 'bing';
    restoreSession: boolean;
  };
}
