import { Menu, app, dialog, shell, WebContentsView } from 'electron';
import type { TabManager } from './TabManager';

const APP_VERSION = app.getVersion();
const ELECTRON_VERSION = process.versions.electron;
const CHROME_VERSION = process.versions.chrome;
const NODE_VERSION = process.versions.node;

export class AppMenu {
  private tabManager: TabManager;
  private appView: WebContentsView;

  constructor(tabManager: TabManager, appView: WebContentsView) {
    this.tabManager = tabManager;
    this.appView = appView;
    this.buildMenu();
  }

  private buildMenu(): void {
    const isMac = process.platform === 'darwin';

    const template: Electron.MenuItemConstructorOptions[] = [
      // App menu (macOS only)
      ...(isMac
        ? [
            {
              label: app.name,
              submenu: [
                {
                  label: 'About MyTube',
                  click: () => this.showAbout(),
                },
                { type: 'separator' as const },
                {
                  label: 'Settings...',
                  accelerator: 'CmdOrCtrl+,' as const,
                  click: () => this.appView.webContents.send('shortcut:toggle-settings'),
                },
                { type: 'separator' as const },
                { role: 'hide' as const },
                { role: 'hideOthers' as const },
                { role: 'unhide' as const },
                { type: 'separator' as const },
                { role: 'quit' as const },
              ],
            },
          ]
        : []),

      // File
      {
        label: 'File',
        submenu: [
          {
            label: 'New Tab',
            accelerator: 'CmdOrCtrl+T',
            click: () => this.tabManager.createTab(),
          },
          {
            label: 'Close Tab',
            accelerator: 'CmdOrCtrl+W',
            click: () => {
              const activeId = this.tabManager.getActiveTabId();
              if (activeId) this.tabManager.closeTab(activeId);
            },
          },
          { type: 'separator' },
          ...(isMac ? [] : [{ role: 'quit' as const }]),
        ],
      },

      // Edit
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },

      // View
      {
        label: 'View',
        submenu: [
          {
            label: 'Reload',
            accelerator: 'CmdOrCtrl+R',
            click: () => this.tabManager.reload(),
          },
          { type: 'separator' },
          {
            label: 'Zoom In',
            accelerator: 'CmdOrCtrl+=',
            click: () => this.tabManager.zoomIn(),
          },
          {
            label: 'Zoom Out',
            accelerator: 'CmdOrCtrl+-',
            click: () => this.tabManager.zoomOut(),
          },
          {
            label: 'Reset Zoom',
            accelerator: 'CmdOrCtrl+0',
            click: () => this.tabManager.zoomReset(),
          },
          { type: 'separator' },
          {
            label: 'Downloads',
            accelerator: 'CmdOrCtrl+J',
            click: () => this.appView.webContents.send('shortcut:toggle-downloads'),
          },
          { type: 'separator' },
          {
            label: 'Toggle Developer Tools',
            accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
            click: () => {
              const wc = this.tabManager.getActiveWebContents();
              if (wc) wc.toggleDevTools();
            },
          },
        ],
      },

      // Window
      {
        label: 'Window',
        submenu: [
          { role: 'minimize' },
          { role: 'zoom' },
          { type: 'separator' },
          {
            label: 'Next Tab',
            accelerator: 'Ctrl+Tab',
            click: () => this.tabManager.switchToNextTab(),
          },
          {
            label: 'Previous Tab',
            accelerator: 'Ctrl+Shift+Tab',
            click: () => this.tabManager.switchToPreviousTab(),
          },
          ...(isMac ? [{ type: 'separator' as const }, { role: 'front' as const }] : []),
        ],
      },

      // Help
      {
        label: 'Help',
        submenu: [
          {
            label: 'About MyTube',
            click: () => this.showAbout(),
          },
          { type: 'separator' },
          {
            label: 'Report Issue...',
            click: () => shell.openExternal('https://github.com/mytube/mytube/issues'),
          },
        ],
      },
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  }

  private showAbout(): void {
    dialog.showMessageBox({
      type: 'info',
      title: 'About MyTube',
      message: 'MyTube',
      detail: [
        `Version: ${APP_VERSION}`,
        `Electron: ${ELECTRON_VERSION}`,
        `Chrome: ${CHROME_VERSION}`,
        `Node.js: ${NODE_VERSION}`,
        '',
        'A cross-platform web browser with built-in',
        'video and image downloading capabilities.',
        '',
        'Copyright 2026',
      ].join('\n'),
      buttons: ['OK'],
    });
  }
}
