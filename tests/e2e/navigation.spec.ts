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

  test('keeps the healthy main frame when a subframe fails to load', async () => {
    const { app, shell } = launched;
    const pageUrl = `${server.baseUrl}/subframe-failure`;

    await shell.locator('.url-input').fill(pageUrl);
    await shell.locator('.url-input').press('Enter');

    const tabPage = await waitForPage(app, (url) => url === pageUrl);
    await server.waitForFailureRequest();
    await tabPage.waitForLoadState('networkidle');

    await expect(tabPage.locator('#heading')).toHaveText('Healthy Main Frame');
    await expect(shell.locator('.tab-active .tab-title')).toHaveText('E2E Healthy Main Frame');
    await expect(shell.locator('.url-input')).toHaveValue(pageUrl);
  });

  test('shows the error page when the main frame fails to load', async () => {
    const { app, shell } = launched;

    await shell.locator('.url-input').fill(`${server.baseUrl}/`);
    await shell.locator('.url-input').press('Enter');
    const tabPage = await waitForPage(app, (url) => url === `${server.baseUrl}/`);

    await shell.locator('.url-input').fill(`${server.failureBaseUrl}/broken-main-frame`);
    await shell.locator('.url-input').press('Enter');
    await server.waitForFailureRequest();

    await expect(tabPage.getByRole('button', { name: 'Try Again' })).toBeVisible();
    await expect(tabPage.locator('.url')).toContainText(server.failureBaseUrl);
  });
});
