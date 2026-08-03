import { describe, expect, it } from 'vitest';
import { selectTabsToSuspend, type TabSuspensionCandidate } from '../../src/main/window/TabSuspensionPolicy';

const NOW = 20 * 60_000;
const tab = (id: string, overrides: Partial<TabSuspensionCandidate> = {}): TabSuspensionCandidate => ({
  id,
  lastActiveAt: NOW - 11 * 60_000,
  active: false,
  suspended: false,
  audible: false,
  captured: false,
  detectingMedia: false,
  ...overrides,
});

describe('selectTabsToSuspend', () => {
  it('protects active, audible, captured, and detecting tabs', () => {
    expect(
      selectTabsToSuspend(
        [
          tab('active', { active: true }),
          tab('audible', { audible: true }),
          tab('captured', { captured: true }),
          tab('detecting', { detectingMedia: true }),
          tab('idle'),
        ],
        NOW,
      ),
    ).toEqual(['idle']);
  });

  it('suspends least-recently-used tabs after a grace period when over budget', () => {
    const tabs = Array.from({ length: 10 }, (_, index) =>
      tab(`tab-${index}`, { lastActiveAt: NOW - (2 + index * 0.5) * 60_000 }),
    );

    expect(selectTabsToSuspend(tabs, NOW)).toEqual(['tab-9', 'tab-8']);
  });
});
