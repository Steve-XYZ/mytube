import React, { useState, useEffect, useCallback } from 'react';
import type { DownloadItem } from '../../../shared/types';
import './DownloadPanel.css';

interface DownloadPanelProps {
  visible: boolean;
  onClose: () => void;
}

export function DownloadPanel({ visible, onClose }: DownloadPanelProps) {
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);

  // Load downloads and listen for updates
  useEffect(() => {
    window.electronAPI.getDownloads().then((list: any) => {
      setDownloads(list as DownloadItem[]);
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

  if (!visible) return null;

  return (
    <div className="download-panel">
      <div className="dp-header">
        <h3>
          Downloads
          {activeCount > 0 && <span className="dp-badge">{activeCount}</span>}
        </h3>
        <div className="dp-header-actions">
          {downloads.some((d) => d.status === 'completed' || d.status === 'failed') && (
            <button className="dp-clear-btn" onClick={handleClearCompleted} title="Clear completed">
              Clear
            </button>
          )}
          <button className="dp-close-btn" onClick={onClose}>&times;</button>
        </div>
      </div>

      <div className="dp-list">
        {downloads.length === 0 && (
          <div className="dp-empty">
            <p>No downloads yet</p>
            <p className="dp-empty-hint">Use the download button or right-click to start downloading</p>
          </div>
        )}

        {downloads.map((item) => (
          <div key={item.id} className={`dp-item dp-item-${item.status}`}>
            <div className="dp-item-info">
              {item.thumbnail && (
                <img className="dp-item-thumb" src={item.thumbnail} alt="" />
              )}
              <div className="dp-item-meta">
                <p className="dp-item-title" title={item.title}>{item.title}</p>
                <p className="dp-item-status">
                  {item.status === 'downloading' && (
                    <>
                      {Math.round(item.progress)}%
                      {item.speed && ` · ${item.speed}`}
                      {item.eta && ` · ETA ${item.eta}`}
                    </>
                  )}
                  {item.status === 'queued' && 'Waiting...'}
                  {item.status === 'paused' && `Paused · ${Math.round(item.progress)}%`}
                  {item.status === 'completed' && (
                    <span className="dp-status-completed">Completed</span>
                  )}
                  {item.status === 'failed' && (
                    <span className="dp-status-failed">{item.error || 'Failed'}</span>
                  )}
                </p>
              </div>
            </div>

            {item.status === 'downloading' && (
              <div className="dp-progress-bar">
                <div
                  className="dp-progress-fill"
                  style={{ width: `${Math.min(item.progress, 100)}%` }}
                />
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
                <button className="dp-action-btn" onClick={() => handleRemove(item.id)} title="Remove">
                  ✕
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
