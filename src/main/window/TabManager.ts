import {
  app,
  BaseWindow,
  WebContentsView,
  ipcMain,
  session,
  Menu,
  MenuItem,
  clipboard,
  dialog,
  type BrowserWindow,
} from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { TabInfo, IPC_CHANNELS, FindInPageResult } from '../../shared/types';
import {
  DEFAULT_URL,
  HEADER_HEIGHT,
  SIDEBAR_WIDTH_COLLAPSED,
  SIDEBAR_WIDTH_EXPANDED,
} from '../../shared/constants';
import type { SettingsManager } from '../settings/SettingsManager';
import { writeFileAtomic } from '../utils/fsAtomic';
import { YtDlpController } from '../download/YtDlpController';
import { isDirectMediaResourceUrl, isLikelyMediaUrl } from '../download/MediaUrlClassifier';
import {
  rankCapturedMediaCandidates,
  resolveDownloadTarget as selectDownloadTarget,
  type ActiveMediaSnapshot,
  type DownloadTarget,
} from '../download/DownloadTargetResolver';
import type { CapturedMediaFallback, MediaFallbackProvider } from '../download/MediaFallbackProvider';
import type { MediaDetector } from '../media/MediaDetector';
import log from 'electron-log/main';

interface ManagedTab {
  id: string;
  view: WebContentsView;
  info: TabInfo;
  suspendedUrl?: string;
  pendingMainFrameUrl?: string;
  lastActiveAt: number;
}

const TAB_SUSPEND_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const MAX_TABS = 20;
const SESSION_SAVE_DEBOUNCE_MS = 1000;
const MAX_CAPTURED_MEDIA_PER_TAB = 20;
const MAX_PENDING_MEDIA_REQUESTS = 200;
const CAPTURED_MEDIA_TTL_MS = 10 * 60 * 1000;

interface MediaRequestDetails {
  id: number;
  webContentsId?: number;
  url: string;
  resourceType?: string;
  requestHeaders?: Record<string, string | string[]>;
  responseHeaders?: Record<string, string[]>;
  statusCode?: number;
}

interface PendingMediaRequest {
  fallback: CapturedMediaFallback;
  navigationId: number;
}

/** Receives main-frame navigations for the browsing history. */
export interface VisitRecorder {
  recordVisit(url: string, title: string): void;
  updateVisitTitle(url: string, title: string): void;
}

interface SavedSessionTab {
  url: string;
  title: string;
}

interface SavedSession {
  tabs: SavedSessionTab[];
  activeIndex: number;
}

export class TabManager implements MediaFallbackProvider {
  private tabs: Map<string, ManagedTab> = new Map();
  private activeTabId: string | null = null;
  private tabIdsByWebContentsId: Map<number, string> = new Map();
  private capturedMediaByTabId: Map<string, CapturedMediaFallback[]> = new Map();
  private pendingMediaRequests: Map<number, PendingMediaRequest> = new Map();
  private navigationIdsByTabId: Map<string, number> = new Map();
  private popupWindows: Set<BrowserWindow> = new Set();
  private window: BaseWindow;
  private appView: WebContentsView;
  private nextTabId = 1;
  private preloadPath: string;
  private settingsManager?: SettingsManager;
  private mediaDetector?: MediaDetector;
  private ytdlp: YtDlpController;
  private mediaDetectionAbort: Map<string, boolean> = new Map();
  private suspendTimer: ReturnType<typeof setInterval> | null = null;
  private sessionFilePath: string;
  private sessionSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private visitRecorder?: VisitRecorder;
  private unsubscribeSettings?: () => void;

  constructor(
    window: BaseWindow,
    appView: WebContentsView,
    preloadPath: string,
    settingsManager?: SettingsManager,
    mediaDetector?: MediaDetector,
    visitRecorder?: VisitRecorder,
  ) {
    this.window = window;
    this.appView = appView;
    this.preloadPath = preloadPath;
    this.settingsManager = settingsManager;
    this.mediaDetector = mediaDetector;
    this.visitRecorder = visitRecorder;
    this.ytdlp = new YtDlpController();
    this.sessionFilePath = path.join(app.getPath('userData'), 'session-state.json');
    this.setupIpcHandlers();
    this.setupPermissions();
    this.setupMediaRequestCapture();
    this.startSuspendTimer();
    this.unsubscribeSettings = settingsManager?.onSettingChanged((key) => {
      if (key === 'browser.sidebarCollapsed') this.updateAllTabBounds();
    });
  }

  // ==================== IPC Handlers ====================

  private setupIpcHandlers(): void {
    // Tab management
    ipcMain.handle(IPC_CHANNELS.TAB_CREATE, (_event, url?: string) => this.createTab(url));
    ipcMain.handle(IPC_CHANNELS.TAB_CLOSE, (_event, tabId: string) => this.closeTab(tabId));
    ipcMain.handle(IPC_CHANNELS.TAB_SWITCH, (_event, tabId: string) => this.switchTab(tabId));
    ipcMain.handle(IPC_CHANNELS.TAB_NAVIGATE, (_event, url: string) => this.navigate(url));
    ipcMain.handle(IPC_CHANNELS.TAB_GO_BACK, () => this.goBack());
    ipcMain.handle(IPC_CHANNELS.TAB_GO_FORWARD, () => this.goForward());
    ipcMain.handle(IPC_CHANNELS.TAB_RELOAD, () => this.reload());
    ipcMain.handle(IPC_CHANNELS.TAB_STOP, () => this.stopLoading());
    ipcMain.handle(IPC_CHANNELS.TAB_LIST, () => this.getTabList());
    ipcMain.handle(IPC_CHANNELS.TAB_ACTIVE_GET, () => this.getActiveTabId());

    // Zoom
    ipcMain.handle(IPC_CHANNELS.ZOOM_IN, () => this.zoomIn());
    ipcMain.handle(IPC_CHANNELS.ZOOM_OUT, () => this.zoomOut());
    ipcMain.handle(IPC_CHANNELS.ZOOM_RESET, () => this.zoomReset());

    // Find in page
    ipcMain.handle(IPC_CHANNELS.FIND_IN_PAGE, (_event, text: string) => this.findInPage(text));
    ipcMain.handle(IPC_CHANNELS.FIND_NEXT, (_event, text: string) =>
      this.findInPage(text, { forward: true, findNext: true }),
    );
    ipcMain.handle(IPC_CHANNELS.FIND_PREVIOUS, (_event, text: string) =>
      this.findInPage(text, { forward: false, findNext: true }),
    );
    ipcMain.handle(IPC_CHANNELS.FIND_STOP, () => this.stopFindInPage());
  }

  private setupPermissions(): void {
    // Set a standard Chrome user agent to avoid being blocked by sites like YouTube.
    // Permission request/check handling lives in SitePermissionManager.
    const chromeVersion = process.versions.chrome;
    const userAgent = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
    session.defaultSession.setUserAgent(userAgent);
  }

  private setupMediaRequestCapture(): void {
    session.defaultSession.webRequest.onBeforeSendHeaders((details: MediaRequestDetails, callback) => {
      this.captureMediaRequest(details);
      callback({ requestHeaders: details.requestHeaders || {} });
    });
    session.defaultSession.webRequest.onResponseStarted((details: MediaRequestDetails) => {
      this.captureMediaResponse(details);
    });
    session.defaultSession.webRequest.onErrorOccurred((details: MediaRequestDetails) => {
      this.pendingMediaRequests.delete(details.id);
    });
  }

  // ==================== Tab Lifecycle ====================

