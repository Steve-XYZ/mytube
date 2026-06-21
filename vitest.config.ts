import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/main/**/*.ts', 'src/shared/**/*.ts'],
      exclude: [
        'src/main/index.ts',
        'src/main/window/MainWindow.ts',
        'src/main/window/TabManager.ts',
        'src/main/window/AppMenu.ts',
        'src/main/window/KeyboardShortcuts.ts',
        'src/main/updater/AutoUpdater.ts',
      ],
      reporter: ['text', 'text-summary'],
    },
    setupFiles: ['tests/__mocks__/electron.ts'],
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
});
