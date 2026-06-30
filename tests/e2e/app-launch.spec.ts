import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';

test('launches the packaged renderer shell', async () => {
  let app: ElectronApplication | null = null;

  try {
    app = await electron.launch({
      args: ['.'],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        MYTUBE_E2E: '1',
      },
    });

    await expect
      .poll(async () => app?.evaluate(({ app }) => app.isReady()) ?? false)
      .toBe(true);
    await expect
      .poll(async () =>
        app?.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().map((window) => window.getTitle())) ?? [],
      )
      .toContain('MyTube');
  } finally {
    await app?.close();
  }
});
