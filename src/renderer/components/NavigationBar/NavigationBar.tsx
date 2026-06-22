import React, { useState, useCallback } from 'react';
import type { TabInfo, MediaDetectionState } from '../../../shared/types';
import './NavigationBar.css';

interface NavigationBarProps {
  activeTab: TabInfo | null;
  urlInputRef: React.RefObject<HTMLInputElement | null>;
  onDownloadClick: () => void;
  onToggleDownloadPanel: () => void;
  onImageGalleryClick: () => void;
  onSettingsClick: () => void;
  mediaState: MediaDetectionState;
}

export function NavigationBar({
  activeTab,
  urlInputRef,
  onDownloadClick,
  onToggleDownloadPanel,
  onImageGalleryClick,
  onSettingsClick,
  mediaState,
}: NavigationBarProps) {
  const [urlInput, setUrlInput] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const activeUrl = activeTab?.url ?? '';
  const displayedUrl = isFocused ? urlInput : activeUrl;

  const handleNavigate = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const targetUrl = displayedUrl.trim();
      if (targetUrl) {
        window.electronAPI.navigate(targetUrl);
        urlInputRef.current?.blur();
      }
    },
    [displayedUrl, urlInputRef],
  );

  const handleUrlFocus = useCallback(() => {
    setUrlInput(activeUrl);
    setIsFocused(true);
    setTimeout(() => urlInputRef.current?.select(), 0);
  }, [activeUrl, urlInputRef]);

  const handleUrlBlur = useCallback(() => {
    setIsFocused(false);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setUrlInput(activeUrl);
        urlInputRef.current?.blur();
      }
    },
    [activeUrl, urlInputRef],
  );

  const zoomPercent = activeTab ? Math.round(Math.pow(1.2, activeTab.zoomLevel) * 100) : 100;
  const showZoom = activeTab && activeTab.zoomLevel !== 0;

  const downloadButtonTitle =
    mediaState === 'detecting'
      ? 'Detecting media...'
      : mediaState === 'detected'
        ? `Download: ${activeTab?.mediaTitle || 'media'}`
        : 'Try downloading media from this page';

  return (
    <div className="nav-bar">
      <div className="nav-buttons">
        <button
          className="nav-btn"
          onClick={() => window.electronAPI.goBack()}
          disabled={!activeTab?.canGoBack}
          title="Back (Cmd+[)"
        >
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path
              d="M11 1L4 8l7 7"
              stroke="currentColor"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <button
          className="nav-btn"
          onClick={() => window.electronAPI.goForward()}
          disabled={!activeTab?.canGoForward}
          title="Forward (Cmd+])"
        >
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path
              d="M5 1l7 7-7 7"
              stroke="currentColor"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <button
          className="nav-btn"
          onClick={() => (activeTab?.isLoading ? window.electronAPI.stopLoading() : window.electronAPI.reload())}
          title={activeTab?.isLoading ? 'Stop' : 'Reload (Cmd+R)'}
        >
          {activeTab?.isLoading ? (
            <svg width="16" height="16" viewBox="0 0 16 16">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16">
              <path d="M13.65 2.35A7 7 0 1 0 15 8h-2a5 5 0 1 1-1-3.5L9 8h6V1l-1.35 1.35z" fill="currentColor" />
            </svg>
          )}
        </button>
      </div>

      <form className="url-bar-form" onSubmit={handleNavigate}>
        <div className={`url-bar ${isFocused ? 'url-bar-focused' : ''}`}>
          {!isFocused && activeTab?.isSecure && (
            <span className="url-lock" title="Secure connection">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                <path d="M9 5V4a3 3 0 0 0-6 0v1a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1zM4.5 4a1.5 1.5 0 0 1 3 0v1h-3V4z" />
              </svg>
            </span>
          )}
          <input
            ref={urlInputRef}
            type="text"
            className="url-input"
            value={displayedUrl}
            onChange={(e) => setUrlInput(e.target.value)}
            onFocus={handleUrlFocus}
            onBlur={handleUrlBlur}
            onKeyDown={handleKeyDown}
            placeholder="Search or enter URL"
            spellCheck={false}
          />
        </div>
      </form>

      <div className="nav-actions">
        {showZoom && (
          <button
            className="nav-btn zoom-indicator"
            onClick={() => window.electronAPI.zoomReset()}
            title={`Zoom: ${zoomPercent}% (click to reset)`}
          >
            {zoomPercent}%
          </button>
        )}

        {/* Image gallery button */}
        <button className="nav-btn" onClick={onImageGalleryClick} title="Scan page images">
          <svg width="16" height="16" viewBox="0 0 16 16">
            <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <circle cx="5.5" cy="6" r="1.5" fill="currentColor" />
            <path
              d="M1.5 11l3.5-3.5 2.5 2.5 2.5-3.5L14.5 11"
              stroke="currentColor"
              strokeWidth="1.3"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {/* Download current page media */}
        <button
          className={`nav-btn ${mediaState === 'detected' ? 'nav-btn-download-active' : 'nav-btn-download-idle'}`}
          onClick={onDownloadClick}
          disabled={!activeTab || mediaState === 'detecting'}
          title={downloadButtonTitle}
        >
          {mediaState === 'detecting' ? (
            <span className="nav-btn-spinner" />
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16">
              <path
                d="M8 1v9M4 7l4 4 4-4M2 13h12"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>

        {/* Downloads panel toggle */}
        <button className="nav-btn" onClick={onToggleDownloadPanel} title="Downloads (Cmd+J)">
          <svg width="16" height="16" viewBox="0 0 16 16">
            <rect x="2" y="3" width="12" height="10" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <path d="M5 7h6M5 9.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>

        {/* Settings */}
        <button className="nav-btn" onClick={onSettingsClick} title="Settings">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm6.32-2.76l-1.2-.7a5.08 5.08 0 0 0 0-1.08l1.2-.7a.5.5 0 0 0 .18-.64l-1-1.73a.5.5 0 0 0-.62-.22l-1.34.54a4.93 4.93 0 0 0-.94-.54L10.36.93A.5.5 0 0 0 9.88.5H7.88a.5.5 0 0 0-.48.43l-.24 1.44a4.93 4.93 0 0 0-.94.54L4.88 2.37a.5.5 0 0 0-.62.22l-1 1.73a.5.5 0 0 0 .18.64l1.2.7a5.08 5.08 0 0 0 0 1.08l-1.2.7a.5.5 0 0 0-.18.64l1 1.73a.5.5 0 0 0 .62.22l1.34-.54c.28.22.6.4.94.54l.24 1.44a.5.5 0 0 0 .48.43h2a.5.5 0 0 0 .48-.43l.24-1.44c.34-.14.66-.32.94-.54l1.34.54a.5.5 0 0 0 .62-.22l1-1.73a.5.5 0 0 0-.18-.64z" />
          </svg>
        </button>
      </div>

      {/* Page loading progress bar */}
      {activeTab?.isLoading && (
        <div className="nav-loading-bar">
          <div className="nav-loading-bar-progress" />
        </div>
      )}
    </div>
  );
}