  createTab(url?: string): TabInfo | null {
    const targetUrl = this.normalizeNavigationInput(url || this.settingsManager?.getHomepage() || DEFAULT_URL);
    const managedTab = this.buildTab(targetUrl);
    if (!managedTab) return null;

    managedTab.info.isLoading = true;
    this.loadTabUrl(managedTab, targetUrl);
    this.switchTab(managedTab.id);

    log.info(`Tab created: ${managedTab.id} -> ${targetUrl}`);
    return managedTab.info;
  }

  /** Create a managed tab (view, events, registration) without loading or activating it. */
  private buildTab(targetUrl: string, title = 'New Tab'): ManagedTab | null {
    // Enforce max tab limit
    if (this.tabs.size >= MAX_TABS) {
      log.warn(`Tab limit reached (${MAX_TABS}). Cannot create new tab.`);
      return null;
    }

    const tabId = `tab-${this.nextTabId++}`;

    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        plugins: true, // Required for Widevine/Pepper (DRM video playback)
        webgl: true, // GPU-accelerated rendering
      },
    });

    const tabInfo: TabInfo = {
      id: tabId,
      title,
      url: targetUrl,
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      isSecure: targetUrl.startsWith('https://'),
      zoomLevel: 0,
      webContentsId: view.webContents.id,
      mediaState: 'none',
    };

    const managedTab: ManagedTab = { id: tabId, view, info: tabInfo, lastActiveAt: Date.now() };
    this.tabs.set(tabId, managedTab);
    this.tabIdsByWebContentsId.set(view.webContents.id, tabId);
    this.navigationIdsByTabId.set(tabId, 0);

    this.setupTabEvents(managedTab);
    this.setupContextMenu(managedTab);
    this.mediaDetector?.registerTabWebContents(view.webContents.id);

    return managedTab;
  }

  // ==================== Session Restore ====================

  /**
   * Recreate the previous session's tabs, or open a fresh tab when restore is
   * disabled or nothing usable was saved. Restored background tabs stay
   * suspended (they load on first activation) so startup never loads N pages.
   */
  restoreSession(): void {
    const restoreEnabled = this.settingsManager ? this.settingsManager.get('browser.restoreSession') !== false : true;
    const saved = restoreEnabled ? this.readSessionState() : null;

    if (!saved) {
      this.createTab();
      return;
    }

    const restored: ManagedTab[] = [];
    for (const savedTab of saved.tabs.slice(0, MAX_TABS)) {
      const managedTab = this.buildTab(savedTab.url, savedTab.title);
      if (!managedTab) break;
      managedTab.suspendedUrl = savedTab.url;
      this.notifyTabUpdate(managedTab.info);
      restored.push(managedTab);
    }

    if (restored.length === 0) {
      this.createTab();
      return;
    }

    const activeIndex = Math.min(Math.max(saved.activeIndex, 0), restored.length - 1);
    this.switchTab(restored[activeIndex].id);
    log.info(`Session restored: ${restored.length} tab(s), active index ${activeIndex}`);
  }

  private isPersistableUrl(url: string): boolean {
    return url.startsWith('http://') || url.startsWith('https://') || url === DEFAULT_URL;
  }

  private readSessionState(): SavedSession | null {
    try {
      if (!fs.existsSync(this.sessionFilePath)) return null;
      const raw = JSON.parse(fs.readFileSync(this.sessionFilePath, 'utf-8')) as Partial<SavedSession>;
      if (!Array.isArray(raw.tabs)) return null;

      const tabs = raw.tabs
        .filter((tab): tab is SavedSessionTab => typeof tab === 'object' && tab !== null && typeof tab.url === 'string')
        .map((tab) => ({ url: tab.url, title: typeof tab.title === 'string' && tab.title ? tab.title : 'New Tab' }))
        .filter((tab) => this.isPersistableUrl(tab.url));
      if (tabs.length === 0) return null;

      return { tabs, activeIndex: typeof raw.activeIndex === 'number' ? raw.activeIndex : 0 };
    } catch (err: unknown) {
      log.warn('Failed to read session state:', err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  private scheduleSessionSave(): void {
    if (this.sessionSaveTimer) return;
    this.sessionSaveTimer = setTimeout(() => {
      this.sessionSaveTimer = null;
      this.saveSessionState();
    }, SESSION_SAVE_DEBOUNCE_MS);
  }

  private saveSessionState(): void {
    try {
      // Suspended tabs keep their target in suspendedUrl while the view is empty.
      const persistable = Array.from(this.tabs.values()).filter((tab) =>
        this.isPersistableUrl(tab.suspendedUrl || tab.info.url),
      );
      const tabs = persistable.map((tab) => ({ url: tab.suspendedUrl || tab.info.url, title: tab.info.title }));
      const activeIndex = Math.max(
        0,
        persistable.findIndex((tab) => tab.id === this.activeTabId),
      );
      writeFileAtomic(this.sessionFilePath, JSON.stringify({ tabs, activeIndex }, null, 2));
    } catch (err: unknown) {
      log.warn('Failed to save session state:', err instanceof Error ? err.message : String(err));
    }
  }

  closeTab(tabId: string): boolean {
    const tab = this.tabs.get(tabId);
    if (!tab) return false;

    this.window.contentView.removeChildView(tab.view);
    this.mediaDetector?.unregisterTabWebContents(tab.view.webContents.id);
    this.tabIdsByWebContentsId.delete(tab.view.webContents.id);
    this.capturedMediaByTabId.delete(tabId);
    this.navigationIdsByTabId.delete(tabId);
    tab.view.webContents.close();
    this.tabs.delete(tabId);

    log.info(`Tab closed: ${tabId}`);
    this.scheduleSessionSave();

    if (this.activeTabId === tabId) {
      const remaining = Array.from(this.tabs.keys());
      if (remaining.length > 0) {
        this.switchTab(remaining[remaining.length - 1]);
      } else {
        this.activeTabId = null;
        this.createTab();
      }
    }

    return true;
  }

  private isAllowedPopupUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return ['http:', 'https:', 'blob:'].includes(parsed.protocol) || url === 'about:blank';
    } catch {
      return false;
    }
  }

  switchTab(tabId: string): boolean {
    const tab = this.tabs.get(tabId);
    if (!tab) return false;

    // Hide current active tab
    if (this.activeTabId && this.activeTabId !== tabId) {
      const currentTab = this.tabs.get(this.activeTabId);
      if (currentTab) {
        this.window.contentView.removeChildView(currentTab.view);
      }
    }

    // Restore suspended tab if needed
    if (tab.suspendedUrl) {
      const restoredUrl = tab.suspendedUrl;
      tab.suspendedUrl = undefined;
      this.loadTabUrl(tab, restoredUrl);
      log.info(`Restored suspended tab ${tabId}: ${restoredUrl}`);
    }

    // Show new tab
    tab.lastActiveAt = Date.now();
    this.window.contentView.addChildView(tab.view);
    this.updateTabBounds(tab.view);
    this.activeTabId = tabId;

    this.appView.webContents.send(IPC_CHANNELS.TAB_ACTIVE_CHANGED, tabId);
    // Also send a full tab update so the nav bar refreshes
    this.notifyTabUpdate(tab.info);

    return true;
  }

  // ==================== Navigation ====================

  navigate(url: string): boolean {
    const tab = this.getActiveTab();
    if (!tab) return false;

    const finalUrl = this.normalizeNavigationInput(url);

    // Validate URL scheme before loading.
    if (!this.isAllowedUrl(finalUrl)) {
      log.warn(`Blocked navigation to disallowed URL: ${finalUrl}`);
      return false;
    }

    this.loadTabUrl(tab, finalUrl);
    return true;
  }

  private isAllowedUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return ['http:', 'https:', 'blob:', 'about:', 'mytube:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  }

  private normalizeNavigationInput(input: string): string {
    const trimmed = input.trim();

    if (!trimmed) {
      return DEFAULT_URL;
    }

    if (this.isSearchQuery(trimmed)) {
      return this.buildSearchUrl(trimmed);
    }

    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://') && !trimmed.startsWith('mytube://')) {
      return `https://${trimmed}`;
    }

    return this.isAllowedUrl(trimmed) ? trimmed : DEFAULT_URL;
  }

  private loadTabUrl(tab: ManagedTab, url: string): void {
    if (url === DEFAULT_URL) {
      tab.info.title = 'MyTube';
      tab.info.url = DEFAULT_URL;
      tab.info.isSecure = false;
      tab.info.mediaState = 'none';
      tab.info.mediaTitle = undefined;
      tab.view.webContents.loadURL(this.getNewTabDataUrl());
      this.notifyTabUpdate(tab.info);
      return;
    }

    tab.view.webContents.loadURL(url);
  }

  // Cached: getDisplayUrlForLoadedUrl compares against it on every
  // navigation event, and the exact-match check needs a stable string anyway.
  private newTabDataUrl?: string;

  private getNewTabDataUrl(): string {
    this.newTabDataUrl ??= `data:text/html;charset=utf-8,${encodeURIComponent(this.buildNewTabPage())}`;
    return this.newTabDataUrl;
  }

  private getDisplayUrlForLoadedUrl(url: string): string {
    return url === this.getNewTabDataUrl() ? DEFAULT_URL : url;
  }

  goBack(): boolean {
    const tab = this.getActiveTab();
    if (!tab || !tab.view.webContents.navigationHistory.canGoBack()) return false;
    tab.view.webContents.navigationHistory.goBack();
    return true;
  }

  goForward(): boolean {
    const tab = this.getActiveTab();
    if (!tab || !tab.view.webContents.navigationHistory.canGoForward()) return false;
    tab.view.webContents.navigationHistory.goForward();
    return true;
  }

  reload(): boolean {
    const tab = this.getActiveTab();
    if (!tab) return false;
    tab.view.webContents.reload();
    return true;
  }

  stopLoading(): boolean {
    const tab = this.getActiveTab();
    if (!tab) return false;
    tab.view.webContents.stop();
    return true;
  }

  // ==================== Zoom ====================

  zoomIn(): boolean {
    const tab = this.getActiveTab();
    if (!tab) return false;
    const current = tab.view.webContents.getZoomLevel();
    const newLevel = Math.min(current + 0.5, 5);
    tab.view.webContents.setZoomLevel(newLevel);
    tab.info.zoomLevel = newLevel;
    this.notifyTabUpdate(tab.info);
    return true;
  }

  zoomOut(): boolean {
    const tab = this.getActiveTab();
    if (!tab) return false;
    const current = tab.view.webContents.getZoomLevel();
    const newLevel = Math.max(current - 0.5, -5);
    tab.view.webContents.setZoomLevel(newLevel);
    tab.info.zoomLevel = newLevel;
    this.notifyTabUpdate(tab.info);
    return true;
  }

  zoomReset(): boolean {
    const tab = this.getActiveTab();
    if (!tab) return false;
    tab.view.webContents.setZoomLevel(0);
    tab.info.zoomLevel = 0;
    this.notifyTabUpdate(tab.info);
    return true;
  }

  // ==================== Find In Page ====================

  findInPage(text: string, options?: { forward?: boolean; findNext?: boolean }): void {
    const tab = this.getActiveTab();
    if (!tab || !text) return;

    tab.view.webContents.findInPage(text, {
      forward: options?.forward ?? true,
      findNext: options?.findNext ?? false,
    });
  }

  stopFindInPage(): void {
    const tab = this.getActiveTab();
    if (!tab) return;
    tab.view.webContents.stopFindInPage('clearSelection');
  }

  // ==================== Tab Events ====================

  private setupTabEvents(managedTab: ManagedTab): void {
    const { view, info } = managedTab;
    const wc = view.webContents;

    wc.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) {
        managedTab.pendingMainFrameUrl = url;
      }
    });

    wc.on('will-redirect', (_event, url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) {
        managedTab.pendingMainFrameUrl = url;
      }
    });

    wc.on('did-start-loading', () => {
      info.isLoading = true;
      this.notifyTabUpdate(info);
    });

    wc.on('did-stop-loading', () => {
      info.isLoading = false;
      this.notifyTabUpdate(info);
    });

    // Log console errors from tab pages (helps debug video playback issues)
    wc.on('console-message', (_event, level, message) => {
      // level: 0=verbose, 1=info, 2=warning, 3=error
      if (level >= 2) {
        log.warn(`[Tab ${info.id}] console.${level >= 3 ? 'error' : 'warn'}: ${message.slice(0, 200)}`);
      }
    });

    wc.on('did-navigate', (_event, navUrl) => {
      managedTab.pendingMainFrameUrl = undefined;
      this.updateNavState(managedTab, this.getDisplayUrlForLoadedUrl(navUrl));
      // info.title still holds the previous page's title here; record with an
      // empty title (falls back to the URL) and let page-title-updated fill it.
      this.visitRecorder?.recordVisit(info.url, '');
    });

    wc.on('did-navigate-in-page', (_event, navUrl) => {
      this.updateNavState(managedTab, this.getDisplayUrlForLoadedUrl(navUrl));
      // Same document: the current title still applies to in-page navigations.
      this.visitRecorder?.recordVisit(info.url, info.title);
    });

    wc.on('page-title-updated', (_event, title) => {
      info.title = title;
      this.notifyTabUpdate(info);
      this.visitRecorder?.updateVisitTitle(info.url, title);
    });

    wc.on('page-favicon-updated', (_event, favicons) => {
      if (favicons.length > 0) {
        info.favicon = favicons[0];
        this.notifyTabUpdate(info);
      }
    });

    // Find in page results
    wc.on('found-in-page', (_event, result) => {
      const findResult: FindInPageResult = {
        activeMatchOrdinal: result.activeMatchOrdinal,
        matches: result.matches,
      };
      this.appView.webContents.send(IPC_CHANNELS.FIND_RESULT, findResult);
    });

    // Block navigation to dangerous URL schemes (allow http, https, blob, about, and MyTube's local new tab)
    wc.on('will-navigate', (event, navUrl) => {
      try {
        const { protocol } = new URL(navUrl);
        if (!['http:', 'https:', 'blob:', 'about:', 'mytube:'].includes(protocol)) {
          event.preventDefault();
          log.warn(`Blocked will-navigate to: ${navUrl}`);
        }
      } catch {
        event.preventDefault();
      }
    });

    // Handle new window requests (popups, target=_blank)
    wc.setWindowOpenHandler(({ url: newUrl, disposition, postBody }) => {
      if (!this.isAllowedPopupUrl(newUrl) || this.tabs.size + this.popupWindows.size >= MAX_TABS) {
        return { action: 'deny' };
      }

      if ((disposition === 'foreground-tab' || disposition === 'background-tab') && !postBody) {
        this.createTab(newUrl);
        return { action: 'deny' };
      }

      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            preload: undefined,
            plugins: true,
            webgl: true,
          },
        },
      };
    });

    wc.on('did-create-window', (popup, details) => {
      this.popupWindows.add(popup);
      popup.once('closed', () => this.popupWindows.delete(popup));
      log.info(`Popup window created from ${info.id}: ${this.redactUrlForLog(details.url)}`);
    });

    // Handle certificate errors gracefully
    wc.on('certificate-error', (event, _url, _error, _cert, callback) => {
      // Don't allow invalid certs by default
      event.preventDefault();
      callback(false);
    });

    // Handle did-fail-load — show error page
    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (errorCode === -3 || !isMainFrame) return; // ERR_ABORTED and subframe failures must not replace the tab

      const expectedUrl = managedTab.pendingMainFrameUrl || managedTab.info.url;
      if (expectedUrl && this.normalizeComparableUrl(expectedUrl) !== this.normalizeComparableUrl(validatedURL)) {
        log.debug(`Ignored stale main-frame load failure for tab ${info.id}: ${this.redactUrlForLog(validatedURL)}`);
        return;
      }
      managedTab.pendingMainFrameUrl = undefined;
      log.warn(`Tab ${info.id} failed to load: ${validatedURL} (${errorCode}: ${errorDescription})`);

      const errorPage = this.buildErrorPage(errorCode, errorDescription, validatedURL);
      wc.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorPage)}`);
    });
  }

  // ==================== Context Menu ====================

  private setupContextMenu(managedTab: ManagedTab): void {
    const wc = managedTab.view.webContents;

    wc.on('context-menu', (_event, params) => {
      const menu = new Menu();

      // Link context
      if (params.linkURL) {
        menu.append(
          new MenuItem({
            label: 'Open Link in New Tab',
            click: () => this.createTab(params.linkURL),
          }),
        );
        menu.append(
          new MenuItem({
            label: 'Copy Link Address',
            click: () => clipboard.writeText(params.linkURL),
          }),
        );
        menu.append(new MenuItem({ type: 'separator' }));
      }

      // Image context
      if (params.hasImageContents && params.srcURL) {
        menu.append(
          new MenuItem({
            label: 'Open Image in New Tab',
            click: () => this.createTab(params.srcURL),
          }),
        );
        menu.append(
          new MenuItem({
            label: 'Save Image As...',
            click: () => this.saveImage(params.srcURL),
          }),
        );
        menu.append(
          new MenuItem({
            label: 'Copy Image Address',
            click: () => clipboard.writeText(params.srcURL),
          }),
        );
        menu.append(new MenuItem({ type: 'separator' }));
      }

      // Text selection
      if (params.selectionText) {
        menu.append(
          new MenuItem({
            label: 'Copy',
            role: 'copy',
          }),
        );
        menu.append(
          new MenuItem({
            label: `Search Google for "${params.selectionText.slice(0, 30)}${params.selectionText.length > 30 ? '...' : ''}"`,
            click: () => {
              this.createTab(this.buildSearchUrl(params.selectionText));
            },
          }),
        );
        menu.append(new MenuItem({ type: 'separator' }));
      }

      // Editable field
      if (params.isEditable) {
        menu.append(new MenuItem({ label: 'Cut', role: 'cut' }));
        menu.append(new MenuItem({ label: 'Copy', role: 'copy' }));
        menu.append(new MenuItem({ label: 'Paste', role: 'paste' }));
        menu.append(new MenuItem({ label: 'Select All', role: 'selectAll' }));
        menu.append(new MenuItem({ type: 'separator' }));
      }

      // Navigation
      if (!params.linkURL && !params.hasImageContents && !params.selectionText && !params.isEditable) {
        menu.append(
          new MenuItem({
            label: 'Back',
            enabled: wc.navigationHistory.canGoBack(),
            click: () => wc.navigationHistory.goBack(),
          }),
        );
        menu.append(
          new MenuItem({
            label: 'Forward',
            enabled: wc.navigationHistory.canGoForward(),
            click: () => wc.navigationHistory.goForward(),
          }),
        );
        menu.append(
          new MenuItem({
            label: 'Reload',
            click: () => wc.reload(),
          }),
        );
        menu.append(new MenuItem({ type: 'separator' }));
      }

      // Always available
      menu.append(
        new MenuItem({
          label: 'Inspect Element',
          click: () => wc.inspectElement(params.x, params.y),
        }),
      );

      menu.popup();
    });
  }

  private async saveImage(url: string): Promise<void> {
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: this.getFilenameFromUrl(url),
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (canceled || !filePath) return;

    const tab = this.getActiveTab();
    if (!tab) return;

    try {
      tab.view.webContents.downloadURL(url);
      const ses = tab.view.webContents.session;
      ses.once('will-download', (_event, item) => {
        item.setSavePath(filePath);
      });
    } catch (err) {
      log.error('Failed to save image:', err);
    }
  }

  // ==================== Helpers ====================

  getTabList(): TabInfo[] {
    return Array.from(this.tabs.values()).map((t) => t.info);
  }

  getActiveTab(): ManagedTab | undefined {
    if (!this.activeTabId) return undefined;
    return this.tabs.get(this.activeTabId);
  }

  getActiveTabId(): string | null {
    return this.activeTabId;
  }

  getActiveWebContents(): Electron.WebContents | undefined {
    const tab = this.getActiveTab();
    return tab?.view.webContents;
  }

  async resolveDownloadTarget(pageUrl: string): Promise<DownloadTarget> {
    const tab = this.findTabForPage(pageUrl);
    const capturedCandidates = tab ? this.getCapturedMediaCandidates(tab.id) : [];
    let snapshot: ActiveMediaSnapshot | null = null;

    if (tab && !tab.view.webContents.isDestroyed()) {
      try {
        snapshot = (await tab.view.webContents.executeJavaScript(
          this.buildActiveMediaSnapshotScript(),
        )) as ActiveMediaSnapshot;
      } catch (err: unknown) {
        log.debug('Could not inspect the active media element:', err instanceof Error ? err.message : String(err));
      }
    }

    const target = selectDownloadTarget(pageUrl, snapshot, capturedCandidates);
    log.info(`Resolved download target from ${target.source} for ${this.redactUrlForLog(pageUrl)}`);
    return target;
  }

  getMediaFallbackForPage(pageUrl: string): CapturedMediaFallback | null {
    const tab = this.findTabForPage(pageUrl);
    return tab ? this.getCapturedMediaCandidates(tab.id)[0] || null : null;
  }

  getTabCount(): number {
    return this.tabs.size;
  }

  /** Switch to the next tab (wraps around) */
  switchToNextTab(): void {
    const ids = Array.from(this.tabs.keys());
    if (ids.length <= 1) return;
    const currentIndex = ids.indexOf(this.activeTabId || '');
    const nextIndex = (currentIndex + 1) % ids.length;
    this.switchTab(ids[nextIndex]);
  }

  /** Switch to the previous tab (wraps around) */
  switchToPreviousTab(): void {
    const ids = Array.from(this.tabs.keys());
    if (ids.length <= 1) return;
    const currentIndex = ids.indexOf(this.activeTabId || '');
    const prevIndex = (currentIndex - 1 + ids.length) % ids.length;
    this.switchTab(ids[prevIndex]);
  }

  /** Switch to tab by index (1-based, for Cmd+1 through Cmd+9) */
  switchToTabByIndex(index: number): void {
    const ids = Array.from(this.tabs.keys());
    if (index === 9) {
      // Cmd+9 always switches to the last tab
      this.switchTab(ids[ids.length - 1]);
    } else if (index <= ids.length) {
      this.switchTab(ids[index - 1]);
    }
  }

  updateAllTabBounds(): void {
    const tab = this.getActiveTab();
    if (tab) {
      this.updateTabBounds(tab.view);
    }
  }

  private updateTabBounds(view: WebContentsView): void {
    const bounds = this.window.getBounds();
    const sidebarWidth = this.getSidebarWidth();
    view.setBounds({
      x: sidebarWidth,
      y: HEADER_HEIGHT,
      width: bounds.width - sidebarWidth,
      height: bounds.height - HEADER_HEIGHT,
    });
  }

  private getSidebarWidth(): number {
    return this.settingsManager?.get('browser.sidebarCollapsed') === true
      ? SIDEBAR_WIDTH_COLLAPSED
      : SIDEBAR_WIDTH_EXPANDED;
  }

  private updateNavState(managedTab: ManagedTab, url: string): void {
    const wc = managedTab.view.webContents;
    const previousComparableUrl = this.normalizeComparableUrl(managedTab.info.url);
    const nextComparableUrl = this.normalizeComparableUrl(url);

    if (previousComparableUrl !== nextComparableUrl) {
      this.capturedMediaByTabId.delete(managedTab.id);
      this.navigationIdsByTabId.set(managedTab.id, (this.navigationIdsByTabId.get(managedTab.id) || 0) + 1);
    }

    managedTab.info.url = url;
    managedTab.info.canGoBack = wc.navigationHistory.canGoBack();
    managedTab.info.canGoForward = wc.navigationHistory.canGoForward();
    managedTab.info.isSecure = url.startsWith('https://');

    // Tier 1: fast URL-pattern media detection
    if (this.isKnownVideoUrl(url)) {
      managedTab.info.mediaState = 'detecting';
      managedTab.info.mediaTitle = undefined;
      // Abort any previous detection for this tab
      this.mediaDetectionAbort.set(managedTab.id, true);
      // Start async tier 2 detection
      this.probeMediaAsync(managedTab);
    } else {
      managedTab.info.mediaState = 'none';
      managedTab.info.mediaTitle = undefined;
      this.mediaDetectionAbort.set(managedTab.id, true);
    }

    this.notifyTabUpdate(managedTab.info);
  }

  private isKnownVideoUrl(url: string): boolean {
    return isLikelyMediaUrl(url);
  }

  private async probeMediaAsync(managedTab: ManagedTab): Promise<void> {
    const tabId = managedTab.id;
    const url = managedTab.info.url;

    // Set a unique detection ID so we can abort stale probes
    this.mediaDetectionAbort.set(tabId, false);

    try {
      const info = await this.ytdlp.getVideoInfo(url);

      // Check if this detection was aborted (user navigated away)
      if (this.mediaDetectionAbort.get(tabId)) return;
      // Check if tab still exists
      if (!this.tabs.has(tabId)) return;
      // Check URL hasn't changed
      if (managedTab.info.url !== url) return;

      managedTab.info.mediaState = 'detected';
      managedTab.info.mediaTitle = info.title;
      this.notifyTabUpdate(managedTab.info);

      // Also emit MEDIA_DETECTED for the renderer
      this.appView.webContents.send(IPC_CHANNELS.MEDIA_DETECTED, {
        tabId,
        url,
        title: info.title,
        thumbnail: info.thumbnail,
      });

      log.info(`Media detected in tab ${tabId}: "${info.title}"`);
    } catch {
      // yt-dlp couldn't extract — not a supported media page
      if (this.mediaDetectionAbort.get(tabId)) return;
      if (!this.tabs.has(tabId)) return;
      if (managedTab.info.url !== url) return;

      const fallback = this.getMediaFallbackForPage(url);
      if (fallback) {
        managedTab.info.mediaState = 'detected';
        managedTab.info.mediaTitle = fallback.title || managedTab.info.title || 'Detected media';
        this.notifyTabUpdate(managedTab.info);
        return;
      }

      managedTab.info.mediaState = 'unsupported';
      this.notifyTabUpdate(managedTab.info);
    }
  }

  private captureMediaRequest(details: MediaRequestDetails): void {
    if (!details.webContentsId || !this.isPotentialMediaRequest(details)) return;

    const tabId = this.tabIdsByWebContentsId.get(details.webContentsId);
    if (!tabId) return;

    const tab = this.tabs.get(tabId);
    if (!tab) return;

    this.pendingMediaRequests.set(details.id, {
      fallback: {
        url: details.url,
        pageUrl: tab.info.url,
        title: tab.info.title,
        requestHeaders: this.pickDownloadHeaders(details.requestHeaders || {}),
        resourceType: details.resourceType,
        capturedAt: Date.now(),
      },
      navigationId: this.navigationIdsByTabId.get(tabId) || 0,
    });

    while (this.pendingMediaRequests.size > MAX_PENDING_MEDIA_REQUESTS) {
      const oldestRequestId = this.pendingMediaRequests.keys().next().value;
      if (oldestRequestId === undefined) break;
      this.pendingMediaRequests.delete(oldestRequestId);
    }
  }

  private captureMediaResponse(details: MediaRequestDetails): void {
    const pending = this.pendingMediaRequests.get(details.id);
    this.pendingMediaRequests.delete(details.id);
    if (!pending || !details.webContentsId || !this.isCapturableMediaResponse(details)) return;

    const tabId = this.tabIdsByWebContentsId.get(details.webContentsId);
    if (!tabId) return;

    const tab = this.tabs.get(tabId);
    if (!tab) return;
    if ((this.navigationIdsByTabId.get(tabId) || 0) !== pending.navigationId) return;

    const mimeType = this.getResponseHeader(details.responseHeaders, 'content-type')?.split(';', 1)[0].trim();
    const contentLengthValue = this.getResponseHeader(details.responseHeaders, 'content-length');
    const contentLength = contentLengthValue ? Number.parseInt(contentLengthValue, 10) : undefined;
    const fallback: CapturedMediaFallback = {
      ...pending.fallback,
      url: details.url,
      statusCode: details.statusCode,
      mimeType,
      contentLength: Number.isFinite(contentLength) ? contentLength : undefined,
      capturedAt: Date.now(),
    };

    const existing = this.capturedMediaByTabId.get(tabId) || [];
    const deduped = existing.filter((candidate) => candidate.url !== fallback.url);
    this.capturedMediaByTabId.set(tabId, [fallback, ...deduped].slice(0, MAX_CAPTURED_MEDIA_PER_TAB));

    if (tab.info.mediaState !== 'detected') {
      tab.info.mediaState = 'detected';
      tab.info.mediaTitle = fallback.title || 'Detected media';
      this.notifyTabUpdate(tab.info);

      this.appView.webContents.send(IPC_CHANNELS.MEDIA_DETECTED, {
        tabId,
        url: tab.info.url,
        title: tab.info.mediaTitle,
      });
    }
  }

  private isPotentialMediaRequest(details: MediaRequestDetails): boolean {
    try {
      const parsed = new URL(details.url);
      if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    } catch {
      return false;
    }

    if (isDirectMediaResourceUrl(details.url)) return true;

    return details.resourceType === 'media' || details.resourceType === 'xhr' || details.resourceType === 'other';
  }

  private isCapturableMediaResponse(details: MediaRequestDetails): boolean {
    const statusCode = details.statusCode || 0;
    if (!((statusCode >= 200 && statusCode < 300) || statusCode === 304)) return false;
    if (isDirectMediaResourceUrl(details.url) || details.resourceType === 'media') return true;

    const mimeType = this.getResponseHeader(details.responseHeaders, 'content-type')?.toLowerCase() || '';
    return (
      mimeType.startsWith('video/') ||
      mimeType.startsWith('audio/') ||
      /(?:application\/vnd\.apple\.mpegurl|application\/x-mpegurl|application\/dash\+xml)/.test(mimeType)
    );
  }

  private getResponseHeader(headers: Record<string, string[]> | undefined, name: string): string | undefined {
    if (!headers) return undefined;
    const entry = Object.entries(headers).find(([headerName]) => headerName.toLowerCase() === name.toLowerCase());
    return entry?.[1]?.[0];
  }

  private pickDownloadHeaders(headers: Record<string, string | string[]>): Record<string, string> {
    const allowed = new Set(['user-agent', 'referer', 'origin', 'accept', 'accept-language']);
    const picked: Record<string, string> = {};

    for (const [rawName, rawValue] of Object.entries(headers)) {
      const normalized = rawName.toLowerCase();
      if (!allowed.has(normalized)) continue;

      const value = Array.isArray(rawValue) ? rawValue.join(', ') : rawValue;
      if (value) {
        picked[this.formatHeaderName(normalized)] = value;
      }
    }

    return picked;
  }

  private formatHeaderName(headerName: string): string {
    return headerName
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('-');
  }

  private notifyTabUpdate(tabInfo: TabInfo): void {
    this.appView.webContents.send(IPC_CHANNELS.TAB_UPDATE, tabInfo);
    // Every meaningful tab change (navigation, title, switch) flows through
    // here, so it doubles as the session persistence trigger.
    this.scheduleSessionSave();
  }

  private normalizeComparableUrl(url: string): string {
    try {
      const parsed = new URL(url);
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return url;
    }
  }

  private findTabForPage(pageUrl: string): ManagedTab | undefined {
    const normalizedPageUrl = this.normalizeComparableUrl(pageUrl);
    return Array.from(this.tabs.values()).find(
      (tab) => this.normalizeComparableUrl(tab.info.url) === normalizedPageUrl,
    );
  }

  private getCapturedMediaCandidates(tabId: string): CapturedMediaFallback[] {
    const now = Date.now();
    return rankCapturedMediaCandidates(
      (this.capturedMediaByTabId.get(tabId) || []).filter(
        (candidate) => now - candidate.capturedAt <= CAPTURED_MEDIA_TTL_MS,
      ),
    );
  }

  private buildActiveMediaSnapshotScript(): string {
    return `(() => {
      const absoluteUrl = (value) => {
        if (!value) return undefined;
        try { return new URL(value, document.baseURI).href; } catch { return undefined; }
      };
      const visibleArea = (rect) => {
        const width = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
        const height = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
        return width * height;
      };
      const videos = Array.from(document.querySelectorAll('video'))
        .map((video) => {
          const rect = video.getBoundingClientRect();
          const area = visibleArea(rect);
          const playing = !video.paused && !video.ended && video.readyState >= 2;
          return { video, rect, score: (playing ? 1e12 : 0) + area };
        })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score);
      const active = videos[0];
      const permalinkUrls = [];

      if (active) {
        const centerX = Math.max(0, Math.min(innerWidth - 1, active.rect.left + active.rect.width / 2));
        const centerY = Math.max(0, Math.min(innerHeight - 1, active.rect.top + active.rect.height / 2));
        const nearby = [active.video, ...document.elementsFromPoint(centerX, centerY)];
        for (const element of nearby) {
          const anchor = element instanceof Element ? element.closest('a[href]') : null;
          const href = absoluteUrl(anchor?.getAttribute('href'));
          if (href && !permalinkUrls.includes(href)) permalinkUrls.push(href);
        }
      }

      const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href')
        || document.querySelector('meta[property="og:url"]')?.getAttribute('content');
      return {
        canonicalUrl: absoluteUrl(canonical),
        permalinkUrls,
        mediaUrl: absoluteUrl(active?.video.currentSrc || active?.video.src),
        title: document.title || undefined,
      };
    })()`;
  }

  private redactUrlForLog(url: string): string {
    try {
      const parsed = new URL(url);
      if (parsed.search) parsed.search = '?[redacted]';
      if (parsed.hash) parsed.hash = '#[redacted]';
      return parsed.toString();
    } catch {
      return '[invalid-url]';
    }
  }

  private isSearchQuery(input: string): boolean {
    // Contains spaces -> search
    if (input.includes(' ')) return true;
    // No dots and no colons -> search
    if (!input.includes('.') && !input.includes(':')) return true;
    return false;
  }

  private buildSearchUrl(query: string): string {
    const engine = this.settingsManager?.getSearchEngine() || 'google';
    const encoded = encodeURIComponent(query);
    switch (engine) {
      case 'duckduckgo':
        return `https://duckduckgo.com/?q=${encoded}`;
      case 'bing':
        return `https://www.bing.com/search?q=${encoded}`;
      default:
        return `https://www.google.com/search?q=${encoded}`;
    }
  }

  // Follows the app theme via prefers-color-scheme: SettingsManager keeps
  // nativeTheme.themeSource in sync with the setting, and Electron applies it
  // to every webContents. Only reached via getNewTabDataUrl(), which caches
  // the result for exact-match comparisons.
  private buildNewTabPage(): string {
    const icons: Record<string, string> = {
      youtube: `<svg viewBox="0 0 24 24"><path fill="#fff" d="M9.5 8.2v7.6l6.5-3.8z"/></svg>`,
      instagram: `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8"><rect x="4" y="4" width="16" height="16" rx="4.5"/><circle cx="12" cy="12" r="3.6"/><circle cx="16.7" cy="7.3" r="1.1" fill="#fff" stroke="none"/></svg>`,
      tiktok: `<svg viewBox="0 0 24 24"><path fill="#fff" d="M16.6 4c.3 2 1.6 3.4 3.9 3.6v2.9c-1.5 0-2.8-.4-3.9-1.2v5.4c0 3-2.4 5.3-5.3 5.3S6 17.7 6 14.7s2.4-5.3 5.3-5.3c.3 0 .6 0 .9.1v3c-.3-.1-.6-.2-.9-.2-1.3 0-2.4 1.1-2.4 2.4s1.1 2.4 2.4 2.4 2.4-1.1 2.4-2.4V4h2.9z"/></svg>`,
      facebook: `<svg viewBox="0 0 24 24"><path fill="#fff" d="M13.5 21v-7h2.4l.4-3h-2.8V9.1c0-.9.3-1.5 1.6-1.5h1.3V4.9c-.2 0-1-.1-1.9-.1-1.9 0-3.2 1.2-3.2 3.3V11H9v3h2.3v7h2.2z"/></svg>`,
      vimeo: `<svg viewBox="0 0 24 24"><text x="12" y="17" font-family="-apple-system,sans-serif" font-size="14" font-weight="800" fill="#fff" text-anchor="middle">V</text></svg>`,
      dailymotion: `<svg viewBox="0 0 24 24"><text x="12" y="17.5" font-family="-apple-system,sans-serif" font-size="15" font-weight="800" fill="#fff" text-anchor="middle">d</text></svg>`,
      twitch: `<svg viewBox="0 0 24 24"><path fill="#fff" d="M5 3L3.5 6.5V19h4v2.5h2.5L12.5 19H16l4.5-4.5V3H5zm14 10.8L16.5 16H13l-2.5 2.5V16H7V4.5h12v9.3zM15.5 7.5H17V12h-1.5V7.5zm-4 0H13V12h-1.5V7.5z"/></svg>`,
      soundcloud: `<svg viewBox="0 0 24 24" fill="#fff"><rect x="4" y="12" width="1.6" height="6" rx="0.8"/><rect x="6.8" y="10" width="1.6" height="8" rx="0.8"/><rect x="9.6" y="8" width="1.6" height="10" rx="0.8"/><path d="M12.6 18h4.9a3.5 3.5 0 0 0 .6-6.95A5 5 0 0 0 12.6 7.5V18z"/></svg>`,
    };

    const platforms: Array<[string, string, string, string, string]> = [
      ['YouTube', 'Videos, Shorts, Live', 'https://www.youtube.com', 'youtube', '#FF0000'],
      [
        'Instagram',
        'Posts, Reels, Stories',
        'https://www.instagram.com',
        'instagram',
        'radial-gradient(circle at 30% 110%, #fdf497 0%, #fd5949 45%, #d6249f 60%, #285AEB 90%)',
      ],
      ['TikTok', 'Videos, Sounds', 'https://www.tiktok.com', 'tiktok', '#010101'],
      ['Facebook', 'Videos, Reels', 'https://www.facebook.com/watch', 'facebook', '#1877F2'],
      ['Vimeo', 'Videos', 'https://vimeo.com', 'vimeo', '#1AB7EA'],
      ['Dailymotion', 'Videos', 'https://www.dailymotion.com', 'dailymotion', '#0D0D40'],
      ['Twitch', 'Clips, VODs, Live', 'https://www.twitch.tv', 'twitch', '#9146FF'],
      ['SoundCloud', 'Tracks, Playlists', 'https://soundcloud.com', 'soundcloud', '#FF5500'],
    ];
    const links = platforms
      .map(
        ([name, subtitle, href, icon, bg]) => `<a class="card" href="${href}">
      <span class="card-icon" style="background:${bg}">${icons[icon]}</span>
      <span class="card-text"><span class="card-name">${name}</span><span class="card-sub">${subtitle}</span></span>
      <svg class="card-arrow" viewBox="0 0 16 16"><path d="M6 3.5L10.5 8 6 12.5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </a>`,
      )
      .join('');

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MyTube</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --bg: #f5f5f8;
      --text: #17171c;
      --text-muted: #5d5d68;
      --text-faint: #8a8a96;
      --accent: #e91e4f;
      --surface: rgba(255, 255, 255, 0.85);
      --surface-hover: #ffffff;
      --surface-border: #e2e2ea;
      --glow-a: rgba(233, 30, 79, 0.08);
      --glow-b: rgba(255, 71, 87, 0.06);
      --glow-c: rgba(80, 40, 200, 0.05);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0b0b11;
        --text: #f2f2f6;
        --text-muted: #9c9cab;
        --text-faint: #626270;
        --accent: #ff3d63;
        --surface: rgba(22, 22, 30, 0.75);
        --surface-hover: rgba(28, 28, 38, 0.9);
        --surface-border: #24242f;
        --glow-a: rgba(255, 45, 105, 0.14);
        --glow-b: rgba(255, 71, 87, 0.1);
        --glow-c: rgba(80, 40, 200, 0.08);
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh; display: grid; place-items: start center;
      background: var(--bg); color: var(--text);
      background-image:
        radial-gradient(1000px 480px at 85% -10%, var(--glow-a), transparent 60%),
        radial-gradient(800px 420px at 0% 110%, var(--glow-b), transparent 60%),
        radial-gradient(500px 300px at 15% 10%, var(--glow-c), transparent 70%);
      background-attachment: fixed;
    }
    main { width: min(920px, calc(100vw - 48px)); padding: 56px 0 48px; }
    .hero { text-align: center; margin-bottom: 36px; }
    h1 {
      margin: 0 0 6px; font-size: 68px; line-height: 1.05; font-weight: 800;
      font-style: italic; letter-spacing: -2px;
    }
    h1 .tube {
      background: linear-gradient(135deg, #ff4757 0%, #ff2d78 100%);
      -webkit-background-clip: text; background-clip: text; color: transparent;
    }
    .tagline { margin: 0; color: var(--text-muted); font-size: 17px; }
    .tagline strong { color: var(--accent); font-weight: 600; }
    form {
      display: flex; align-items: center; gap: 10px; margin: 0 auto 40px;
      max-width: 760px; height: 56px; padding: 0 8px 0 20px;
      background: var(--surface); border: 1px solid rgba(255, 61, 99, 0.45);
      border-radius: 16px; box-shadow: 0 0 24px rgba(255, 45, 105, 0.12);
    }
    form:focus-within { border-color: var(--accent); box-shadow: 0 0 28px rgba(255, 45, 105, 0.25); }
    .search-icon { flex-shrink: 0; color: var(--text-faint); }
    input {
      flex: 1; min-width: 0; height: 100%; border: 0; padding: 0;
      font: inherit; font-size: 15px; background: transparent; color: var(--text); outline: none;
    }
    input::placeholder { color: var(--text-faint); }
    button {
      height: 40px; border: 0; border-radius: 12px; padding: 0 30px;
      font: inherit; font-size: 15px; font-weight: 700; color: #fff; cursor: pointer;
      background: linear-gradient(135deg, #ff4757 0%, #ff2d78 100%);
      box-shadow: 0 4px 16px rgba(255, 45, 105, 0.35);
    }
    button:hover { filter: brightness(1.08); }
    .section-title {
      display: flex; align-items: center; gap: 8px; margin: 0 0 14px;
      font-size: 12px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: var(--text-muted);
    }
    .section-title::before {
      content: ""; width: 8px; height: 8px; border-radius: 2px;
      background: linear-gradient(135deg, #ff4757, #ff2d78);
    }
    .quick-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
    .card {
      display: flex; align-items: center; gap: 12px; padding: 12px 14px;
      border: 1px solid var(--surface-border); border-radius: 14px; text-decoration: none;
      background: var(--surface); transition: border-color 0.15s, transform 0.15s, background 0.15s;
    }
    .card:hover { border-color: rgba(255, 61, 99, 0.55); background: var(--surface-hover); transform: translateY(-1px); }
    .card-icon {
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
      width: 40px; height: 40px; border-radius: 10px;
    }
    .card-icon svg { width: 24px; height: 24px; }
    .card-text { display: flex; flex-direction: column; min-width: 0; }
    .card-name { color: var(--text); font-size: 14px; font-weight: 600; }
    .card-sub { color: var(--text-faint); font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .card-arrow { width: 16px; height: 16px; margin-left: auto; flex-shrink: 0; color: var(--text-faint); }
    .card:hover .card-arrow { color: var(--accent); }
    .banner {
      display: flex; align-items: center; gap: 16px; margin-top: 28px; padding: 18px 20px;
      border: 1px solid var(--surface-border); border-radius: 16px; background: var(--surface);
    }
    .banner-icon {
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
      width: 44px; height: 44px; border-radius: 50%;
      background: linear-gradient(135deg, #ff4757, #ff2d78);
      box-shadow: 0 4px 16px rgba(255, 45, 105, 0.35);
    }
    .banner-icon svg { width: 20px; height: 20px; }
    .banner-title { margin: 0 0 3px; font-size: 15px; font-weight: 700; }
    .banner-note { margin: 0; color: var(--text-muted); font-size: 12.5px; line-height: 1.5; }
  </style>
</head>
<body>
  <main>
    <div class="hero">
      <h1><span>My</span><span class="tube">Tube</span></h1>
      <p class="tagline">Your world. <strong>Your media.</strong></p>
    </div>
    <form id="search-form">
      <svg class="search-icon" width="18" height="18" viewBox="0 0 18 18" fill="currentColor"><path d="M12.5 11h-.79l-.28-.27A6.471 6.471 0 0 0 13 6.5 6.5 6.5 0 1 0 6.5 13c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L17.49 16l-4.99-5zm-6 0C4.01 11 2 8.99 2 6.5S4.01 2 6.5 2 11 4.01 11 6.5 8.99 11 6.5 11z"/></svg>
      <input id="search-input" autofocus placeholder="Search or paste a media URL here..." />
      <button type="submit">Go</button>
    </form>
    <div class="section-title">Supported starting points</div>
    <div class="quick-grid">${links}</div>
    <div class="banner">
      <span class="banner-icon"><svg viewBox="0 0 24 24"><path fill="#fff" d="M13 2L4.5 13.5H11L9.5 22 19 10h-6.5L13 2z"/></svg></span>
      <div>
        <p class="banner-title">Fast. Smart. Private.</p>
        <p class="banner-note">Downloads depend on site support, public availability, and rights. MyTube does not bypass DRM or platform restrictions.</p>
      </div>
    </div>
  </main>
  <script>
    const form = document.getElementById('search-form');
    const input = document.getElementById('search-input');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = input.value.trim();
      if (!value) return;
      if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.includes('.')) {
        location.href = value.includes('://') ? value : 'https://' + value;
      } else {
        location.href = 'https://www.google.com/search?q=' + encodeURIComponent(value);
      }
    });
  </script>
</body>
</html>`;
  }

  private getFilenameFromUrl(url: string): string {
    try {
      const pathname = new URL(url).pathname;
      const parts = pathname.split('/');
      return parts[parts.length - 1] || 'image';
    } catch {
      return 'image';
    }
  }

  // ==================== Error Page ====================

  private buildErrorPage(errorCode: number, errorDescription: string, url: string): string {
    const friendlyMessage = this.getFriendlyError(errorCode);
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  :root {
    color-scheme: light dark;
    --bg: #f5f5f8; --text: #17171c; --muted: #5d5d68; --faint: #8a8a96;
    --chip: rgba(0, 0, 0, 0.05); --glow: rgba(233, 30, 79, 0.07);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0b0b11; --text: #f2f2f6; --muted: #9c9cab; --faint: #626270;
      --chip: rgba(255, 255, 255, 0.05); --glow: rgba(255, 45, 105, 0.1);
    }
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg); color: var(--text);
    background-image: radial-gradient(700px 380px at 50% -10%, var(--glow), transparent 60%);
    display: flex; align-items: center; justify-content: center;
    min-height: 100vh; padding: 2rem;
  }
  .container { text-align: center; max-width: 480px; }
  .icon { font-size: 4rem; margin-bottom: 1.5rem; opacity: 0.6; }
  h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.75rem; color: var(--text); }
  .description { color: var(--muted); margin-bottom: 1.5rem; line-height: 1.6; font-size: 0.95rem; }
  .url { color: var(--faint); font-size: 0.8rem; word-break: break-all; margin-bottom: 2rem;
    background: var(--chip); padding: 0.5rem 1rem; border-radius: 8px; }
  .error-code { color: var(--faint); font-size: 0.75rem; margin-bottom: 2rem; }
  button {
    background: linear-gradient(135deg, #ff4757 0%, #ff2d78 100%); color: white; border: none; padding: 0.7rem 2rem;
    border-radius: 12px; font-size: 0.95rem; cursor: pointer; font-weight: 600;
    box-shadow: 0 4px 16px rgba(255, 45, 105, 0.35);
    transition: filter 0.2s;
  }
  button:hover { filter: brightness(1.08); }
</style>
</head>
<body>
  <div class="container">
    <div class="icon">&#x26A0;</div>
    <h1>${friendlyMessage}</h1>
    <p class="description">${this.escapeHtml(errorDescription)}</p>
    <div class="url">${this.escapeHtml(url)}</div>
    <div class="error-code">Error code: ${errorCode}</div>
    <button onclick="window.location.href='${this.escapeHtml(url)}'">Try Again</button>
  </div>
</body>
</html>`;
  }

  private getFriendlyError(code: number): string {
    switch (code) {
      case -2:
        return 'Network Error';
      case -6:
        return 'File Not Found';
      case -7:
        return 'Too Many Redirects';
      case -100:
        return 'Connection Closed';
      case -101:
        return 'Connection Reset';
      case -102:
        return 'Connection Refused';
      case -103:
        return 'Connection Failed';
      case -104:
        return 'Connection Timed Out';
      case -105:
        return 'Could Not Resolve Host';
      case -106:
        return 'No Internet Connection';
      case -109:
        return 'Address Unreachable';
      case -118:
        return 'Connection Timed Out';
      case -200:
        return 'Certificate Error';
      case -201:
        return 'Certificate Date Invalid';
      case -202:
        return 'Certificate Authority Invalid';
      default:
        return 'This Page Could Not Be Loaded';
    }
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ==================== Tab Suspension ====================

  private startSuspendTimer(): void {
    this.suspendTimer = setInterval(() => {
      this.suspendInactiveTabs();
    }, 60_000); // Check every minute
  }

  private suspendInactiveTabs(): void {
    const now = Date.now();
    for (const [tabId, tab] of this.tabs) {
      // Don't suspend the active tab
      if (tabId === this.activeTabId) continue;
      // Don't suspend already-suspended tabs
      if (tab.suspendedUrl) continue;
      // Don't suspend tabs with active downloads (mediaState detected)
      if (tab.info.mediaState === 'detecting') continue;

      if (now - tab.lastActiveAt > TAB_SUSPEND_TIMEOUT_MS) {
        this.suspendTab(tab);
      }
    }
  }

  private suspendTab(tab: ManagedTab): void {
    tab.suspendedUrl = tab.info.url;
    tab.view.webContents.loadURL('about:blank');
    log.info(`Suspended inactive tab ${tab.id}: ${tab.suspendedUrl}`);
  }

  destroy(): void {
    // destroy() runs from both before-quit and the window closed handler; a
    // second pass would save an empty session over the real one.
    if (this.destroyed) return;
    this.destroyed = true;

    // Flush the pending (debounced) session save before tabs are torn down.
    if (this.sessionSaveTimer) {
      clearTimeout(this.sessionSaveTimer);
      this.sessionSaveTimer = null;
    }
    this.saveSessionState();

    if (this.suspendTimer) {
      clearInterval(this.suspendTimer);
      this.suspendTimer = null;
    }

    this.unsubscribeSettings?.();
    this.unsubscribeSettings = undefined;

    session.defaultSession.webRequest.onBeforeSendHeaders(null);
    session.defaultSession.webRequest.onResponseStarted(null);
    session.defaultSession.webRequest.onErrorOccurred(null);

    // Remove IPC handlers
    ipcMain.removeHandler(IPC_CHANNELS.TAB_CREATE);
    ipcMain.removeHandler(IPC_CHANNELS.TAB_CLOSE);
    ipcMain.removeHandler(IPC_CHANNELS.TAB_SWITCH);
    ipcMain.removeHandler(IPC_CHANNELS.TAB_NAVIGATE);
    ipcMain.removeHandler(IPC_CHANNELS.TAB_GO_BACK);
    ipcMain.removeHandler(IPC_CHANNELS.TAB_GO_FORWARD);
    ipcMain.removeHandler(IPC_CHANNELS.TAB_RELOAD);
    ipcMain.removeHandler(IPC_CHANNELS.TAB_STOP);
    ipcMain.removeHandler(IPC_CHANNELS.TAB_LIST);
    ipcMain.removeHandler(IPC_CHANNELS.TAB_ACTIVE_GET);
    ipcMain.removeHandler(IPC_CHANNELS.ZOOM_IN);
    ipcMain.removeHandler(IPC_CHANNELS.ZOOM_OUT);
    ipcMain.removeHandler(IPC_CHANNELS.ZOOM_RESET);
    ipcMain.removeHandler(IPC_CHANNELS.FIND_IN_PAGE);
    ipcMain.removeHandler(IPC_CHANNELS.FIND_NEXT);
    ipcMain.removeHandler(IPC_CHANNELS.FIND_PREVIOUS);
    ipcMain.removeHandler(IPC_CHANNELS.FIND_STOP);

    for (const tab of this.tabs.values()) {
      this.mediaDetector?.unregisterTabWebContents(tab.view.webContents.id);
      tab.view.webContents.close();
    }
    for (const popup of this.popupWindows) {
      if (!popup.isDestroyed()) popup.close();
    }
    this.popupWindows.clear();
    this.pendingMediaRequests.clear();
    this.capturedMediaByTabId.clear();
    this.navigationIdsByTabId.clear();
    this.tabs.clear();
  }
}
