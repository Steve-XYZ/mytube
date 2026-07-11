import React, { useState, useEffect } from 'react';
import type { VideoInfo, VideoFormat } from '../../../shared/types';
import './FormatSelector.css';

interface FormatSelectorProps {
  url: string;
  onClose: () => void;
  onDownload: (url: string, options: { formatId?: string; audioOnly?: boolean; title?: string }) => void;
}

interface MediaInfoError {
  error: string;
}

export function FormatSelector({ url, onClose, onDownload }: FormatSelectorProps) {
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [formats, setFormats] = useState<VideoFormat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<string>('best');
  const hasSelectableVideoFormats = formats.some((format) => format.hasVideo);

  useEffect(() => {
    let cancelled = false;

    async function fetchInfo() {
      try {
        setLoading(true);
        setError(null);

        const videoInfo = await window.electronAPI.getMediaInfo(url);

        if (cancelled) return;

        if (!videoInfo) {
          setError('Could not fetch video information.');
          return;
        }

        if (typeof videoInfo === 'object' && 'error' in videoInfo) {
          setError((videoInfo as MediaInfoError).error || 'Could not fetch video information.');
          return;
        }

        const info = videoInfo as VideoInfo;
        setInfo(info);
        setFormats(info.formats);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to fetch video info');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchInfo();
    return () => {
      cancelled = true;
    };
  }, [url]);

  const handleDownload = () => {
    const isAudioOnly = selectedFormat === 'audio';
    const formatId = selectedFormat === 'best' || selectedFormat === 'audio' ? undefined : selectedFormat;

    onDownload(url, {
      formatId,
      audioOnly: isAudioOnly,
      title: info?.title,
    });
    onClose();
  };

  const formatDuration = (seconds?: number): string => {
    if (!seconds) return '';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="format-overlay" onClick={onClose}>
      <div className="format-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="format-header">
          <h3>Download Video</h3>
          <button className="format-close-btn" onClick={onClose}>
            &times;
          </button>
        </div>

        {loading && (
          <div className="format-loading">
            <div className="format-spinner" />
            <p>Fetching video information...</p>
          </div>
        )}

        {error && (
          <div className="format-error">
            <p>{error}</p>
            <button className="format-btn format-btn-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        )}

        {!loading && !error && info && (
          <>
            <div className="format-info">
              {info.thumbnail && <img className="format-thumbnail" src={info.thumbnail} alt="" />}
              <div className="format-meta">
                <p className="format-title">{info.title}</p>
                <p className="format-uploader">
                  {info.uploader}
                  {info.duration ? ` · ${formatDuration(info.duration)}` : ''}
                </p>
              </div>
            </div>

            <div className="format-options">
              <label className="format-label">Quality</label>
              <div className="format-list">
                <label className="format-option">
                  <input
                    type="radio"
                    name="format"
                    value="best"
                    checked={selectedFormat === 'best'}
                    onChange={() => setSelectedFormat('best')}
                  />
                  <span className="format-option-label">
                    {hasSelectableVideoFormats ? 'Best Available Quality' : 'Original Detected Quality'}
                  </span>
                </label>

                {formats
                  .filter((f) => f.hasVideo)
                  .map((f) => (
                    <label key={f.formatId} className="format-option">
                      <input
                        type="radio"
                        name="format"
                        value={f.formatId}
                        checked={selectedFormat === f.formatId}
                        onChange={() => setSelectedFormat(f.formatId)}
                      />
                      <span className="format-option-label">{f.label}</span>
                    </label>
                  ))}

                <label className="format-option format-option-audio">
                  <input
                    type="radio"
                    name="format"
                    value="audio"
                    checked={selectedFormat === 'audio'}
                    onChange={() => setSelectedFormat('audio')}
                  />
                  <span className="format-option-label">Audio Only (MP3)</span>
                </label>
              </div>
            </div>

            <div className="format-actions">
              <button className="format-btn format-btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button className="format-btn format-btn-primary" onClick={handleDownload}>
                Download
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
