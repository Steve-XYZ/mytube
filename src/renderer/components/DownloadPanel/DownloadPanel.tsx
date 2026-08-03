import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { DownloadItem } from '../../../shared/types';
import './DownloadPanel.css';

interface DownloadPanelProps {
  visible: boolean;
  onClose: () => void;
}

const ACTIVE_STATUSES = new Set<DownloadItem['status']>(['resolving', 'downloading', 'retrying']);
const PENDING_STATUSES = new Set<DownloadItem['status']>([
  'resolving',
  'retrying',
  'queued',
  'paused',
  'needs-refresh',
]);

export function DownloadPanel({ visible, onClose }: DownloadPanelProps) {
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [viewMode, setViewMode] = useState<'queue' | 'library'>('queue');
  const [libraryQuery, setLibraryQuery] = useState('');
  const [libraryType, setLibraryType] = useState<'all' | DownloadItem['type']>('all');
  const [showBatchInput, setShowBatchInput] = useState(false);
  const [batchUrls, setBatchUrls] = useState('');
  const [batchError, setBatchError] = useState<string | null>(null);
  const [addingBatch, setAddingBatch] = useState(false);

  const refreshDownloads = useCallback(async () => {
    const list = await window.electronAPI.getDownloads();
    setDownloads(Array.isArray(list) ? (list as DownloadItem[]) : []);
  }, []);

  useEffect(() => {
    void window.electronAPI.getDownloads().then((list: unknown) => {
      setDownloads(Array.isArray(list) ? (list as DownloadItem[]) : []);
    });

    const updateItem = (download: unknown) => {
      const item = download as DownloadItem;
      setDownloads((previous) => {
        const exists = previous.some((candidate) => candidate.id === item.id);
        return exists
          ? previous.map((candidate) => (candidate.id === item.id ? item : candidate))
          : [...previous, item];
      });
    };

    const unsubProgress = window.electronAPI.onDownloadProgress(updateItem);
    const unsubComplete = window.electronAPI.onDownloadComplete(updateItem);
    const unsubError = window.electronAPI.onDownloadError(updateItem);

    return () => {
      unsubProgress();
      unsubComplete();
      unsubError();
    };
  }, []);

  const queueDownloads = useMemo(
    () =>
      downloads
        .filter((item) => item.status !== 'completed' && item.status !== 'cancelled')
        .sort((a, b) => {
          if (a.status === 'failed' && b.status !== 'failed') return 1;
          if (a.status !== 'failed' && b.status === 'failed') return -1;
          if (a.status === 'failed') return b.createdAt - a.createdAt;
          return (a.queueOrder ?? a.createdAt) - (b.queueOrder ?? b.createdAt);
        }),
    [downloads],
  );
  const completedDownloads = useMemo(
    () =>
      downloads
        .filter((item) => item.status === 'completed')
        .sort((a, b) => (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt)),
    [downloads],
  );
  const visibleDownloads = useMemo(() => {
    if (viewMode === 'queue') return queueDownloads;
    const query = libraryQuery.trim().toLowerCase();
    return completedDownloads.filter((item) => {
      const matchesType = libraryType === 'all' || item.type === libraryType;
      const matchesQuery =
        !query ||
        item.title.toLowerCase().includes(query) ||
        item.filename.toLowerCase().includes(query) ||
        item.url.toLowerCase().includes(query);
      return matchesType && matchesQuery;
    });
  }, [completedDownloads, libraryQuery, libraryType, queueDownloads, viewMode]);

  const activeCount = downloads.filter((item) => ACTIVE_STATUSES.has(item.status)).length;
  const waitingCount = downloads.filter((item) => item.status === 'queued').length;
  const pausedCount = downloads.filter((item) => item.status === 'paused' || item.status === 'needs-refresh').length;
  const waitingPositions = new Map(
    queueDownloads
      .filter((item) => item.status === 'queued')
      .map((item, index) => [item.id, item.queuePosition ?? index + 1]),
  );
  const hasPending = downloads.some((item) => PENDING_STATUSES.has(item.status));
  const hasTerminal = downloads.some(
    (item) => item.status === 'completed' || item.status === 'failed' || item.status === 'cancelled',
  );

  const handleRemove = async (id: string) => {
    await window.electronAPI.removeDownload(id);
    setDownloads((previous) => previous.filter((item) => item.id !== id));
  };

  const handleClearCompleted = async () => {
    await window.electronAPI.clearCompletedDownloads();
    setDownloads((previous) =>
      previous.filter((item) => item.status !== 'completed' && item.status !== 'failed' && item.status !== 'cancelled'),
    );
  };

  const handleMove = async (id: string, direction: 'up' | 'down' | 'top' | 'bottom') => {
    await window.electronAPI.moveDownload(id, direction);
    await refreshDownloads();
  };

  const handleAddBatch = async () => {
    const urls = Array.from(
      new Set(
        batchUrls
          .split(/\s+/)
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ).filter((value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    });

    if (urls.length === 0) {
      setBatchError('Paste at least one valid http or https link.');
      return;
    }

    setAddingBatch(true);
    setBatchError(null);
    const results = await Promise.allSettled(urls.map((url) => window.electronAPI.startDownload(url)));
    const failures = results.filter((result) => result.status === 'rejected').length;
    setAddingBatch(false);
    if (failures > 0) {
      setBatchError(`${urls.length - failures} added, ${failures} could not be added.`);
    } else {
      setBatchUrls('');
      setShowBatchInput(false);
    }
    await refreshDownloads();
  };

  if (!visible) return null;

  return (
    <aside className="download-panel" aria-label="Download manager">
      <div className="dp-header">
        <h3>
          {viewMode === 'queue' ? 'Downloads' : 'Library'}
          {viewMode === 'queue' && activeCount + waitingCount > 0 && (
            <span className="dp-badge" aria-label={`${activeCount + waitingCount} active or waiting`}>
              {activeCount + waitingCount}
            </span>
          )}
        </h3>
        <div className="dp-header-actions">
          {hasTerminal && (
            <button className="dp-clear-btn" onClick={() => void handleClearCompleted()} title="Clear history">
              Clear
            </button>
          )}
          <button className="dp-close-btn" onClick={onClose} aria-label="Close download manager">
            &times;
          </button>
        </div>
      </div>

      <div className="dp-tabs" role="tablist" aria-label="Download panel view">
        <button
          id="downloads-queue-tab"
          className={`dp-tab ${viewMode === 'queue' ? 'active' : ''}`}
          onClick={() => setViewMode('queue')}
          role="tab"
          aria-selected={viewMode === 'queue'}
          aria-controls="downloads-queue-panel"
        >
          Queue
        </button>
        <button
          id="downloads-library-tab"
          className={`dp-tab ${viewMode === 'library' ? 'active' : ''}`}
          onClick={() => setViewMode('library')}
          role="tab"
          aria-selected={viewMode === 'library'}
          aria-controls="downloads-library-panel"
        >
          Library
        </button>
      </div>

      {viewMode === 'queue' && (
        <div id="downloads-queue-panel" role="tabpanel" aria-labelledby="downloads-queue-tab">
          <div className="dp-summary" aria-live="polite">
            <span>{activeCount} downloading</span>
            <span>{waitingCount} waiting</span>
            <span>{pausedCount} paused</span>
          </div>
          <div className="dp-toolbar" aria-label="Queue controls">
            <button className="dp-toolbar-btn" onClick={() => setShowBatchInput((open) => !open)}>
              Add links
            </button>
            {activeCount + waitingCount > 0 && (
              <button className="dp-toolbar-btn" onClick={() => void window.electronAPI.pauseAllDownloads()}>
                Pause all
              </button>
            )}
            {pausedCount > 0 && (
              <button className="dp-toolbar-btn" onClick={() => void window.electronAPI.resumeAllDownloads()}>
                Resume all
              </button>
            )}
            {hasPending && (
              <button
                className="dp-toolbar-btn dp-toolbar-danger"
                onClick={() => void window.electronAPI.cancelPendingDownloads()}
              >
                Cancel pending
              </button>
            )}
          </div>
          {showBatchInput && (
            <div className="dp-batch-form">
              <label htmlFor="download-batch-urls">Paste one link per line</label>
              <textarea
                id="download-batch-urls"
                value={batchUrls}
                onChange={(event) => setBatchUrls(event.target.value)}
                placeholder={'https://example.com/video-1\nhttps://example.com/video-2'}
                rows={4}
              />
              {batchError && (
                <p className="dp-batch-error" role="alert">
                  {batchError}
                </p>
              )}
              <div className="dp-batch-actions">
                <button className="dp-toolbar-btn" onClick={() => setShowBatchInput(false)} disabled={addingBatch}>
                  Cancel
                </button>
                <button
                  className="dp-toolbar-btn dp-toolbar-primary"
                  onClick={() => void handleAddBatch()}
                  disabled={addingBatch}
                >
                  {addingBatch ? 'Adding…' : 'Add to queue'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {viewMode === 'library' && (
        <div id="downloads-library-panel" role="tabpanel" aria-labelledby="downloads-library-tab">
          <div className="dp-library-tools">
            <input
              className="dp-library-search"
              value={libraryQuery}
              onChange={(event) => setLibraryQuery(event.target.value)}
              placeholder="Search saved media"
              aria-label="Search saved media"
            />
            <select
              className="dp-library-filter"
              value={libraryType}
              onChange={(event) => setLibraryType(event.target.value as 'all' | DownloadItem['type'])}
              aria-label="Filter saved media by type"
            >
              <option value="all">All</option>
              <option value="video">Video</option>
              <option value="audio">Audio</option>
              <option value="image">Images</option>
            </select>
          </div>
        </div>
      )}

      <div className="dp-list">
        {visibleDownloads.length === 0 && viewMode === 'queue' && (
          <div className="dp-empty">
            <p>Your queue is empty</p>
            <p className="dp-empty-hint">Download from the current page or add several links at once.</p>
          </div>
        )}
        {visibleDownloads.length === 0 && viewMode === 'library' && (
          <div className="dp-empty">
            <p>No saved media</p>
            <p className="dp-empty-hint">Completed downloads appear here.</p>
          </div>
        )}

        {visibleDownloads.map((item) => {
          const queuePosition = waitingPositions.get(item.id);
          const boundedProgress = Math.max(0, Math.min(item.progress, 100));
          return (
            <article
              key={item.id}
              className={`dp-item dp-item-${item.status}`}
              aria-labelledby={`download-${item.id}-title`}
            >
              <div className="dp-item-info">
                {item.thumbnail && <img className="dp-item-thumb" src={item.thumbnail} alt="" />}
                <div className="dp-item-meta">
                  <p id={`download-${item.id}-title`} className="dp-item-title" title={item.title}>
                    {item.title}
                  </p>
                  <p className="dp-item-status">{formatStatus(item, queuePosition)}</p>
                </div>
              </div>

              {item.status === 'downloading' && (
                <div
                  className="dp-progress-bar"
                  role="progressbar"
                  aria-label={`Downloading ${item.title}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(boundedProgress)}
                >
                  <div className="dp-progress-fill" style={{ width: `${boundedProgress}%` }} />
                </div>
              )}

              <div className="dp-item-actions">
                {ACTIVE_STATUSES.has(item.status) && (
                  <>
                    <ActionButton
                      label={`Pause ${item.title}`}
                      onClick={() => void window.electronAPI.pauseDownload(item.id)}
                    >
                      ⏸
                    </ActionButton>
                    <ActionButton
                      label={`Cancel ${item.title}`}
                      onClick={() => void window.electronAPI.cancelDownload(item.id)}
                    >
                      ✕
                    </ActionButton>
                  </>
                )}
                {item.status === 'queued' && (
                  <>
                    <ActionButton label={`Move ${item.title} up`} onClick={() => void handleMove(item.id, 'up')}>
                      ↑
                    </ActionButton>
                    <ActionButton label={`Move ${item.title} down`} onClick={() => void handleMove(item.id, 'down')}>
                      ↓
                    </ActionButton>
                    <ActionButton
                      label={`Pause ${item.title}`}
                      onClick={() => void window.electronAPI.pauseDownload(item.id)}
                    >
                      ⏸
                    </ActionButton>
                    <ActionButton
                      label={`Cancel ${item.title}`}
                      onClick={() => void window.electronAPI.cancelDownload(item.id)}
                    >
                      ✕
                    </ActionButton>
                  </>
                )}
                {item.status === 'paused' && (
                  <>
                    <ActionButton
                      label={`Resume ${item.title}`}
                      onClick={() => void window.electronAPI.resumeDownload(item.id)}
                    >
                      ▶
                    </ActionButton>
                    <ActionButton
                      label={`Cancel ${item.title}`}
                      onClick={() => void window.electronAPI.cancelDownload(item.id)}
                    >
                      ✕
                    </ActionButton>
                  </>
                )}
                {item.status === 'needs-refresh' && (
                  <>
                    <ActionButton
                      label={`Refresh and retry ${item.title}`}
                      onClick={() => void window.electronAPI.retryDownload(item.id)}
                    >
                      ↻
                    </ActionButton>
                    <ActionButton
                      label={`Cancel ${item.title}`}
                      onClick={() => void window.electronAPI.cancelDownload(item.id)}
                    >
                      ✕
                    </ActionButton>
                  </>
                )}
                {item.status === 'completed' && (
                  <>
                    <ActionButton
                      label={`Open ${item.title}`}
                      onClick={() => void window.electronAPI.openDownloadFile(item.id)}
                    >
                      Open
                    </ActionButton>
                    <ActionButton
                      label={`Show ${item.title} in folder`}
                      onClick={() => void window.electronAPI.showInFolder(item.id)}
                    >
                      Folder
                    </ActionButton>
                    <ActionButton
                      label={`Remove ${item.title} from library`}
                      onClick={() => void handleRemove(item.id)}
                    >
                      ✕
                    </ActionButton>
                  </>
                )}
                {item.status === 'failed' && (
                  <>
                    <ActionButton
                      label={`Retry ${item.title}`}
                      onClick={() => void window.electronAPI.retryDownload(item.id)}
                    >
                      ↻
                    </ActionButton>
                    <ActionButton
                      label={`Remove failed download ${item.title}`}
                      onClick={() => void handleRemove(item.id)}
                    >
                      ✕
                    </ActionButton>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </aside>
  );
}

function ActionButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className="dp-action-btn" onClick={onClick} aria-label={label} title={label}>
      {children}
    </button>
  );
}

function formatStatus(item: DownloadItem, queuePosition?: number): React.ReactNode {
  if (item.status === 'resolving') return 'Preparing source…';
  if (item.status === 'retrying') return 'Trying browser fallback…';
  if (item.status === 'downloading') {
    return `${Math.round(item.progress)}%${item.speed ? ` · ${item.speed}` : ''}${item.eta ? ` · ETA ${item.eta}` : ''}`;
  }
  if (item.status === 'queued') return `Waiting${queuePosition ? ` · Position ${queuePosition}` : ''}`;
  if (item.status === 'paused') return `Paused · ${Math.round(item.progress)}%`;
  if (item.status === 'needs-refresh') return <span className="dp-status-failed">Source needs refresh</span>;
  if (item.status === 'completed') return <span className="dp-status-completed">Completed</span>;
  if (item.status === 'failed') return <span className="dp-status-failed">{item.error || 'Failed'}</span>;
  return 'Cancelled';
}
