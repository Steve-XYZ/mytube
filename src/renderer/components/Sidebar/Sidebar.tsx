import React, { useState, useCallback, useEffect } from 'react';
import type { TabInfo } from '../../../shared/types';
import { NEW_TAB_URL } from '../../../shared/constants';
import './Sidebar.css';

interface SidebarProps {
  activeTab: TabInfo | null;
  historyPanelVisible: boolean;
  downloadPanelVisible: boolean;
  settingsVisible: boolean;
  onToggleHistoryPanel: () => void;
  onToggleDownloadPanel: () => void;
  onSettingsClick: () => void;
}

// The authoritative collapsed state lives in settings (main needs it for the
// content view bounds), but that arrives async — a localStorage mirror gives
// the right first paint instead of an expanded->collapsed flash.
const COLLAPSED_CACHE_KEY = 'sidebarCollapsed';

export function Sidebar({
  activeTab,
  historyPanelVisible,
  downloadPanelVisible,
  settingsVisible,
  onToggleHistoryPanel,
  onToggleDownloadPanel,
  onSettingsClick,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_CACHE_KEY) === '1');
  const [themeSetting, setThemeSetting] = useState<unknown>(null);
  const [osPrefersDark, setOsPrefersDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  useEffect(() => {
    window.electronAPI.getSetting('browser.sidebarCollapsed').then((value: unknown) => {
      setCollapsed(value === true);
    });
    window.electronAPI.getSetting('general.theme').then(setThemeSetting);
    const unsubscribe = window.electronAPI.onSettingsChanged((key: string, value: unknown) => {
      if (key === 'browser.sidebarCollapsed') setCollapsed(value === true);
      if (key === 'general.theme') setThemeSetting(value);
    });
    return unsubscribe;
  }, []);

  // Keep the theme icon honest while the setting is 'system'.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (event: MediaQueryListEvent) => setOsPrefersDark(event.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    localStorage.setItem(COLLAPSED_CACHE_KEY, collapsed ? '1' : '0');
    // Overlays (e.g. the permission prompt) offset themselves past the sidebar.
    document.documentElement.style.setProperty('--sidebar-width', collapsed ? '64px' : '200px');
  }, [collapsed]);

  const theme: 'light' | 'dark' =
    themeSetting === 'light' || themeSetting === 'dark' ? themeSetting : osPrefersDark ? 'dark' : 'light';

  const handleToggleCollapsed = useCallback(() => {
    // Optimistic update; the settings-changed event keeps other listeners
    // (and the content view bounds in main) in sync.
    setCollapsed((prev) => {
      window.electronAPI.setSetting('browser.sidebarCollapsed', !prev);
      return !prev;
    });
  }, []);

  const handleToggleTheme = useCallback(() => {
    window.electronAPI.setSetting('general.theme', theme === 'dark' ? 'light' : 'dark');
  }, [theme]);

  const handleHomeClick = useCallback(() => {
    window.electronAPI.navigate(NEW_TAB_URL);
  }, []);

  const isHome = activeTab?.url === NEW_TAB_URL;

  const items = [
    {
      key: 'home',
      label: 'Home',
      active: isHome,
      onClick: handleHomeClick,
      icon: (
        <svg viewBox="0 0 18 18">
          <path
            d="M3 8l6-5.2L15 8v6.5a1 1 0 0 1-1 1h-3.4v-4.2H7.4v4.2H4a1 1 0 0 1-1-1V8z"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
            strokeLinejoin="round"
          />
        </svg>
      ),
    },
    {
      key: 'history',
      label: 'History',
      active: historyPanelVisible,
      onClick: onToggleHistoryPanel,
      icon: (
        <svg viewBox="0 0 18 18">
          <circle cx="9" cy="9" r="6.8" stroke="currentColor" strokeWidth="1.5" fill="none" />
          <path d="M9 5.4V9l2.6 1.8" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      key: 'downloads',
      label: 'Downloads',
      active: downloadPanelVisible,
      onClick: onToggleDownloadPanel,
      icon: (
        <svg viewBox="0 0 18 18">
          <path
            d="M9 2.5v8M5.5 7l3.5 3.5L12.5 7M3 14.5h12"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ),
    },
    {
      key: 'settings',
      label: 'Settings',
      active: settingsVisible,
      onClick: onSettingsClick,
      icon: (
        <svg viewBox="0 0 18 18">
          <circle cx="9" cy="9" r="2.2" stroke="currentColor" strokeWidth="1.5" fill="none" />
          <path
            d="M9 2l.9 2.1 2.2-.6 1.4 1.4-.6 2.2L15 8l1 1-1 1-2.1.9.6 2.2-1.4 1.4-2.2-.6L9 16l-1-2.1-2.2.6-1.4-1.4.6-2.2L3 10 2 9l1-1 2.1-.9-.6-2.2 1.4-1.4 2.2.6L9 2z"
            stroke="currentColor"
            strokeWidth="1.2"
            fill="none"
            strokeLinejoin="round"
          />
        </svg>
      ),
    },
  ];

  return (
    <nav className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <div className="sidebar-brand" onClick={handleHomeClick} title="MyTube">
        <span className="sidebar-brand-mark">
          <svg viewBox="0 0 16 16">
            <path fill="#fff" d="M6 4.5v7l5.5-3.5z" />
          </svg>
        </span>
        {!collapsed && <span className="sidebar-brand-name">MyTube</span>}
      </div>

      <div className="sidebar-items">
        {items.map((item) => (
          <button
            key={item.key}
            className={`sidebar-item ${item.active ? 'sidebar-item-active' : ''}`}
            onClick={item.onClick}
            title={item.label}
          >
            <span className="sidebar-item-icon">{item.icon}</span>
            {!collapsed && <span className="sidebar-item-label">{item.label}</span>}
          </button>
        ))}
      </div>

      <div className="sidebar-footer">
        <button
          className="sidebar-item"
          onClick={handleToggleTheme}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          <span className="sidebar-item-icon">
            {theme === 'dark' ? (
              <svg viewBox="0 0 18 18">
                <path
                  d="M15 10.5A6.5 6.5 0 0 1 7.5 3 6.5 6.5 0 1 0 15 10.5z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  fill="none"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 18 18">
                <circle cx="9" cy="9" r="3.2" stroke="currentColor" strokeWidth="1.5" fill="none" />
                <path
                  d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.7 3.7l1.4 1.4M12.9 12.9l1.4 1.4M14.3 3.7l-1.4 1.4M5.1 12.9l-1.4 1.4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            )}
          </span>
          {!collapsed && <span className="sidebar-item-label">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>}
        </button>

        <button
          className="sidebar-item"
          onClick={handleToggleCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <span className="sidebar-item-icon">
            <svg viewBox="0 0 18 18" style={collapsed ? { transform: 'scaleX(-1)' } : undefined}>
              <path
                d="M10.5 4.5L6 9l4.5 4.5M14 4.5L9.5 9l4.5 4.5"
                stroke="currentColor"
                strokeWidth="1.5"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          {!collapsed && <span className="sidebar-item-label">Collapse</span>}
        </button>
      </div>
    </nav>
  );
}
