import React, { useEffect, useState, useCallback } from 'react';
import './ImageGallery.css';

interface DetectedImage {
  url: string;
  alt: string;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
}

interface ImageGalleryProps {
  visible: boolean;
  webContentsId: number | null;
  pageUrl: string;
  onClose: () => void;
}

export function ImageGallery({ visible, webContentsId, pageUrl, onClose }: ImageGalleryProps) {
  const [images, setImages] = useState<DetectedImage[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);

  const scanImages = useCallback(async (targetWebContentsId: number) => {
    setLoading(true);
    setImages([]);
    setSelected(new Set());
    setProgress(null);

    try {
      const result = await window.electronAPI.scanPageImages(targetWebContentsId);
      setImages(result || []);
    } finally {
      setLoading(false);
    }
  }, []);

  // Scan for images when opened
  useEffect(() => {
    if (!visible || !webContentsId) return;

    void scanImages(webContentsId);
  }, [visible, webContentsId, scanImages]);

  // Listen for batch progress
  useEffect(() => {
    if (!downloading) return;
    const unsub = window.electronAPI.onImageBatchProgress((p: { completed: number; total: number }) => {
      setProgress(p);
      if (p.completed >= p.total) {
        setDownloading(false);
        setProgress(null);
      }
    });
    return unsub;
  }, [downloading]);

  const toggleSelect = useCallback((url: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) {
        next.delete(url);
      } else {
        next.add(url);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(images.map((img) => img.url)));
  }, [images]);

  const deselectAll = useCallback(() => {
    setSelected(new Set());
  }, []);

  const handleDownloadSelected = useCallback(async () => {
    if (selected.size === 0) return;

    setDownloading(true);
    setProgress({ completed: 0, total: selected.size });

    const batch = images.filter((img) => selected.has(img.url)).map((img) => ({ url: img.url, filename: undefined }));

    let referer: string | undefined;
    try {
      referer = new URL(pageUrl).origin;
    } catch {
      referer = undefined;
    }

    try {
      await window.electronAPI.downloadImagesBatch(batch, { referer });
    } catch (error) {
      console.error('Failed to download selected images:', error);
    }

    setDownloading(false);
    setProgress(null);
  }, [selected, images, pageUrl]);

  const handleDownloadSingle = useCallback(
    async (url: string) => {
      let referer: string | undefined;
      try {
        referer = new URL(pageUrl).origin;
      } catch {
        referer = undefined;
      }
      await window.electronAPI.downloadImage(url, referer);
    },
    [pageUrl],
  );

  if (!visible) return null;

  return (
    <div className="image-gallery-overlay" onClick={onClose}>
      <div className="image-gallery" onClick={(e) => e.stopPropagation()}>
        <div className="image-gallery-header">
          <h2>Page Images</h2>
          <button className="image-gallery-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 16 16">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="image-gallery-loading">
            <div className="spinner" />
            <span>Scanning page for images...</span>
          </div>
        ) : images.length === 0 ? (
          <div className="image-gallery-empty">
            <span>No images found on this page.</span>
          </div>
        ) : (
          <>
            <div className="image-gallery-toolbar">
              <span className="image-gallery-count">
                {images.length} image{images.length !== 1 ? 's' : ''} found
                {selected.size > 0 && ` — ${selected.size} selected`}
              </span>
              <div className="image-gallery-toolbar-actions">
                <button onClick={selectAll} className="image-gallery-btn-text">
                  Select All
                </button>
                <button onClick={deselectAll} className="image-gallery-btn-text" disabled={selected.size === 0}>
                  Deselect All
                </button>
                <button
                  onClick={handleDownloadSelected}
                  className="image-gallery-btn-download"
                  disabled={selected.size === 0 || downloading}
                >
                  {downloading
                    ? `Downloading ${progress?.completed || 0}/${progress?.total || 0}...`
                    : `Download (${selected.size})`}
                </button>
              </div>
            </div>

            <div className="image-gallery-grid">
              {images.map((img) => (
                <div
                  key={img.url}
                  className={`image-gallery-item ${selected.has(img.url) ? 'image-gallery-item-selected' : ''}`}
                  onClick={() => toggleSelect(img.url)}
                >
                  <div className="image-gallery-thumb">
                    <img
                      src={img.url}
                      alt={img.alt}
                      loading="lazy"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                    <div className="image-gallery-checkbox">
                      {selected.has(img.url) ? (
                        <svg width="20" height="20" viewBox="0 0 20 20">
                          <rect
                            x="1"
                            y="1"
                            width="18"
                            height="18"
                            rx="4"
                            fill="var(--accent-color)"
                            stroke="var(--accent-color)"
                            strokeWidth="1.5"
                          />
                          <path
                            d="M5 10l3 3 7-7"
                            stroke="white"
                            strokeWidth="2"
                            fill="none"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      ) : (
                        <svg width="20" height="20" viewBox="0 0 20 20">
                          <rect
                            x="1"
                            y="1"
                            width="18"
                            height="18"
                            rx="4"
                            fill="none"
                            stroke="var(--text-tertiary)"
                            strokeWidth="1.5"
                          />
                        </svg>
                      )}
                    </div>
                    <button
                      className="image-gallery-single-dl"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDownloadSingle(img.url);
                      }}
                      title="Download this image"
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16">
                        <path
                          d="M8 1v9M4 7l4 4 4-4M2 13h12"
                          stroke="currentColor"
                          strokeWidth="2"
                          fill="none"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  </div>
                  <div className="image-gallery-info">
                    {img.naturalWidth > 0 && img.naturalHeight > 0 && (
                      <span className="image-gallery-size">
                        {img.naturalWidth}x{img.naturalHeight}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
