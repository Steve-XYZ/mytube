import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { launchApp, waitForPage, type LaunchedApp } from './helpers/app';
import { startTestServer } from './helpers/server';

type ShellWindow = {
  electronAPI: {
    startDownload(url: string, options?: { audioOnly?: boolean }): Promise<{ id: string }>;
    getMediaInfo(url: string): Promise<{ title: string; uploader: string; formats: Array<{ label: string }> } | null>;
  };
};

test.describe('download pipeline (mocked yt-dlp)', () => {
  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('fetches video metadata through the mocked binary', async () => {
    const info = await launched.shell.evaluate(() =>
      (window as unknown as ShellWindow).electronAPI.getMediaInfo('https://www.youtube.com/watch?v=metamock'),
    );

    expect(info).not.toBeNull();
    expect(info?.title).toBe('Mock Video metamock');
    expect(info?.uploader).toBe('MyTube E2E');
    expect(info?.formats.length).toBeGreaterThan(0);
  });

  test('resolves the permalink associated with the visible video in a feed', async () => {
    const server = await startTestServer();
    try {
      const pageUrl = `${server.baseUrl}/media-feed`;
      await launched.shell.locator('.url-input').fill(pageUrl);
      await launched.shell.locator('.url-input').press('Enter');
      const tabPage = await waitForPage(launched.app, (url) => url === pageUrl);
      await expect(tabPage.locator('#active-video')).toBeVisible();

      const info = await launched.shell.evaluate((url) => {
        return (window as unknown as ShellWindow).electronAPI.getMediaInfo(url);
      }, pageUrl);

      expect(info?.title).toBe('Mock Video e2eactive');
    } finally {
      await server.close();
    }
  });

  test('downloads a video, shows it in the panel, and writes the file', async () => {
    const { shell, downloadDir } = launched;

    await shell.evaluate(() =>
      (window as unknown as ShellWindow).electronAPI.startDownload('https://www.youtube.com/watch?v=e2emock1'),
    );

    await shell.getByTitle('Downloads (Cmd+J)').click();
    await expect(shell.locator('.download-panel')).toBeVisible();

    const item = shell.locator('.dp-item', { hasText: 'Mock Video e2emock1' });
    await expect(item).toBeVisible();
    await expect(item.locator('.dp-status-completed')).toBeVisible({ timeout: 15_000 });

    const expectedFile = path.join(downloadDir, 'Mock Video e2emock1 [e2emock1].mp4');
    await expect.poll(() => fs.existsSync(expectedFile)).toBe(true);

    await expect(shell.locator('.toast-success', { hasText: 'Mock Video e2emock1' })).toBeVisible();
  });

  test('downloads audio-only through the -x path', async () => {
    const { shell, downloadDir } = launched;

    await shell.evaluate(() =>
      (window as unknown as ShellWindow).electronAPI.startDownload('https://www.youtube.com/watch?v=e2eaudio1', {
        audioOnly: true,
      }),
    );

    await shell.getByTitle('Downloads (Cmd+J)').click();
    const item = shell.locator('.dp-item', { hasText: 'Mock Video e2eaudio1' });
    await expect(item.locator('.dp-status-completed')).toBeVisible({ timeout: 15_000 });

    const expectedFile = path.join(downloadDir, 'Mock Video e2eaudio1 [e2eaudio1].mp3');
    await expect.poll(() => fs.existsSync(expectedFile)).toBe(true);
  });

  test('surfaces extraction failures in the panel and as a toast', async () => {
    const { shell } = launched;

    await shell.evaluate(() =>
      (window as unknown as ShellWindow).electronAPI.startDownload('https://www.youtube.com/watch?v=mock-fail'),
    );

    await shell.getByTitle('Downloads (Cmd+J)').click();
    await expect(shell.locator('.dp-item-failed')).toBeVisible({ timeout: 15_000 });
    await expect(shell.locator('.dp-status-failed')).toBeVisible();
    await expect(shell.locator('.toast-error')).toBeVisible();
  });
});
