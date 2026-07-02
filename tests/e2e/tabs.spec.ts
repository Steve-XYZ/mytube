import { test, expect } from '@playwright/test';
import { launchApp, type LaunchedApp } from './helpers/app';

test.describe('tab management', () => {
  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('creates, switches, and closes tabs from the tab bar', async () => {
    const { shell } = launched;
    const tabs = shell.locator('.tab');

    await expect(tabs).toHaveCount(1);
    await expect(tabs.first()).toHaveClass(/tab-active/);

    // New tab becomes the active tab.
    await shell.getByTitle('New tab').click();
    await expect(tabs).toHaveCount(2);
    await expect(tabs.nth(1)).toHaveClass(/tab-active/);
    await expect(tabs.nth(0)).not.toHaveClass(/tab-active/);

    // Switching back activates the first tab.
    await tabs.nth(0).click();
    await expect(tabs.nth(0)).toHaveClass(/tab-active/);
    await expect(tabs.nth(1)).not.toHaveClass(/tab-active/);

    // Closing the second tab leaves one tab standing.
    await tabs.nth(1).getByTitle('Close tab').click();
    await expect(tabs).toHaveCount(1);
    await expect(tabs.first()).toHaveClass(/tab-active/);
  });

  test('closing the last tab replaces it with a fresh new tab', async () => {
    const { shell } = launched;
    const tabs = shell.locator('.tab');

    await expect(tabs).toHaveCount(1);
    await tabs.first().getByTitle('Close tab').click();

    // TabManager creates a replacement tab so the window is never empty.
    await expect(tabs).toHaveCount(1);
    await expect(tabs.first()).toHaveClass(/tab-active/);
    await expect(tabs.first().locator('.tab-title')).toHaveText('MyTube');
  });
});
