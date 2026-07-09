import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { launchApp, waitForPage, type LaunchedApp } from './helpers/app';
import { startTestServer, type TestServer } from './helpers/server';

test.describe('image gallery', () => {
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

  test('scans page images, filters tiny ones, and downloads the selection', async () => {
    const { app, shell, imagesDir } = launched;

    await shell.locator('.url-input').fill(`${server.baseUrl}/gallery`);
    await shell.locator('.url-input').press('Enter');

    const tabPage = await waitForPage(app, (url) => url.startsWith(server.baseUrl));
    await expect(tabPage.locator('#heading')).toHaveText('Gallery');

    // The scan reads naturalWidth/naturalHeight, so images must be loaded.
    await tabPage.waitForFunction(() => Array.from(document.images).every((img) => img.complete));

    await shell.getByTitle('Scan page images').click();
    await expect(shell.locator('.image-gallery')).toBeVisible();

    // 3 images on the page; the 10x10 one must be filtered out.
    await expect(shell.locator('.image-gallery-count')).toContainText('2 images found');
    await expect(shell.locator('.image-gallery-item')).toHaveCount(2);

    await shell.getByRole('button', { name: 'Select All', exact: true }).click();
    await expect(shell.locator('.image-gallery-count')).toContainText('2 selected');

    await shell.locator('.image-gallery-btn-download').click();
    await expect(shell.locator('.image-gallery-result')).toContainText('2 images saved');

    for (const name of ['photo1.png', 'photo2.png']) {
      const filePath = path.join(imagesDir, name);
      expect(fs.existsSync(filePath), `expected downloaded image at ${filePath}`).toBe(true);
      expect(fs.statSync(filePath).size).toBeGreaterThan(0);
    }
  });

  test('reports an empty state on pages without images', async () => {
    const { app, shell } = launched;

    await shell.locator('.url-input').fill(`${server.baseUrl}/`);
    await shell.locator('.url-input').press('Enter');
    await waitForPage(app, (url) => url.startsWith(server.baseUrl));

    await shell.getByTitle('Scan page images').click();
    await expect(shell.locator('.image-gallery')).toBeVisible();
    await expect(shell.locator('.image-gallery-empty')).toBeVisible();
  });
});
