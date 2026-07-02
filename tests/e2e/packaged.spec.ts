import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { launchApp, type LaunchedApp } from './helpers/app';

type ShellWindow = {
  electronAPI: {
    startDownload(url: string): Promise<{ id: string }>;
  };
};

// Packaged-build smoke tests. They only run when scripts/run-packaged-e2e.cjs
// (or CI) points MYTUBE_PACKAGED_APP at a packed executable; in the regular
// dev-mode suite they are skipped.
const packagedApp = process.env.MYTUBE_PACKAGED_APP;
// Set when the package was built with mock media binaries staged in bin/,
// which makes a real download attempt safe (no network, deterministic output).
const mockedBins = process.env.MYTUBE_PACKAGED_MOCK_BINS === '1';

test.describe('packaged build', () => {
  test.skip(!packagedApp, 'MYTUBE_PACKAGED_APP is not set; run pnpm run test:e2e:packaged');

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp({ executablePath: packagedApp });
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('launches from the package and renders the browser shell', async () => {
    const { app, shell } = launched;

    await expect
      .poll(async () => app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().map((window) => window.getTitle())))
      .toContain('MyTube');
    expect(await app.evaluate(({ app: electronApp }) => electronApp.isPackaged)).toBe(true);

    await expect(shell.locator('.tab-bar')).toBeVisible();
    await expect(shell.locator('.nav-bar')).toBeVisible();
    await expect(shell.locator('.tab')).toHaveCount(1);

    // Tab lifecycle still works from the packaged bundle.
    await shell.getByTitle('New tab').click();
    await expect(shell.locator('.tab')).toHaveCount(2);
  });

  test('ships the media binaries under resources/bin', async () => {
    const resourcesPath = await launched.app.evaluate(() => process.resourcesPath);
    const ext = process.platform === 'win32' ? '.exe' : '';

    for (const name of ['yt-dlp', 'ffmpeg', 'ffprobe']) {
      const binPath = path.join(resourcesPath, 'bin', `${name}${ext}`);
      expect(fs.existsSync(binPath), `expected packaged binary at ${binPath}`).toBe(true);
    }
  });

  test('resolves yt-dlp from resources/bin and completes a download', async () => {
    test.skip(!mockedBins, 'package was not built with mock binaries; skipping download smoke');

    const { shell, downloadDir } = launched;

    await shell.evaluate(() =>
      (window as unknown as ShellWindow).electronAPI.startDownload('https://www.youtube.com/watch?v=packmock1'),
    );

    await shell.getByTitle('Downloads (Cmd+J)').click();
    const item = shell.locator('.dp-item', { hasText: 'Mock Video packmock1' });
    await expect(item.locator('.dp-status-completed')).toBeVisible({ timeout: 20_000 });

    const expectedFile = path.join(downloadDir, 'Mock Video packmock1 [packmock1].mp4');
    await expect.poll(() => fs.existsSync(expectedFile)).toBe(true);
  });
});
