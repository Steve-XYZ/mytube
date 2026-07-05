import { test, expect, type Page } from '@playwright/test';
import { launchApp, waitForPage, type LaunchedApp } from './helpers/app';
import { startTestServer, type TestServer } from './helpers/server';

test.describe('site permission prompts', () => {
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

  async function openPermissionsPage(): Promise<Page> {
    const { shell, app } = launched;
    await shell.locator('.url-input').fill(`${server.baseUrl}/permissions`);
    await shell.locator('.url-input').press('Enter');
    const tabPage = await waitForPage(app, (url) => url === `${server.baseUrl}/permissions`);
    await expect(tabPage.locator('#heading')).toHaveText('Permissions');
    return tabPage;
  }

  test('allowing a prompt grants the permission and persists across restarts', async () => {
    const tabPage = await openPermissionsPage();

    await tabPage.locator('#req-notif').click();

    const prompt = launched.shell.locator('.permission-prompt');
    await expect(prompt).toBeVisible();
    await expect(prompt).toContainText('wants to show notifications');
    await launched.shell.getByRole('button', { name: 'Allow' }).click();

    await expect(tabPage.locator('#result')).toHaveText('granted');
    await expect(prompt).toHaveCount(0);

    // Relaunch: the stored decision answers the synchronous permission check.
    const { userDataDir } = launched;
    await launched.app.close();
    launched = await launchApp({ userDataDir });

    const restored = await waitForPage(launched.app, (url) => url === `${server.baseUrl}/permissions`);
    await expect(restored.locator('#perm-state')).toHaveText('granted');
  });

  test('blocking a prompt denies the permission without re-prompting', async () => {
    const tabPage = await openPermissionsPage();

    await tabPage.locator('#req-notif').click();
    await expect(launched.shell.locator('.permission-prompt')).toBeVisible();
    await launched.shell.getByRole('button', { name: 'Block' }).click();
    await expect(tabPage.locator('#result')).toHaveText('denied');

    // Asking again resolves instantly from the stored decision.
    await tabPage.locator('#result').evaluate((el) => (el.textContent = ''));
    await tabPage.locator('#req-notif').click();
    await expect(tabPage.locator('#result')).toHaveText('denied');
    await expect(launched.shell.locator('.permission-prompt')).toHaveCount(0);
  });

  test('policy-denied permissions never prompt', async () => {
    const tabPage = await openPermissionsPage();

    const outcome = await tabPage.evaluate(
      () =>
        new Promise<string>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            () => resolve('granted'),
            (err) => resolve(`denied:${err.code}`),
            { timeout: 3000 },
          );
        }),
    );

    expect(outcome.startsWith('denied')).toBe(true);
    await expect(launched.shell.locator('.permission-prompt')).toHaveCount(0);
  });
});
