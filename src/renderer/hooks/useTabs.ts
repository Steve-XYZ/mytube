import { useState, useEffect, useCallback, useRef } from 'react';
import type { TabInfo } from '../../shared/types';

export function useTabs() {
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const refreshing = useRef(false);

  // Refresh the full tab list from main process
  const refreshTabs = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const [tabList, currentActiveTabId] = await Promise.all([
        window.electronAPI.getTabs() as Promise<TabInfo[]>,
        window.electronAPI.getActiveTabId() as Promise<string | null>,
      ]);
      setTabs(tabList);
      setActiveTabId((prev) => {
        if (currentActiveTabId) return currentActiveTabId;
        if (prev && tabList.some((tab) => tab.id === prev)) return prev;
        return tabList[0]?.id ?? null;
      });
    } finally {
      refreshing.current = false;
    }
  }, []);

  useEffect(() => {
    // Load initial tabs
    refreshTabs();

    // Listen for tab updates (title, url, loading state changes)
    const unsubUpdate = window.electronAPI.onTabUpdate((tab: unknown) => {
      const tabInfo = tab as TabInfo;
      setTabs((prev) => {
        const exists = prev.some((t) => t.id === tabInfo.id);
        if (exists) {
          return prev.map((t) => (t.id === tabInfo.id ? tabInfo : t));
        }
        // New tab created from main process (e.g., keyboard shortcut or context menu)
        return [...prev, tabInfo];
      });
    });

    const unsubActive = window.electronAPI.onActiveTabChanged((tabId: string) => {
      setActiveTabId(tabId);
      // Refresh to catch any new tabs
      refreshTabs();
    });

    return () => {
      unsubUpdate();
      unsubActive();
    };
  }, [refreshTabs]);

  const createTab = useCallback(async (url?: string) => {
    const newTab: TabInfo = await window.electronAPI.createTab(url);
    setTabs((prev) => {
      const exists = prev.some((t) => t.id === newTab.id);
      return exists ? prev : [...prev, newTab];
    });
    setActiveTabId(newTab.id);
  }, []);

  const closeTab = useCallback(async (tabId: string) => {
    await window.electronAPI.closeTab(tabId);
    setTabs((prev) => prev.filter((t) => t.id !== tabId));
  }, []);

  const switchTab = useCallback(async (tabId: string) => {
    await window.electronAPI.switchTab(tabId);
    setActiveTabId(tabId);
  }, []);

  const reorderTabs = useCallback((fromIndex: number, toIndex: number) => {
    setTabs((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const activeTab = tabs.find((t) => t.id === activeTabId) || null;

  return {
    tabs,
    activeTabId,
    activeTab,
    createTab,
    closeTab,
    switchTab,
    reorderTabs,
  };
}
