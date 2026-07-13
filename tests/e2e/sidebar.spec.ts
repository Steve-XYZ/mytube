import { test, expect } from '@playwright/test';
import { launchApp, type LaunchedApp } from './helpers/app';

test.describe('sidebar', () => {
  test('collapses, persists across restarts, and expands again', async () => {
    let launched: LaunchedApp = await launchApp();

    try {
      const { shell } = launched;

      await expect(shell.locator('.sidebar')).toBeVisible();
      await expect(shell.locator('.sidebar')).not.toHaveClass(/sidebar-collapsed/);
      await expect(shell.locator('.sidebar-brand-name')).toBeVisible();

      await shell.getByTitle('Collapse sidebar').click();
      await expect(shell.locator('.sidebar')).toHaveClass(/sidebar-collapsed/);
      await expect(shell.locator('.sidebar-brand-name')).toHaveCount(0);

      // Relaunch against the same userData dir: the collapsed state must
      // survive (it lives in settings, and main offsets the content view by it).
      const { userDataDir } = launched;
      await launched.app.close();
      launched = await launchApp({ userDataDir });

      await expect(launched.shell.locator('.sidebar')).toHaveClass(/sidebar-collapsed/);

      await launched.shell.getByTitle('Expand sidebar').click();
      await expect(launched.shell.locator('.sidebar')).not.toHaveClass(/sidebar-collapsed/);
      await expect(launched.shell.locator('.sidebar-brand-name')).toBeVisible();
    } finally {
      await launched.close();
    }
  });
});
