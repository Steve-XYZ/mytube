export interface TabSuspensionCandidate {
  id: string;
  lastActiveAt: number;
  active: boolean;
  suspended: boolean;
  audible: boolean;
  captured: boolean;
  detectingMedia: boolean;
}

const LIVE_TAB_BUDGET = 8;
const INACTIVE_TIMEOUT_MS = 10 * 60_000;
const PRESSURE_GRACE_MS = 2 * 60_000;

export function selectTabsToSuspend(candidates: TabSuspensionCandidate[], now: number): string[] {
  let overBudget = Math.max(0, candidates.filter((tab) => !tab.suspended).length - LIVE_TAB_BUDGET);
  const eligible = candidates
    .filter((tab) => !tab.active && !tab.suspended && !tab.audible && !tab.captured && !tab.detectingMedia)
    .sort((a, b) => a.lastActiveAt - b.lastActiveAt);
  const selected: string[] = [];

  for (const tab of eligible) {
    const idleMs = now - tab.lastActiveAt;
    if (idleMs >= INACTIVE_TIMEOUT_MS || (overBudget > 0 && idleMs >= PRESSURE_GRACE_MS)) {
      selected.push(tab.id);
      overBudget = Math.max(0, overBudget - 1);
    }
  }
  return selected;
}
