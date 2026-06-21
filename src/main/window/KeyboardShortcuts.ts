import { BaseWindow } from 'electron';
import { TabManager } from './TabManager';
import type { WebContentsView } from 'electron';

export class KeyboardShortcuts {
  private tabManager: TabManager;
  private window: BaseWindow;
  private appView: WebContentsView;

  constructor(window: BaseWindow, tabManager: TabManager, appView: WebContentsView) {
    this.window = window;
    this.tabManager = tabManager;
    this.appView = appView;
    this.setupLocalShortcuts();
  }

  private setupLocalShortcuts(): void {
    // We use the 'before-input-event' on the active tab's webContents
    // and the app shell's webContents to capture keyboard shortcuts.
    // This avoids global shortcuts that conflict with other apps.

    const handleKeyEvent = (event: Electron.Event, input: Electron.Input) => {
      if (input.type !== 'keyDown') return;

      const mod = process.platform === 'darwin' ? input.meta : input.control;
      const shift = input.shift;

      if (!mod) return;

      switch (input.key.toLowerCase()) {
        case 't':
          if (!shift) {
            event.preventDefault();
            this.tabManager.createTab();
          }
          break;

        case 'w':
          if (!shift) {
            event.preventDefault();
            const activeId = this.tabManager.getActiveTabId();
            if (activeId) this.tabManager.closeTab(activeId);
          }
          break;

        case 'l':
          event.preventDefault();
          // Tell the renderer to focus the URL bar
          this.appView.webContents.send('shortcut:focus-url');
          break;

        case 'f':
          if (!shift) {
            event.preventDefault();
            this.appView.webContents.send('shortcut:toggle-find');
          }
          break;

        case 'r':
          if (!shift) {
            event.preventDefault();
            this.tabManager.reload();
          }
          break;

        case 'tab':
          event.preventDefault();
          if (shift) {
            this.tabManager.switchToPreviousTab();
          } else {
            this.tabManager.switchToNextTab();
          }
          break;

        case '=':
        case '+':
          event.preventDefault();
          this.tabManager.zoomIn();
          break;

        case '-':
          event.preventDefault();
          this.tabManager.zoomOut();
          break;

        case '0':
          event.preventDefault();
          this.tabManager.zoomReset();
          break;

        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9':
          event.preventDefault();
          this.tabManager.switchToTabByIndex(parseInt(input.key));
          break;

        case '[':
          event.preventDefault();
          this.tabManager.goBack();
          break;

        case ']':
          event.preventDefault();
          this.tabManager.goForward();
          break;

        case 'd':
          if (!shift) {
            event.preventDefault();
            this.appView.webContents.send('shortcut:download-media');
          }
          break;

        case 'j':
          if (!shift) {
            event.preventDefault();
            this.appView.webContents.send('shortcut:toggle-downloads');
          }
          break;
      }

      // Escape without modifier
      if (input.key === 'Escape' && !mod) {
        this.appView.webContents.send('shortcut:escape');
      }
    };

    // Listen on the app shell
    this.appView.webContents.on('before-input-event', handleKeyEvent);

    // We also need to listen on each tab's webContents.
    // The TabManager creates tabs dynamically, so we hook into its events
    // by listening on the window's content view changes.
    // Instead, we'll use session-level before-input-event by listening
    // on new webContents as they're created.

    const { app } = require('electron');
    app.on('web-contents-created', (_event: Electron.Event, wc: Electron.WebContents) => {
      // Don't add handler to the app shell (already added above)
      if (wc.id === this.appView.webContents.id) return;

      wc.on('before-input-event', handleKeyEvent);
    });
  }

  destroy(): void {
    // No global shortcuts to unregister since we use before-input-event
  }
}
