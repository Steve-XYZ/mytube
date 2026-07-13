import { test, expect } from '@playwright/test';
import { launchApp, type LaunchedApp } from './helpers/app';

test.describe('settings', () => {
  test('opens the settings modal, applies theme changes, and persists across restarts', async () => {
    let launched: LaunchedApp = await launchApp();

    try {
      const { shell } = launched;

      // Both the nav bar and the sidebar expose a "Settings" control.
      await shell.locator('.nav-bar').getByTitle('Settings').click();
      await expect(shell.locator('.settings-panel')).toBeVisible();

      const themeSelect = shell.locator('.settings-row', { hasText: 'Theme' }).locator('select');
      await expect(themeSelect).toHaveValue('system');
      await themeSelect.selectOption('dark');

      // The main process broadcasts the change and the shell applies it live.
      await expect(shell.locator('html')).toHaveAttribute('data-theme', 'dark');

      await shell.locator('.settings-close').click();
      await expect(shell.locator('.settings-panel')).toHaveCount(0);

      // Relaunch against the same userData dir: the setting must survive.
      const { userDataDir } = launched;
      await launched.app.close();
      launched = await launchApp({ userDataDir });

      const theme = await launched.shell.evaluate(() =>
        (window as unknown as { electronAPI: { getSetting(key: string): Promise<unknown> } }).electronAPI.getSetting(
          'general.theme',
        ),
      );
      expect(theme).toBe('dark');
      await expect(launched.shell.locator('html')).toHaveAttribute('data-theme', 'dark');
    } finally {
      await launched.close();
    }
  });
});
