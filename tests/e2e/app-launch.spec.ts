import { test, expect } from '@playwright/test';
import { launchApp, waitForPage, isNewTabPageUrl, type LaunchedApp } from './helpers/app';

test.describe('app launch', () => {
  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('launches the renderer shell in a MyTube window', async () => {
    const { app, shell } = launched;

    await expect.poll(async () => app.evaluate(({ app: electronApp }) => electronApp.isReady())).toBe(true);
    await expect
      .poll(async () => app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().map((window) => window.getTitle())))
      .toContain('MyTube');

    await expect(shell.locator('.tab-bar')).toBeVisible();
    await expect(shell.locator('.nav-bar')).toBeVisible();
    await expect(shell.locator('.tab')).toHaveCount(1);
    await expect(shell.locator('.url-input')).toBeVisible();
  });

  test('does not expose Node APIs to the shell or browser tabs', async () => {
    const { app, shell } = launched;

    const shellGlobals = await shell.evaluate(() => ({
      hasRequire: 'require' in window,
      hasProcess: 'process' in window,
      hasElectronAPI: typeof (window as { electronAPI?: unknown }).electronAPI === 'object',
    }));
    expect(shellGlobals).toEqual({ hasRequire: false, hasProcess: false, hasElectronAPI: true });

    const tabPage = await waitForPage(app, isNewTabPageUrl);
    const tabGlobals = await tabPage.evaluate(() => ({
      hasRequire: 'require' in window,
      hasProcess: 'process' in window,
      hasElectronAPI: 'electronAPI' in window,
    }));
    expect(tabGlobals).toEqual({ hasRequire: false, hasProcess: false, hasElectronAPI: false });
  });
});
