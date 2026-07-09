import { test, expect } from '@playwright/test';
import { launchApp, waitForPage, type LaunchedApp } from './helpers/app';
import { startTestServer, type TestServer } from './helpers/server';

test.describe('navigation', () => {
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

  test('navigates via the URL bar and syncs tab state to the shell', async () => {
    const { app, shell } = launched;

    await shell.locator('.url-input').fill(`${server.baseUrl}/`);
    await shell.locator('.url-input').press('Enter');

    const tabPage = await waitForPage(app, (url) => url.startsWith(server.baseUrl));
    await expect(tabPage.locator('#heading')).toHaveText('Page A');

    // Title and URL propagate back to the shell UI.
    await expect(shell.locator('.tab-active .tab-title')).toHaveText('E2E Page A');
    await expect(shell.locator('.url-input')).toHaveValue(`${server.baseUrl}/`);
  });

  test('back and forward buttons traverse tab history', async () => {
    const { app, shell } = launched;

    await shell.locator('.url-input').fill(`${server.baseUrl}/`);
    await shell.locator('.url-input').press('Enter');

    const tabPage = await waitForPage(app, (url) => url.startsWith(server.baseUrl));
    await tabPage.locator('#to-b').click();
    await expect(shell.locator('.tab-active .tab-title')).toHaveText('E2E Page B');

    await shell.getByTitle('Back (Cmd+[)').click();
    await expect(shell.locator('.tab-active .tab-title')).toHaveText('E2E Page A');

    await shell.getByTitle('Forward (Cmd+])').click();
    await expect(shell.locator('.tab-active .tab-title')).toHaveText('E2E Page B');
  });
});
