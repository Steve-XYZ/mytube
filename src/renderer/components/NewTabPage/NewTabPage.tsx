import React, { useState, useCallback, useRef, useEffect } from 'react';
import './NewTabPage.css';

interface QuickLink {
  name: string;
  url: string;
  icon: string;
  color: string;
}

const QUICK_LINKS: QuickLink[] = [
  { name: 'YouTube', url: 'https://www.youtube.com', icon: '▶', color: '#FF0000' },
  { name: 'Google', url: 'https://www.google.com', icon: 'G', color: '#4285F4' },
  { name: 'Twitter', url: 'https://x.com', icon: '𝕏', color: '#1DA1F2' },
  { name: 'Reddit', url: 'https://www.reddit.com', icon: 'R', color: '#FF4500' },
  { name: 'Instagram', url: 'https://www.instagram.com', icon: '◎', color: '#E4405F' },
  { name: 'TikTok', url: 'https://www.tiktok.com', icon: '♪', color: '#000000' },
  { name: 'Vimeo', url: 'https://vimeo.com', icon: '▷', color: '#1AB7EA' },
  { name: 'GitHub', url: 'https://github.com', icon: '⟁', color: '#6e40c9' },
];

interface NewTabPageProps {
  onNavigate: (url: string) => void;
}

export function NewTabPage({ onNavigate }: NewTabPageProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (searchQuery.trim()) {
        onNavigate(searchQuery.trim());
      }
    },
    [searchQuery, onNavigate],
  );

  return (
    <div className="new-tab-page">
      <div className="ntp-content">
        <h1 className="ntp-logo">MyTube</h1>
        <p className="ntp-subtitle">Browse, discover, download</p>

        <form className="ntp-search-form" onSubmit={handleSearch}>
          <div className="ntp-search-bar">
            <svg className="ntp-search-icon" width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
              <path d="M12.5 11h-.79l-.28-.27A6.471 6.471 0 0 0 13 6.5 6.5 6.5 0 1 0 6.5 13c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L17.49 16l-4.99-5zm-6 0C4.01 11 2 8.99 2 6.5S4.01 2 6.5 2 11 4.01 11 6.5 8.99 11 6.5 11z" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              className="ntp-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search Google or enter URL"
              spellCheck={false}
            />
          </div>
        </form>

        <div className="ntp-quick-links">
          {QUICK_LINKS.map((link) => (
            <button key={link.url} className="ntp-link" onClick={() => onNavigate(link.url)} title={link.name}>
              <div className="ntp-link-icon" style={{ backgroundColor: link.color }}>
                {link.icon}
              </div>
              <span className="ntp-link-name">{link.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
