import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { launchApp, type LaunchedApp } from './helpers/app';

type ShellWindow = {
  electronAPI: {
    startDownload(url: string, options?: { title?: string }): Promise<{ id: string }>;
    setSetting(key: string, value: unknown): Promise<void>;
  };
};

test.describe('download queue persistence', () => {
  test('imports the legacy JSON history into SQLite', async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mytube-legacy-downloads-'));
    fs.writeFileSync(
      path.join(userDataDir, 'downloads.json'),
      JSON.stringify([
        {
          id: 'legacy-completed-1',
          url: 'https://example.com/legacy',
          title: 'Legacy completed video',
          filename: 'legacy.mp4',
          savePath: path.join(userDataDir, 'legacy.mp4'),
          type: 'video',
          status: 'completed',
          progress: 100,
          createdAt: Date.now() - 1_000,
          completedAt: Date.now(),
        },
      ]),
    );
    const launched = await launchApp({ userDataDir });

    try {
      await launched.shell.getByTitle('Downloads (Cmd+J)').click();
      await launched.shell.getByRole('tab', { name: 'Library' }).click();

      await expect(launched.shell.getByText('Legacy completed video')).toBeVisible();
      expect(fs.existsSync(path.join(userDataDir, 'downloads.sqlite3'))).toBe(true);
    } finally {
      await launched.close();
    }
  });

  test('restores queued work and pauses an interrupted active download', async () => {
    let launched: LaunchedApp = await launchApp();

    try {
      await launched.shell.evaluate(() =>
        (window as unknown as ShellWindow).electronAPI.setSetting('downloads.maxConcurrent', 1),
      );
      await launched.shell.evaluate(() =>
        Promise.all([
          (window as unknown as ShellWindow).electronAPI.startDownload(
            'https://www.youtube.com/watch?v=queue-persist1',
            { title: 'Persist one' },
          ),
          (window as unknown as ShellWindow).electronAPI.startDownload(
            'https://www.youtube.com/watch?v=queue-persist2',
            { title: 'Persist two' },
          ),
          (window as unknown as ShellWindow).electronAPI.startDownload(
            'https://www.youtube.com/watch?v=queue-persist3',
            { title: 'Persist three' },
          ),
        ]),
      );
      await launched.shell.getByTitle('Downloads (Cmd+J)').click();
      await expect(launched.shell.locator('.dp-summary')).toContainText('1 downloading');
      await expect(launched.shell.locator('.dp-summary')).toContainText('2 waiting');

      const { userDataDir } = launched;
      await launched.app.close();
      launched = await launchApp({ userDataDir });
      await launched.shell.getByTitle('Downloads (Cmd+J)').click();

      await expect(launched.shell.locator('.dp-item-paused')).toHaveCount(1);
      await expect(launched.shell.locator('.dp-summary')).toContainText('1 downloading');
      await expect(launched.shell.locator('.dp-summary')).toContainText('1 waiting');

      await launched.shell.getByRole('button', { name: 'Pause all' }).click();
      await expect(launched.shell.locator('.dp-item-paused')).toHaveCount(3);
      await launched.shell.getByRole('button', { name: 'Resume all' }).click();

      await expect(launched.shell.locator('.dp-item')).toHaveCount(0, { timeout: 20_000 });
      await launched.shell.getByRole('tab', { name: 'Library' }).click();
      await expect(launched.shell.locator('.dp-item-completed')).toHaveCount(3);
    } finally {
      await launched.close();
    }
  });
});
