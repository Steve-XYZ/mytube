import { test, expect } from '@playwright/test';
import { launchApp, waitForPage, type LaunchedApp } from './helpers/app';
import { startTestServer, type TestServer } from './helpers/server';

test.describe('session restore', () => {
  let launched: LaunchedApp;
  let server: TestServer;

  test.beforeEach(async () => {
    server = await startTestServer();
    launched = await launchApp();
  });

  test.afterEach(async () => {
    await launched.close();
    await server.close();
  });

  test('restores tabs, titles, and the active tab across restarts', async () => {
    const { shell } = launched;

    // Tab 1 -> page A, tab 2 -> page B (stays active).
    await shell.locator('.url-input').fill(`${server.baseUrl}/`);
    await shell.locator('.url-input').press('Enter');
    await expect(shell.locator('.tab-active .tab-title')).toHaveText('E2E Page A');

    await shell.getByTitle('New tab').click();
    await shell.locator('.url-input').fill(`${server.baseUrl}/b`);
    await shell.locator('.url-input').press('Enter');
    await expect(shell.locator('.tab-active .tab-title')).toHaveText('E2E Page B');

    // Relaunch against the same userData dir.
    const { userDataDir } = launched;
    await launched.app.close();
    launched = await launchApp({ userDataDir });

    const tabs = launched.shell.locator('.tab');
    await expect(tabs).toHaveCount(2);
    await expect(tabs.nth(0).locator('.tab-title')).toHaveText('E2E Page A');
    await expect(tabs.nth(1).locator('.tab-title')).toHaveText('E2E Page B');
    await expect(tabs.nth(1)).toHaveClass(/tab-active/);

    // The active tab actually loaded its page again.
    const pageB = await waitForPage(launched.app, (url) => url === `${server.baseUrl}/b`);
    await expect(pageB.locator('#heading')).toHaveText('Page B');

    // The background tab was restored suspended: activating it loads page A.
    await tabs.nth(0).click();
    const pageA = await waitForPage(launched.app, (url) => url === `${server.baseUrl}/`);
    await expect(pageA.locator('#heading')).toHaveText('Page A');
    await expect(launched.shell.locator('.url-input')).toHaveValue(`${server.baseUrl}/`);
  });

  test('starts with a fresh tab when session restore is disabled', async () => {
    const { shell } = launched;

    await shell.locator('.url-input').fill(`${server.baseUrl}/`);
    await shell.locator('.url-input').press('Enter');
    await expect(shell.locator('.tab-active .tab-title')).toHaveText('E2E Page A');

    await shell.evaluate(() =>
      (
        window as unknown as { electronAPI: { setSetting(key: string, value: unknown): Promise<void> } }
      ).electronAPI.setSetting('browser.restoreSession', false),
    );

    const { userDataDir } = launched;
    await launched.app.close();
    launched = await launchApp({ userDataDir });

    const tabs = launched.shell.locator('.tab');
    await expect(tabs).toHaveCount(1);
    await expect(tabs.first().locator('.tab-title')).toHaveText('MyTube');
  });

  test('restores window bounds across restarts', async () => {
    await launched.app.evaluate(({ BaseWindow }) => {
      BaseWindow.getAllWindows()[0].setBounds({ x: 60, y: 60, width: 1000, height: 700 });
    });

    const { userDataDir } = launched;
    await launched.app.close();
    launched = await launchApp({ userDataDir });

    const bounds = await launched.app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].getBounds());
    expect(bounds).toEqual({ x: 60, y: 60, width: 1000, height: 700 });
  });
});
