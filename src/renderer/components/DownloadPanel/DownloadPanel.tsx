import React, { useState, useEffect, useCallback } from 'react';
import type { DownloadItem } from '../../../shared/types';
import './DownloadPanel.css';

interface DownloadPanelProps {
  visible: boolean;
  onClose: () => void;
}

export function DownloadPanel({ visible, onClose }: DownloadPanelProps) {
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [viewMode, setViewMode] = useState<'queue' | 'library'>('queue');
  const [libraryQuery, setLibraryQuery] = useState('');
  const [libraryType, setLibraryType] = useState<'all' | DownloadItem['type']>('all');

  // Load downloads and listen for updates
  useEffect(() => {
    window.electronAPI.getDownloads().then((list: unknown) => {
      setDownloads(Array.isArray(list) ? (list as DownloadItem[]) : []);
    });

    const unsubProgress = window.electronAPI.onDownloadProgress((d: unknown) => {
      const item = d as DownloadItem;
      setDownloads((prev) => {
        const exists = prev.find((p) => p.id === item.id);
        if (exists) {
          return prev.map((p) => (p.id === item.id ? item : p));
        }
        return [item, ...prev];
      });
    });

    const unsubComplete = window.electronAPI.onDownloadComplete((d: unknown) => {
      const item = d as DownloadItem;
      setDownloads((prev) => prev.map((p) => (p.id === item.id ? item : p)));
    });

    const unsubError = window.electronAPI.onDownloadError((d: unknown) => {
      const item = d as DownloadItem;
      setDownloads((prev) => prev.map((p) => (p.id === item.id ? item : p)));
    });

    return () => {
      unsubProgress();
      unsubComplete();
      unsubError();
    };
  }, []);

  const handlePause = useCallback((id: string) => {
    window.electronAPI.pauseDownload(id);
  }, []);

  const handleResume = useCallback((id: string) => {
    window.electronAPI.resumeDownload(id);
  }, []);

  const handleCancel = useCallback((id: string) => {
    window.electronAPI.cancelDownload(id);
  }, []);

  const handleRetry = useCallback((id: string) => {
    window.electronAPI.retryDownload(id);
  }, []);

  const handleOpenFile = useCallback((id: string) => {
    window.electronAPI.openDownloadFile(id);
  }, []);

  const handleShowInFolder = useCallback((id: string) => {
    window.electronAPI.showInFolder(id);
  }, []);

  const handleRemove = useCallback((id: string) => {
    window.electronAPI.removeDownload(id);
    setDownloads((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const handleClearCompleted = useCallback(() => {
    window.electronAPI.clearCompletedDownloads();
    setDownloads((prev) => prev.filter((d) => d.status !== 'completed' && d.status !== 'failed'));
  }, []);

  const activeCount = downloads.filter((d) => d.status === 'downloading' || d.status === 'queued').length;
  const completedDownloads = downloads.filter((d) => d.status === 'completed');
  const visibleDownloads =
    viewMode === 'queue'
      ? downloads
      : completedDownloads.filter((item) => {
          const matchesType = libraryType === 'all' || item.type === libraryType;
          const query = libraryQuery.trim().toLowerCase();
          const matchesQuery =
            !query ||
            item.title.toLowerCase().includes(query) ||
            item.filename.toLowerCase().includes(query) ||
            item.url.toLowerCase().includes(query);
          return matchesType && matchesQuery;
        });

  if (!visible) return null;

  return (
    <div className="download-panel">
      <div className="dp-header">
        <h3>
          {viewMode === 'queue' ? 'Downloads' : 'Library'}
          {viewMode === 'queue' && activeCount > 0 && <span className="dp-badge">{activeCount}</span>}
        </h3>
        <div className="dp-header-actions">
          {downloads.some((d) => d.status === 'completed' || d.status === 'failed') && (
            <button className="dp-clear-btn" onClick={handleClearCompleted} title="Clear completed">
              Clear
            </button>
          )}
          <button className="dp-close-btn" onClick={onClose}>
            &times;
          </button>
        </div>
      </div>

      <div className="dp-tabs" role="tablist" aria-label="Download panel view">
        <button
          className={`dp-tab ${viewMode === 'queue' ? 'active' : ''}`}
          onClick={() => setViewMode('queue')}
          role="tab"
          aria-selected={viewMode === 'queue'}
        >
          Queue
        </button>
        <button
          className={`dp-tab ${viewMode === 'library' ? 'active' : ''}`}
          onClick={() => setViewMode('library')}
          role="tab"
          aria-selected={viewMode === 'library'}
        >
          Library
        </button>
      </div>

      {viewMode === 'library' && (
        <div className="dp-library-tools">
          <input
            className="dp-library-search"
            value={libraryQuery}
            onChange={(e) => setLibraryQuery(e.target.value)}
            placeholder="Search saved media"
          />
          <select
            className="dp-library-filter"
            value={libraryType}
            onChange={(e) => setLibraryType(e.target.value as 'all' | DownloadItem['type'])}
          >
            <option value="all">All</option>
            <option value="video">Video</option>
            <option value="audio">Audio</option>
            <option value="image">Images</option>
          </select>
        </div>
      )}

      <div className="dp-list">
        {visibleDownloads.length === 0 && viewMode === 'queue' && (
          <div className="dp-empty">
            <p>No downloads yet</p>
            <p className="dp-empty-hint">Use the download button or right-click to start downloading</p>
          </div>
        )}

        {visibleDownloads.length === 0 && viewMode === 'library' && (
          <div className="dp-empty">
            <p>No saved media</p>
            <p className="dp-empty-hint">Completed downloads appear here</p>
          </div>
        )}

        {visibleDownloads.map((item) => (
          <div key={item.id} className={`dp-item dp-item-${item.status}`}>
            <div className="dp-item-info">
              {item.thumbnail && <img className="dp-item-thumb" src={item.thumbnail} alt="" />}
              <div className="dp-item-meta">
                <p className="dp-item-title" title={item.title}>
                  {item.title}
                </p>
                <p className="dp-item-status">
                  {item.status === 'downloading' && (
                    <>
                      {Math.round(item.progress)}%{item.speed && ` · ${item.speed}`}
                      {item.eta && ` · ETA ${item.eta}`}
                    </>
                  )}
                  {item.status === 'queued' && 'Waiting...'}
                  {item.status === 'paused' && `Paused · ${Math.round(item.progress)}%`}
                  {item.status === 'completed' && <span className="dp-status-completed">Completed</span>}
                  {item.status === 'failed' && <span className="dp-status-failed">{item.error || 'Failed'}</span>}
                </p>
              </div>
            </div>

            {item.status === 'downloading' && (
              <div className="dp-progress-bar">
                <div className="dp-progress-fill" style={{ width: `${Math.min(item.progress, 100)}%` }} />
              </div>
            )}

            <div className="dp-item-actions">
              {item.status === 'downloading' && (
                <>
                  <button className="dp-action-btn" onClick={() => handlePause(item.id)} title="Pause">
                    ⏸
                  </button>
                  <button className="dp-action-btn" onClick={() => handleCancel(item.id)} title="Cancel">
                    ✕
                  </button>
                </>
              )}
              {item.status === 'paused' && (
                <>
                  <button className="dp-action-btn" onClick={() => handleResume(item.id)} title="Resume">
                    ▶
                  </button>
                  <button className="dp-action-btn" onClick={() => handleCancel(item.id)} title="Cancel">
                    ✕
                  </button>
                </>
              )}
              {item.status === 'queued' && (
                <button className="dp-action-btn" onClick={() => handleCancel(item.id)} title="Cancel">
                  ✕
                </button>
              )}
              {item.status === 'completed' && (
                <>
                  <button className="dp-action-btn" onClick={() => handleOpenFile(item.id)} title="Open file">
                    📂
                  </button>
                  <button className="dp-action-btn" onClick={() => handleShowInFolder(item.id)} title="Show in folder">
                    📁
                  </button>
                  <button className="dp-action-btn" onClick={() => handleRemove(item.id)} title="Remove from list">
                    ✕
                  </button>
                </>
              )}
              {item.status === 'failed' && (
                <>
                  {item.error !== 'Cancelled' && (
                    <button className="dp-action-btn" onClick={() => handleRetry(item.id)} title="Retry">
                      ↻
                    </button>
                  )}
                  <button className="dp-action-btn" onClick={() => handleRemove(item.id)} title="Remove">
                    ✕
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
