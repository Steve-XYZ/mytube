import React, { useEffect, useState, useCallback, useRef } from 'react';
import { TabBar } from './components/TabBar/TabBar';
import { NavigationBar } from './components/NavigationBar/NavigationBar';
import { FindBar } from './components/FindBar/FindBar';
import { DownloadPanel } from './components/DownloadPanel/DownloadPanel';
import { FormatSelector } from './components/FormatSelector/FormatSelector';
import { ImageGallery } from './components/ImageGallery/ImageGallery';
import { Settings } from './components/Settings/Settings';
import { ToastContainer, useToasts } from './components/Toast/Toast';
import { useTabs } from './hooks/useTabs';
import type { DownloadItem, MediaDetectionState } from '../shared/types';

export default function App() {
  const { tabs, activeTabId, activeTab, createTab, closeTab, switchTab, reorderTabs } = useTabs();
  const { messages: toasts, addToast, dismissToast } = useToasts();
  const [findVisible, setFindVisible] = useState(false);
  const [downloadPanelVisible, setDownloadPanelVisible] = useState(false);
  const [formatSelectorUrl, setFormatSelectorUrl] = useState<string | null>(null);
  const [imageGalleryVisible, setImageGalleryVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const urlInputRef = useRef<HTMLInputElement>(null);

  // Listen for keyboard shortcut events from main process
  useEffect(() => {
    const unsubFocusUrl = window.electronAPI.onFocusUrl(() => {
      urlInputRef.current?.focus();
      urlInputRef.current?.select();
    });

    const unsubToggleFind = window.electronAPI.onToggleFind(() => {
      setFindVisible((prev) => !prev);
    });

    const unsubEscape = window.electronAPI.onEscape(() => {
      setFindVisible(false);
      setFormatSelectorUrl(null);
      setImageGalleryVisible(false);
      setSettingsVisible(false);
    });

    const unsubSettings = window.electronAPI.onSettingsChanged((key: string, value: unknown) => {
      if (key === 'general.theme') {
        const theme = value as string;
        if (theme === 'light' || theme === 'dark') {
          document.documentElement.setAttribute('data-theme', theme);
        } else {
          document.documentElement.removeAttribute('data-theme');
        }
      }
    });

    // Apply initial theme
    window.electronAPI.getSetting('general.theme').then((theme: unknown) => {
      if (theme === 'light' || theme === 'dark') {
        document.documentElement.setAttribute('data-theme', theme as string);
      }
    });

    const unsubToggleDownloads = window.electronAPI.onToggleDownloads(() => {
      setDownloadPanelVisible((prev) => !prev);
    });

    return () => {
      unsubFocusUrl();
      unsubToggleFind();
      unsubEscape();
      unsubSettings();
      unsubToggleDownloads();
    };
  }, []);

  const mediaState: MediaDetectionState = activeTab?.mediaState || 'none';

  // Cmd+D: download media from current page
  useEffect(() => {
    const unsub = window.electronAPI.onDownloadMedia(() => {
      if (mediaState === 'detected' || mediaState === 'detecting') {
        if (activeTab?.url) {
          setFormatSelectorUrl(activeTab.url);
        }
      }
    });
    return unsub;
  }, [mediaState, activeTab?.url]);

  // Listen for download errors to show toasts
  useEffect(() => {
    const unsubError = window.electronAPI.onDownloadError((download: unknown) => {
      const item = download as DownloadItem;
      if (item.error && item.error !== 'Cancelled') {
        addToast('error', `Download failed: ${item.title || 'Unknown'}`);
      }
    });
    const unsubComplete = window.electronAPI.onDownloadComplete((download: unknown) => {
      const item = download as DownloadItem;
      addToast('success', `Downloaded: ${item.title || item.filename}`);
    });
    return () => {
      unsubError();
      unsubComplete();
    };
  }, [addToast]);

  const handleDownloadClick = useCallback(() => {
    if (mediaState === 'detected' || mediaState === 'detecting') {
      setFormatSelectorUrl(activeTab?.url || null);
    } else {
      setDownloadPanelVisible((prev) => !prev);
    }
  }, [mediaState, activeTab?.url]);

  const handleStartDownload = useCallback(
    async (url: string, options: { formatId?: string; audioOnly?: boolean; title?: string }) => {
      await window.electronAPI.startDownload(url, options);
      setDownloadPanelVisible(true);
    },
    [],
  );

  const handleToggleDownloadPanel = useCallback(() => {
    setDownloadPanelVisible((prev) => !prev);
  }, []);

  const handleImageGalleryClick = useCallback(() => {
    setImageGalleryVisible(true);
  }, []);

  const handleSettingsClick = useCallback(() => {
    setSettingsVisible(true);
  }, []);

  return (
    <>
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSwitchTab={switchTab}
        onCloseTab={closeTab}
        onNewTab={() => createTab()}
        onReorderTabs={reorderTabs}
      />
      <NavigationBar
        activeTab={activeTab}
        urlInputRef={urlInputRef}
        onDownloadClick={handleDownloadClick}
        onToggleDownloadPanel={handleToggleDownloadPanel}
        onImageGalleryClick={handleImageGalleryClick}
        onSettingsClick={handleSettingsClick}
        mediaState={mediaState}
      />
      <FindBar visible={findVisible} onClose={() => setFindVisible(false)} />
      <DownloadPanel visible={downloadPanelVisible} onClose={() => setDownloadPanelVisible(false)} />
      {formatSelectorUrl && (
        <FormatSelector
          url={formatSelectorUrl}
          onClose={() => setFormatSelectorUrl(null)}
          onDownload={handleStartDownload}
        />
      )}
      <ImageGallery
        visible={imageGalleryVisible}
        webContentsId={activeTab?.webContentsId ?? null}
        pageUrl={activeTab?.url || ''}
        onClose={() => setImageGalleryVisible(false)}
      />
      <Settings visible={settingsVisible} onClose={() => setSettingsVisible(false)} />
      <ToastContainer messages={toasts} onDismiss={dismissToast} />
    </>
  );
}
