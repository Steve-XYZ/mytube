import { test, expect } from '@playwright/test';
import { launchApp, waitForPage, type LaunchedApp } from './helpers/app';
import { startTestServer } from './helpers/server';

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

  test('preserves the opener for OAuth popups and closes the child without adding a tab', async () => {
    const server = await startTestServer();
    try {
      const openerUrl = `${server.baseUrl}/oauth-opener`;
      await launched.shell.locator('.url-input').fill(openerUrl);
      await launched.shell.locator('.url-input').press('Enter');
      const opener = await waitForPage(launched.app, (url) => url === openerUrl);

      await opener.locator('#login').click();

      await expect(opener.locator('#result')).toHaveText('completed');
      await expect(launched.shell.locator('.tab')).toHaveCount(1);
    } finally {
      await server.close();
    }
  });

  test('preserves OAuth context when the provider starts from about:blank', async () => {
    const server = await startTestServer();
    try {
      const openerUrl = `${server.baseUrl}/oauth-opener`;
      await launched.shell.locator('.url-input').fill(openerUrl);
      await launched.shell.locator('.url-input').press('Enter');
      const opener = await waitForPage(launched.app, (url) => url === openerUrl);

      await opener.locator('#login-blank').click();

      await expect(opener.locator('#result')).toHaveText('completed');
      await expect(launched.shell.locator('.tab')).toHaveCount(1);
    } finally {
      await server.close();
    }
  });

  test('keeps ordinary target-blank links in the managed tab bar', async () => {
    const server = await startTestServer();
    try {
      const openerUrl = `${server.baseUrl}/tab-opener`;
      await launched.shell.locator('.url-input').fill(openerUrl);
      await launched.shell.locator('.url-input').press('Enter');
      const opener = await waitForPage(launched.app, (url) => url === openerUrl);

      await opener.locator('#open-tab').click();

      await expect(launched.shell.locator('.tab')).toHaveCount(2);
      await waitForPage(launched.app, (url) => url === `${server.baseUrl}/b`);
    } finally {
      await server.close();
    }
  });
});
