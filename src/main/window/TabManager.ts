import { BaseWindow, WebContentsView, ipcMain, session, Menu, MenuItem, clipboard, dialog } from 'electron';
import { TabInfo, IPC_CHANNELS, FindInPageResult } from '../../shared/types';
import { DEFAULT_URL, HEADER_HEIGHT } from '../../shared/constants';
import type { SettingsManager } from '../settings/SettingsManager';
import { YtDlpController } from '../download/YtDlpController';
import type { MediaDetector } from '../media/MediaDetector';
import log from 'electron-log/main';

interface ManagedTab {
  id: string;
  view: WebContentsView;
  info: TabInfo;
  suspendedUrl?: string;
  lastActiveAt: number;
}

const TAB_SUSPEND_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const MAX_TABS = 20;

export class TabManager {
  private tabs: Map<string, ManagedTab> = new Map();
  private activeTabId: string | null = null;
  private window: BaseWindow;
  private appView: WebContentsView;
  private nextTabId = 1;
  private preloadPath: string;
  private settingsManager?: SettingsManager;
  private mediaDetector?: MediaDetector;
  private ytdlp: YtDlpController;
  private mediaDetectionAbort: Map<string, boolean> = new Map();
  private suspendTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    window: BaseWindow,
    appView: WebContentsView,
    preloadPath: string,
    settingsManager?: SettingsManager,
    mediaDetector?: MediaDetector,
  ) {
    this.window = window;
    this.appView = appView;
    this.preloadPath = preloadPath;
    this.settingsManager = settingsManager;
    this.mediaDetector = mediaDetector;
    this.ytdlp = new YtDlpController();
    this.setupIpcHandlers();
    this.setupPermissions();
    this.startSuspendTimer();
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
    const ses = session.defaultSession;

    // Set a standard Chrome user agent to avoid being blocked by sites like YouTube
    const chromeVersion = process.versions.chrome;
    const userAgent = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
    ses.setUserAgent(userAgent);

    const allowedPermissions = [
      'clipboard-read',
      'clipboard-sanitized-write',
      'fullscreen',
      'mediaKeySystem', // DRM (Widevine) — required for YouTube
      'media', // General media playback
      'notifications',
      'pointerLock',
    ];

    ses.setPermissionRequestHandler((_webContents, permission, callback) => {
      const allowed = allowedPermissions.includes(permission);
      if (!allowed) {
        log.info(`Permission denied: ${permission}`);
      }
      callback(allowed);
    });

    // Some permissions are checked without a request (synchronous check)
    ses.setPermissionCheckHandler((_webContents, permission) => {
      return allowedPermissions.includes(permission);
    });
  }

  // ==================== Tab Lifecycle ====================

  createTab(url?: string): TabInfo | null {
    // Enforce max tab limit
    if (this.tabs.size >= MAX_TABS) {
      log.warn(`Tab limit reached (${MAX_TABS}). Cannot create new tab.`);
      return null;
    }

    const tabId = `tab-${this.nextTabId++}`;
    const targetUrl = url || DEFAULT_URL;

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
      title: 'New Tab',
      url: targetUrl,
      isLoading: true,
      canGoBack: false,
      canGoForward: false,
      isSecure: targetUrl.startsWith('https://'),
      zoomLevel: 0,
      webContentsId: view.webContents.id,
      mediaState: 'none',
    };

    const managedTab: ManagedTab = { id: tabId, view, info: tabInfo, lastActiveAt: Date.now() };
    this.tabs.set(tabId, managedTab);

    this.setupTabEvents(managedTab);
    this.setupContextMenu(managedTab);
    this.mediaDetector?.registerTabWebContents(view.webContents.id);

    view.webContents.loadURL(targetUrl);
    this.switchTab(tabId);

    log.info(`Tab created: ${tabId} -> ${targetUrl}`);
    return tabInfo;
  }

  closeTab(tabId: string): boolean {
    const tab = this.tabs.get(tabId);
    if (!tab) return false;

    this.window.contentView.removeChildView(tab.view);
    this.mediaDetector?.unregisterTabWebContents(tab.view.webContents.id);
    tab.view.webContents.close();
    this.tabs.delete(tabId);

    log.info(`Tab closed: ${tabId}`);

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
      tab.view.webContents.loadURL(restoredUrl);
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

    let finalUrl = url.trim();

    // Detect if it's a search query or a URL
    if (this.isSearchQuery(finalUrl)) {
      finalUrl = this.buildSearchUrl(finalUrl);
    } else if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      finalUrl = `https://${finalUrl}`;
    }

    // Validate URL scheme — only allow http/https
    if (!this.isAllowedUrl(finalUrl)) {
      log.warn(`Blocked navigation to disallowed URL: ${finalUrl}`);
      return false;
    }

    tab.view.webContents.loadURL(finalUrl);
    return true;
  }

  private isAllowedUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return ['http:', 'https:', 'blob:', 'about:'].includes(parsed.protocol);
    } catch {
      return false;
    }
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
      this.updateNavState(managedTab, navUrl);
    });

    wc.on('did-navigate-in-page', (_event, navUrl) => {
      this.updateNavState(managedTab, navUrl);
    });

    wc.on('page-title-updated', (_event, title) => {
      info.title = title;
      this.notifyTabUpdate(info);
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

    // Block navigation to dangerous URL schemes (allow http, https, blob, about)
    wc.on('will-navigate', (event, navUrl) => {
      try {
        const { protocol } = new URL(navUrl);
        if (!['http:', 'https:', 'blob:', 'about:'].includes(protocol)) {
          event.preventDefault();
          log.warn(`Blocked will-navigate to: ${navUrl}`);
        }
      } catch {
        event.preventDefault();
      }
    });

    // Handle new window requests (popups, target=_blank)
    wc.setWindowOpenHandler(({ url: newUrl }) => {
      if (newUrl && newUrl !== 'about:blank' && this.isAllowedUrl(newUrl)) {
        this.createTab(newUrl);
      }
      return { action: 'deny' };
    });

    // Handle certificate errors gracefully
    wc.on('certificate-error', (event, _url, _error, _cert, callback) => {
      // Don't allow invalid certs by default
      event.preventDefault();
      callback(false);
    });

    // Handle did-fail-load — show error page
    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      if (errorCode === -3) return; // ERR_ABORTED is normal (navigation cancelled)
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
    view.setBounds({
      x: 0,
      y: HEADER_HEIGHT,
      width: bounds.width,
      height: bounds.height - HEADER_HEIGHT,
    });
  }

  private updateNavState(managedTab: ManagedTab, url: string): void {
    const wc = managedTab.view.webContents;
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
    try {
      const u = new URL(url);
      const host = u.hostname.replace('www.', '');

      if (host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com') {
        return u.pathname.includes('/watch') || u.pathname.includes('/shorts/') || host === 'youtu.be';
      }

      const videoPlatforms = [
        'vimeo.com',
        'dailymotion.com',
        'tiktok.com',
        'twitter.com',
        'x.com',
        'instagram.com',
        'reddit.com',
        'facebook.com',
        'twitch.tv',
        'rumble.com',
        'bilibili.com',
        'odysee.com',
        'bandcamp.com',
        'soundcloud.com',
      ];
      return videoPlatforms.some((p) => host.includes(p));
    } catch {
      return false;
    }
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

      managedTab.info.mediaState = 'unsupported';
      this.notifyTabUpdate(managedTab.info);
    }
  }

  private notifyTabUpdate(tabInfo: TabInfo): void {
    this.appView.webContents.send(IPC_CHANNELS.TAB_UPDATE, tabInfo);
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
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #1a1a2e; color: #e0e0e0;
    display: flex; align-items: center; justify-content: center;
    min-height: 100vh; padding: 2rem;
  }
  .container { text-align: center; max-width: 480px; }
  .icon { font-size: 4rem; margin-bottom: 1.5rem; opacity: 0.6; }
  h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.75rem; color: #fff; }
  .description { color: #999; margin-bottom: 1.5rem; line-height: 1.6; font-size: 0.95rem; }
  .url { color: #666; font-size: 0.8rem; word-break: break-all; margin-bottom: 2rem;
    background: rgba(255,255,255,0.05); padding: 0.5rem 1rem; border-radius: 6px; }
  .error-code { color: #555; font-size: 0.75rem; margin-bottom: 2rem; }
  button {
    background: #e04040; color: white; border: none; padding: 0.7rem 2rem;
    border-radius: 8px; font-size: 0.95rem; cursor: pointer; font-weight: 500;
    transition: background 0.2s;
  }
  button:hover { background: #c03030; }
  @media (prefers-color-scheme: light) {
    body { background: #f5f5f5; color: #333; }
    h1 { color: #111; }
    .url { background: rgba(0,0,0,0.05); }
  }
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
    if (this.suspendTimer) {
      clearInterval(this.suspendTimer);
      this.suspendTimer = null;
    }

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
    this.tabs.clear();
  }
}
