import React, { useEffect, useState, useCallback } from 'react';
import type { AppSettings, GoogleAuthStatus } from '../../../shared/types';
import './Settings.css';

interface SettingsProps {
  visible: boolean;
  onClose: () => void;
}

type Section = 'general' | 'downloads' | 'browser' | 'account';

export function Settings({ visible, onClose }: SettingsProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [activeSection, setActiveSection] = useState<Section>('general');
  const [googleStatus, setGoogleStatus] = useState<GoogleAuthStatus | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    window.electronAPI.getAllSettings().then((s: AppSettings) => setSettings(s));
    window.electronAPI.getGoogleAuthStatus().then((status: GoogleAuthStatus) => setGoogleStatus(status));
  }, [visible]);

  const updateSetting = useCallback(async (key: string, value: unknown) => {
    await window.electronAPI.setSetting(key, value);
    // Re-fetch to keep in sync
    const updated = await window.electronAPI.getAllSettings();
    setSettings(updated as AppSettings);
  }, []);

  const handleSelectDirectory = useCallback(async () => {
    const dir = await window.electronAPI.selectDirectory();
    if (dir) {
      updateSetting('downloads.defaultDirectory', dir);
    }
  }, [updateSetting]);

  const handleGoogleSignIn = useCallback(async () => {
    setAuthBusy(true);
    try {
      const status = await window.electronAPI.signInWithGoogle();
      setGoogleStatus(status as GoogleAuthStatus);
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const handleGoogleSignOut = useCallback(async () => {
    setAuthBusy(true);
    try {
      const status = await window.electronAPI.signOutGoogle();
      setGoogleStatus(status as GoogleAuthStatus);
    } finally {
      setAuthBusy(false);
    }
  }, []);

  if (!visible) return null;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="settings-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 16 16">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="settings-body">
          <nav className="settings-nav">
            <button
              className={`settings-nav-item ${activeSection === 'general' ? 'active' : ''}`}
              onClick={() => setActiveSection('general')}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm6.32-2.76l-1.2-.7a5.08 5.08 0 0 0 0-1.08l1.2-.7a.5.5 0 0 0 .18-.64l-1-1.73a.5.5 0 0 0-.62-.22l-1.34.54a4.93 4.93 0 0 0-.94-.54L10.36.93A.5.5 0 0 0 9.88.5H7.88a.5.5 0 0 0-.48.43l-.24 1.44a4.93 4.93 0 0 0-.94.54L4.88 2.37a.5.5 0 0 0-.62.22l-1 1.73a.5.5 0 0 0 .18.64l1.2.7a5.08 5.08 0 0 0 0 1.08l-1.2.7a.5.5 0 0 0-.18.64l1 1.73a.5.5 0 0 0 .62.22l1.34-.54c.28.22.6.4.94.54l.24 1.44a.5.5 0 0 0 .48.43h2a.5.5 0 0 0 .48-.43l.24-1.44c.34-.14.66-.32.94-.54l1.34.54a.5.5 0 0 0 .62-.22l1-1.73a.5.5 0 0 0-.18-.64z" />
              </svg>
              General
            </button>
            <button
              className={`settings-nav-item ${activeSection === 'downloads' ? 'active' : ''}`}
              onClick={() => setActiveSection('downloads')}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path
                  d="M8 1v9M4 7l4 4 4-4M2 13h12"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Downloads
            </button>
            <button
              className={`settings-nav-item ${activeSection === 'browser' ? 'active' : ''}`}
              onClick={() => setActiveSection('browser')}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
                <path
                  d="M1.5 8h13M8 1.5c-2 2-2.5 4-2.5 6.5s.5 4.5 2.5 6.5c2-2 2.5-4 2.5-6.5S10 3.5 8 1.5z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  fill="none"
                />
              </svg>
              Browser
            </button>
            <button
              className={`settings-nav-item ${activeSection === 'account' ? 'active' : ''}`}
              onClick={() => setActiveSection('account')}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="5" r="2.8" stroke="currentColor" strokeWidth="1.4" />
                <path
                  d="M3 14c.7-2.5 2.4-3.8 5-3.8s4.3 1.3 5 3.8"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
              Account
            </button>
          </nav>

          <div className="settings-content">
            {settings && activeSection === 'general' && (
              <GeneralSettings settings={settings} onUpdate={updateSetting} />
            )}
            {settings && activeSection === 'downloads' && (
              <DownloadSettings
                settings={settings}
                onUpdate={updateSetting}
                onSelectDirectory={handleSelectDirectory}
              />
            )}
            {settings && activeSection === 'browser' && (
              <BrowserSettings settings={settings} onUpdate={updateSetting} />
            )}
            {activeSection === 'account' && (
              <AccountSettings
                status={googleStatus}
                busy={authBusy}
                onSignIn={handleGoogleSignIn}
                onSignOut={handleGoogleSignOut}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// === Section Components ===

function AccountSettings({
  status,
  busy,
  onSignIn,
  onSignOut,
}: {
  status: GoogleAuthStatus | null;
  busy: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  const signedIn = status?.signedIn === true;
  const configured = status?.configured === true;

  return (
    <div className="settings-section">
      <h3>Account</h3>

      <div className="settings-row settings-row-stack">
        <div className="settings-account">
          {signedIn && status?.picture ? (
            <img className="settings-account-avatar" src={status.picture} alt="" />
          ) : (
            <div className="settings-account-avatar settings-account-avatar-placeholder">
              <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="5" r="2.8" stroke="currentColor" strokeWidth="1.4" />
                <path
                  d="M3 14c.7-2.5 2.4-3.8 5-3.8s4.3 1.3 5 3.8"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          )}

          <div className="settings-label">
            <span>{signedIn ? status?.name || status?.email || 'Google account' : 'Google account'}</span>
            <span className="settings-description settings-description-wrap">
              {signedIn
                ? status?.youtubeChannelTitle
                  ? `YouTube channel: ${status.youtubeChannelTitle}`
                  : status?.email || 'Connected to Google'
                : configured
                  ? 'Connect with the system browser to enable Google and YouTube account access.'
                  : 'Set MYTUBE_GOOGLE_OAUTH_CLIENT_ID to enable Google sign-in.'}
            </span>
          </div>
        </div>

        <button className="settings-btn" onClick={signedIn ? onSignOut : onSignIn} disabled={busy || !configured}>
          {busy ? 'Working...' : signedIn ? 'Disconnect' : 'Connect'}
        </button>
      </div>

      {status?.error && <div className="settings-auth-error">{status.error}</div>}
    </div>
  );
}

function GeneralSettings({
  settings,
  onUpdate,
}: {
  settings: AppSettings;
  onUpdate: (key: string, value: unknown) => void;
}) {
  return (
    <div className="settings-section">
      <h3>General</h3>

      <div className="settings-row">
        <div className="settings-label">
          <span>Theme</span>
          <span className="settings-description">Choose the app appearance</span>
        </div>
        <select value={settings.general.theme} onChange={(e) => onUpdate('general.theme', e.target.value)}>
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </div>

      {/* The language selector is intentionally absent: general.language stays
          in the settings schema, but there is no i18n system yet, so showing a
          selector that does nothing would mislead users. */}
      <div className="settings-row">
        <div className="settings-label">
          <span>Start on boot</span>
          <span className="settings-description">Launch MyTube when you log in</span>
        </div>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={settings.general.startOnBoot}
            onChange={(e) => onUpdate('general.startOnBoot', e.target.checked)}
          />
          <span className="settings-toggle-slider" />
        </label>
      </div>
    </div>
  );
}

function DownloadSettings({
  settings,
  onUpdate,
  onSelectDirectory,
}: {
  settings: AppSettings;
  onUpdate: (key: string, value: unknown) => void;
  onSelectDirectory: () => void;
}) {
  return (
    <div className="settings-section">
      <h3>Downloads</h3>

      <div className="settings-row">
        <div className="settings-label">
          <span>Download directory</span>
          <span className="settings-description">{settings.downloads.defaultDirectory}</span>
        </div>
        <button className="settings-btn" onClick={onSelectDirectory}>
          Change...
        </button>
      </div>

      <div className="settings-row">
        <div className="settings-label">
          <span>Video quality</span>
          <span className="settings-description">Default quality for video downloads</span>
        </div>
        <select
          value={settings.downloads.videoQuality}
          onChange={(e) => onUpdate('downloads.videoQuality', e.target.value)}
        >
          <option value="best">Best available</option>
          <option value="1080p">1080p</option>
          <option value="720p">720p</option>
          <option value="480p">480p</option>
          <option value="audio-only">Audio only</option>
        </select>
      </div>

      <div className="settings-row">
        <div className="settings-label">
          <span>Video format</span>
          <span className="settings-description">Container format for videos</span>
        </div>
        <select
          value={settings.downloads.videoFormat}
          onChange={(e) => onUpdate('downloads.videoFormat', e.target.value)}
        >
          <option value="mp4">MP4</option>
          <option value="mkv">MKV</option>
          <option value="webm">WebM</option>
        </select>
      </div>

      <div className="settings-row">
        <div className="settings-label">
          <span>Audio format</span>
          <span className="settings-description">Format for audio-only downloads</span>
        </div>
        <select
          value={settings.downloads.audioFormat}
          onChange={(e) => onUpdate('downloads.audioFormat', e.target.value)}
        >
          <option value="mp3">MP3</option>
          <option value="m4a">M4A</option>
          <option value="opus">Opus</option>
        </select>
      </div>

      <div className="settings-row">
        <div className="settings-label">
          <span>Max concurrent downloads</span>
          <span className="settings-description">Number of simultaneous downloads</span>
        </div>
        <select
          value={settings.downloads.maxConcurrent}
          onChange={(e) => onUpdate('downloads.maxConcurrent', parseInt(e.target.value))}
        >
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
          <option value="5">5</option>
          <option value="10">10</option>
        </select>
      </div>

      <div className="settings-row">
        <div className="settings-label">
          <span>Speed limit</span>
          <span className="settings-description">0 means unlimited. Applies to new downloads.</span>
        </div>
        <input
          type="number"
          className="settings-input settings-input-number"
          min="0"
          step="128"
          value={settings.downloads.speedLimitKbps}
          onChange={(e) => onUpdate('downloads.speedLimitKbps', Math.max(0, parseInt(e.target.value, 10) || 0))}
        />
      </div>

      <div className="settings-row">
        <div className="settings-label">
          <span>Keep yt-dlp updated</span>
          <span className="settings-description">
            Automatically download yt-dlp updates so video sites keep working
          </span>
        </div>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={settings.downloads.autoUpdateYtDlp}
            onChange={(e) => onUpdate('downloads.autoUpdateYtDlp', e.target.checked)}
          />
          <span className="settings-toggle-slider" />
        </label>
      </div>
    </div>
  );
}

function BrowserSettings({
  settings,
  onUpdate,
}: {
  settings: AppSettings;
  onUpdate: (key: string, value: unknown) => void;
}) {
  return (
    <div className="settings-section">
      <h3>Browser</h3>

      <div className="settings-row">
        <div className="settings-label">
          <span>Homepage</span>
          <span className="settings-description">Page shown when opening a new tab</span>
        </div>
        <input
          type="text"
          className="settings-input"
          value={settings.browser.homepage}
          onChange={(e) => onUpdate('browser.homepage', e.target.value)}
          placeholder="mytube://newtab"
        />
      </div>

      <div className="settings-row">
        <div className="settings-label">
          <span>Search engine</span>
          <span className="settings-description">Used when typing in the URL bar</span>
        </div>
        <select
          value={settings.browser.searchEngine}
          onChange={(e) => onUpdate('browser.searchEngine', e.target.value)}
        >
          <option value="google">Google</option>
          <option value="duckduckgo">DuckDuckGo</option>
          <option value="bing">Bing</option>
        </select>
      </div>
    </div>
  );
}
