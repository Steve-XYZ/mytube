import { test, expect } from '@playwright/test';
import { launchApp, type LaunchedApp } from './helpers/app';
import { startTestServer, type TestServer } from './helpers/server';

test.describe('history and bookmarks', () => {
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

  async function navigateTo(pathname: string, expectedTitle: string) {
    const { shell } = launched;
    await shell.locator('.url-input').fill(`${server.baseUrl}${pathname}`);
    await shell.locator('.url-input').press('Enter');
    await expect(shell.locator('.tab-active .tab-title')).toHaveText(expectedTitle);
  }

  test('records visits, searches them, and reopens pages from history', async () => {
    const { shell } = launched;

    await navigateTo('/', 'E2E Page A');
    await navigateTo('/b', 'E2E Page B');

    await shell.getByTitle('History and bookmarks').click();
    const panel = shell.locator('.history-panel');
    await expect(panel).toBeVisible();

    // Both visits are listed, newest first.
    const titles = panel.locator('.hp-item-title');
    await expect(titles).toHaveCount(2);
    await expect(titles.nth(0)).toHaveText('E2E Page B');
    await expect(titles.nth(1)).toHaveText('E2E Page A');

    // Search narrows the list.
    await panel.locator('.hp-search').fill('page a');
    await expect(titles).toHaveCount(1);
    await expect(titles.first()).toHaveText('E2E Page A');

    // Clicking an entry navigates the active tab and closes the panel.
    await panel.locator('.hp-item-main').first().click();
    await expect(panel).toHaveCount(0);
    await expect(shell.locator('.tab-active .tab-title')).toHaveText('E2E Page A');
  });

  test('clears browsing history', async () => {
    const { shell } = launched;
    await navigateTo('/', 'E2E Page A');

    await shell.getByTitle('History and bookmarks').click();
    const panel = shell.locator('.history-panel');
    await expect(panel.locator('.hp-item')).toHaveCount(1);

    await panel.getByTitle('Clear browsing history').click();
    await expect(panel.locator('.hp-item')).toHaveCount(0);
    await expect(panel.locator('.hp-empty')).toContainText('No history yet');
  });

  test('bookmarks a page from the star and persists across restarts', async () => {
    const { shell } = launched;
    await navigateTo('/', 'E2E Page A');

    // The star is disabled on the internal new tab page but enabled here.
    const star = shell.getByTitle('Bookmark this page');
    await star.click();
    await expect(shell.getByTitle('Remove bookmark')).toBeVisible();

    // The bookmark shows up in the panel.
    await shell.getByTitle('History and bookmarks').click();
    await shell.getByRole('tab', { name: 'Bookmarks' }).click();
    const panel = shell.locator('.history-panel');
    await expect(panel.locator('.hp-item-title')).toHaveText(['E2E Page A']);

    // Relaunch: the restored tab still shows the filled star and the entry.
    const { userDataDir } = launched;
    await launched.app.close();
    launched = await launchApp({ userDataDir });

    await expect(launched.shell.locator('.tab-active .tab-title')).toHaveText('E2E Page A');
    await expect(launched.shell.getByTitle('Remove bookmark')).toBeVisible();

    // Unstar removes it everywhere.
    await launched.shell.getByTitle('Remove bookmark').click();
    await expect(launched.shell.getByTitle('Bookmark this page')).toBeVisible();
    await launched.shell.getByTitle('History and bookmarks').click();
    await launched.shell.getByRole('tab', { name: 'Bookmarks' }).click();
    await expect(launched.shell.locator('.hp-empty')).toContainText('No bookmarks yet');
  });
});
