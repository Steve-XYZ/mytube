import { describe, expect, it } from 'vitest';
import { isAppAutoUpdateEnabled } from '../../src/main/updater/AutoUpdater';

describe('isAppAutoUpdateEnabled', () => {
  it('stays disabled until a publish provider is explicitly enabled', () => {
    expect(isAppAutoUpdateEnabled({})).toBe(false);
    expect(isAppAutoUpdateEnabled({ MYTUBE_AUTO_UPDATE_ENABLED: '0' })).toBe(false);
    expect(isAppAutoUpdateEnabled({ MYTUBE_AUTO_UPDATE_ENABLED: '1' })).toBe(true);
  });
});
