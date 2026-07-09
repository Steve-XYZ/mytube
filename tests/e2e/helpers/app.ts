import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const FIXTURE_BIN_DIR = path.join(__dirname, '..', 'fixtures', 'bin');

export interface LaunchedApp {
  app: ElectronApplication;
  /** The React app shell (tab bar, nav bar, panels). */
  shell: Page;
  userDataDir: string;
  downloadDir: string;
  /** Where image downloads land (redirected system downloads dir). */
  imagesDir: string;
  close(): Promise<void>;
}

export interface LaunchOptions {
  /** Reuse an existing userData dir to test persistence across restarts. */
  userDataDir?: string;
  /**
   * Launch a packaged build instead of the dev checkout. Media binaries then
   * resolve from the package's resources/bin, not the mock fixture dir.
   */
  executablePath?: string;
}

/**
 * Launch the Electron app with isolated state:
 * - settings/downloads/session live in a temp userData dir
 * - system downloads are redirected under that dir
 * - in dev mode, yt-dlp resolves to the deterministic mock in tests/e2e/fixtures/bin
 */
export async function launchApp(options: LaunchOptions = {}): Promise<LaunchedApp> {
  const userDataDir = options.userDataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'mytube-e2e-'));
  const downloadDir = path.join(userDataDir, 'e2e-downloads');
  const imagesDir = path.join(userDataDir, 'system-downloads', 'MyTube', 'Images');
  fs.mkdirSync(downloadDir, { recursive: true });

  const settingsPath = path.join(userDataDir, 'settings.json');
  if (!fs.existsSync(settingsPath)) {
    // Partial settings are deep-merged with defaults by SettingsManager.
    fs.writeFileSync(settingsPath, JSON.stringify({ downloads: { defaultDirectory: downloadDir } }));
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'test',
    MYTUBE_E2E: '1',
    MYTUBE_USER_DATA_DIR: userDataDir,
  };
  if (!options.executablePath) {
    env.MYTUBE_BIN_DIR = FIXTURE_BIN_DIR;
  }

  const app = await electron.launch(
    options.executablePath
      ? { executablePath: options.executablePath, args: [], env }
      : { args: ['.'], cwd: REPO_ROOT, env },
  );

  const shell = await waitForPage(app, (url) => url.includes('renderer/index.html'));
  await shell.locator('.nav-bar').waitFor({ state: 'visible', timeout: 15_000 });

  return {
    app,
    shell,
    userDataDir,
    downloadDir,
    imagesDir,
    close: async () => {
      await app.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

/**
 * Wait for a window (app shell or browser tab WebContentsView) whose URL
 * matches the predicate. Playwright exposes every WebContents as a Page.
 */
export async function waitForPage(
  app: ElectronApplication,
  matches: (url: string) => boolean,
  timeoutMs = 15_000,
): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const page of app.windows()) {
      if (matches(page.url())) {
        return page;
      }
    }
    if (Date.now() > deadline) {
      const open = app
        .windows()
        .map((page) => page.url())
        .join('\n  ');
      throw new Error(`No window matched the predicate within ${timeoutMs}ms. Open windows:\n  ${open}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** The internal new-tab page is rendered from a data: URL. */
export function isNewTabPageUrl(url: string): boolean {
  return url.startsWith('data:text/html');
}
