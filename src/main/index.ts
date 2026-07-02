import { app } from 'electron';
import { MainWindow } from './window/MainWindow';
import log from 'electron-log/main';

// Test support: isolate all persisted state (settings, downloads, session)
// under a caller-provided directory. Must run before anything reads userData.
if (process.env.MYTUBE_USER_DATA_DIR) {
  app.setPath('userData', process.env.MYTUBE_USER_DATA_DIR);
}

// Configure logging
log.initialize();
log.info('MyTube starting...');

if (process.env.NODE_ENV === 'development' || process.env.VITE_DEV_SERVER_URL) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
}

// Enable DRM (Widevine) support — must be called before app.whenReady()
app.commandLine.appendSwitch('enable-features', 'WidevineCdm');

let mainWindow: MainWindow | null = null;

function createWindow(): void {
  mainWindow = new MainWindow();

  mainWindow.getWindow().on('closed', () => {
    // Clean up all IPC handlers before nulling, so re-creation via dock works
    mainWindow?.destroy();
    mainWindow = null;
  });
}

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      const win = mainWindow.getWindow();
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

// Security: restrict all new WebContents
app.on('web-contents-created', (_event, contents) => {
  // Block navigation to dangerous URL schemes (allow http, https, blob, about)
  contents.on('will-navigate', (event, url) => {
    try {
      const { protocol } = new URL(url);
      if (!['http:', 'https:', 'blob:', 'about:'].includes(protocol)) {
        event.preventDefault();
        log.warn(`Blocked will-navigate to: ${url}`);
      }
    } catch {
      event.preventDefault();
    }
  });

  // Handle renderer crashes gracefully
  contents.on('render-process-gone', (_event, details) => {
    log.error(`Renderer process gone: ${details.reason} (exit code: ${details.exitCode})`);
  });

  // Handle unresponsive renderers with auto-recovery
  let unresponsiveTimer: ReturnType<typeof setTimeout> | null = null;

  contents.on('unresponsive', () => {
    log.warn(`WebContents ${contents.id} became unresponsive`);
    // If still unresponsive after 15s, attempt reload
    if (!unresponsiveTimer) {
      unresponsiveTimer = setTimeout(() => {
        if (!contents.isDestroyed()) {
          log.warn(`WebContents ${contents.id} still unresponsive, reloading...`);
          contents.reload();
        }
        unresponsiveTimer = null;
      }, 15_000);
    }
  });

  contents.on('responsive', () => {
    log.info(`WebContents ${contents.id} became responsive again`);
    if (unresponsiveTimer) {
      clearTimeout(unresponsiveTimer);
      unresponsiveTimer = null;
    }
  });
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    // macOS: re-create window when dock icon is clicked
    if (!mainWindow) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // On macOS, apps typically stay active until Cmd+Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (mainWindow) {
    mainWindow.destroy();
  }
});
