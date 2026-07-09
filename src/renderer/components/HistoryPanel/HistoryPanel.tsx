import React, { useEffect, useState, useCallback, useRef } from 'react';
import type { HistoryEntry, Bookmark } from '../../../shared/types';
import './HistoryPanel.css';

interface HistoryPanelProps {
  visible: boolean;
  onClose: () => void;
}

type ViewMode = 'history' | 'bookmarks';

export function HistoryPanel({ visible, onClose }: HistoryPanelProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('history');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [search, setSearch] = useState('');

  // Guards against out-of-order responses while typing in the search box.
  const historyRequestToken = useRef(0);

  const refreshHistory = useCallback((query: string) => {
    const token = ++historyRequestToken.current;
    window.electronAPI.getHistory({ search: query || undefined }).then((entries: unknown) => {
      if (token === historyRequestToken.current) {
        setHistory((entries as HistoryEntry[]) || []);
      }
    });
  }, []);

  const refreshBookmarks = useCallback(() => {
    window.electronAPI.listBookmarks().then((items: unknown) => {
      setBookmarks((items as Bookmark[]) || []);
    });
  }, []);

  useEffect(() => {
    if (!visible) return;
    refreshHistory(search);
    refreshBookmarks();
  }, [visible, search, refreshHistory, refreshBookmarks]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onBookmarksChanged((items: unknown[]) => {
      setBookmarks((items as Bookmark[]) || []);
    });
    return unsubscribe;
  }, []);

  const openUrl = useCallback(
    (url: string) => {
      window.electronAPI.navigate(url);
      onClose();
    },
    [onClose],
  );

  const handleDeleteHistory = useCallback(
    async (id: string) => {
      await window.electronAPI.deleteHistoryEntry(id);
      refreshHistory(search);
    },
    [refreshHistory, search],
  );

  const handleClearHistory = useCallback(async () => {
    await window.electronAPI.clearHistory();
    refreshHistory(search);
  }, [refreshHistory, search]);

  const handleRemoveBookmark = useCallback(async (id: string) => {
    await window.electronAPI.removeBookmark(id);
  }, []);

  if (!visible) return null;

  return (
    <div className="history-panel">
      <div className="hp-header">
        <h3>{viewMode === 'history' ? 'History' : 'Bookmarks'}</h3>
        <div className="hp-header-actions">
          {viewMode === 'history' && history.length > 0 && (
            <button className="hp-clear-btn" onClick={handleClearHistory} title="Clear browsing history">
              Clear
            </button>
          )}
          <button className="hp-close-btn" onClick={onClose}>
            &times;
          </button>
        </div>
      </div>

      <div className="hp-tabs" role="tablist" aria-label="History panel view">
        <button
          className={`hp-tab ${viewMode === 'history' ? 'active' : ''}`}
          onClick={() => setViewMode('history')}
          role="tab"
          aria-selected={viewMode === 'history'}
        >
          History
        </button>
        <button
          className={`hp-tab ${viewMode === 'bookmarks' ? 'active' : ''}`}
          onClick={() => setViewMode('bookmarks')}
          role="tab"
          aria-selected={viewMode === 'bookmarks'}
        >
          Bookmarks
        </button>
      </div>

      {viewMode === 'history' && (
        <div className="hp-tools">
          <input
            className="hp-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search history"
          />
        </div>
      )}

      <div className="hp-list">
        {viewMode === 'history' && history.length === 0 && (
          <div className="hp-empty">
            <p>{search ? 'No matches' : 'No history yet'}</p>
            <p className="hp-empty-hint">Pages you visit will appear here</p>
          </div>
        )}

        {viewMode === 'bookmarks' && bookmarks.length === 0 && (
          <div className="hp-empty">
            <p>No bookmarks yet</p>
            <p className="hp-empty-hint">Use the star in the address bar to save pages</p>
          </div>
        )}

        {viewMode === 'history' &&
          history.map((entry) => (
            <div key={entry.id} className="hp-item">
              <button className="hp-item-main" onClick={() => openUrl(entry.url)} title={entry.url}>
                <span className="hp-item-title">{entry.title}</span>
                <span className="hp-item-url">{entry.url}</span>
                <span className="hp-item-time">{new Date(entry.visitedAt).toLocaleString()}</span>
              </button>
              <button
                className="hp-item-delete"
                onClick={() => handleDeleteHistory(entry.id)}
                title="Remove from history"
              >
                &times;
              </button>
            </div>
          ))}

        {viewMode === 'bookmarks' &&
          bookmarks.map((bookmark) => (
            <div key={bookmark.id} className="hp-item">
              <button className="hp-item-main" onClick={() => openUrl(bookmark.url)} title={bookmark.url}>
                <span className="hp-item-title">{bookmark.title}</span>
                <span className="hp-item-url">{bookmark.url}</span>
              </button>
              <button
                className="hp-item-delete"
                onClick={() => handleRemoveBookmark(bookmark.id)}
                title="Remove bookmark"
              >
                &times;
              </button>
            </div>
          ))}
      </div>
    </div>
  );
}
