import { afterEach, describe, expect, it } from 'vitest';
import * as path from 'path';
import { app } from 'electron';
import { YtDlpController } from '../../src/main/download/YtDlpController';

const originalIsPackaged = app.isPackaged;
const originalResourcesPath = process.resourcesPath;

afterEach(() => {
  Object.assign(app, { isPackaged: originalIsPackaged });
  Object.assign(process, { resourcesPath: originalResourcesPath });
});

type PathProbe = {
  resolveBinaryDir: () => string;
  resolveSharedResourceDir: () => string;
  getPlatformDir: () => string;
};

const probe = () => Object.create(YtDlpController.prototype) as PathProbe;

describe('YtDlpController packaged JavaScript runtime', () => {
  it('uses Electron as the bundled Node.js executable', () => {
    Object.assign(app, { isPackaged: true });

    const controller = Object.create(YtDlpController.prototype) as {
      resolveNodeRuntimePath: () => string | null;
    };

    expect(controller.resolveNodeRuntimePath()).toBe(process.execPath);
  });

  it('enables Electron Node.js mode for yt-dlp child processes', () => {
    Object.assign(app, { isPackaged: true });

    const controller = Object.create(YtDlpController.prototype) as {
      getYtDlpEnvironment: () => NodeJS.ProcessEnv;
    };

    expect(controller.getYtDlpEnvironment()).toMatchObject({
      ELECTRON_RUN_AS_NODE: '1',
    });
  });
});

describe('YtDlpController binary path resolution', () => {
  it('resolves per-os/arch binaries in development', () => {
    Object.assign(app, { isPackaged: false });
    const controller = probe();

    expect(controller.resolveBinaryDir()).toBe(path.join(app.getAppPath(), 'bin', controller.getPlatformDir()));
    expect(controller.getPlatformDir()).toBe(
      path.join(
        process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux',
        process.arch === 'arm64' ? 'arm64' : 'x64',
      ),
    );
  });

  it('resolves the shared resource dir in development', () => {
    Object.assign(app, { isPackaged: false });
    expect(probe().resolveSharedResourceDir()).toBe(path.join(app.getAppPath(), 'bin', 'shared'));
  });

  it('flattens binaries and shared resources into resources/bin when packaged', () => {
    Object.assign(app, { isPackaged: true });
    Object.assign(process, { resourcesPath: '/packaged/Resources' });
    const controller = probe();

    expect(controller.resolveBinaryDir()).toBe(path.join('/packaged/Resources', 'bin'));
    expect(controller.resolveSharedResourceDir()).toBe(path.join('/packaged/Resources', 'bin'));
  });
});

type DownloadProfile = {
  name: string;
  youtubeClient?: string;
  usePotProvider?: boolean;
  useBrowserHeaders?: boolean;
};
type ProfileProbe = {
  potProviderServerHome: string | null;
  getDownloadProfiles: (url: string, options: { formatId?: string }) => DownloadProfile[];
  getUserFacingExtractionError: (err: unknown, url: string) => string;
  getRefererForUrl: (url: string) => string | null;
  getSafeArgsForLog: (args: string[]) => string;
  isAllowedDownloadHeader: (headerName: string) => boolean;
  ytdlpVersion: string | null;
  shouldRetryDownloadWithNextProfile: (url: string, error: string, profile: DownloadProfile) => boolean;
};

const profileProbe = (potHome: string | null) => {
  const p = Object.create(YtDlpController.prototype) as ProfileProbe;
  p.potProviderServerHome = potHome;
  p.ytdlpVersion = '2026.01.01';
  return p;
};

const YT = 'https://www.youtube.com/watch?v=abc';

describe('YtDlpController download profile selection', () => {
  it('tries mweb+pot first and falls back to public for a best YouTube download', () => {
    const names = profileProbe('/pot')
      .getDownloadProfiles(YT, {})
      .map((p) => p.name);
    expect(names).toEqual(['youtube-mweb-pot', 'youtube-public']);
  });

  it('uses only the public profile when a specific formatId is requested', () => {
    const names = profileProbe('/pot')
      .getDownloadProfiles(YT, { formatId: '137' })
      .map((p) => p.name);
    expect(names).toEqual(['youtube-public']);
  });

  it('uses only the public profile when no PO-token provider is available', () => {
    const names = profileProbe(null)
      .getDownloadProfiles(YT, {})
      .map((p) => p.name);
    expect(names).toEqual(['youtube-public']);
  });

  it('uses the default profile for non-YouTube URLs', () => {
    const names = profileProbe('/pot')
      .getDownloadProfiles('https://vimeo.com/123', {})
      .map((p) => p.name);
    expect(names).toEqual(['browser-context']);
  });

  it('uses browser headers for non-YouTube URLs', () => {
    const profiles = profileProbe('/pot').getDownloadProfiles('https://vimeo.com/123', {});
    expect(profiles[0]).toMatchObject({ name: 'browser-context', useBrowserHeaders: true });
  });

  it('retries past the pot profile on a recoverable format error', () => {
    const p = profileProbe('/pot');
    const potProfile = { name: 'youtube-mweb-pot', usePotProvider: true };
    expect(p.shouldRetryDownloadWithNextProfile(YT, 'ERROR: Requested format is not available', potProfile)).toBe(true);
  });

  it('does not retry from the public profile', () => {
    const p = profileProbe('/pot');
    const publicProfile = { name: 'youtube-public' };
    expect(p.shouldRetryDownloadWithNextProfile(YT, 'ERROR: Requested format is not available', publicProfile)).toBe(
      false,
    );
  });

  it('does not retry for non-YouTube downloads', () => {
    const p = profileProbe('/pot');
    const potProfile = { name: 'youtube-mweb-pot', usePotProvider: true };
    expect(p.shouldRetryDownloadWithNextProfile('https://vimeo.com/1', 'whatever', potProfile)).toBe(false);
  });
});

describe('YtDlpController user-facing extraction errors', () => {
  it('explains non-media Instagram pages instead of surfacing extractor internals', () => {
    const message = profileProbe('/pot').getUserFacingExtractionError(
      new Error('[instagram:user] explore: Unable to extract data; please report this issue'),
      'https://www.instagram.com/explore/',
    );

    expect(message).toBe('Open a specific Instagram post, reel, story, or video first.');
  });

  it('classifies extractor data failures as stale or changed site support', () => {
    const message = profileProbe('/pot').getUserFacingExtractionError(
      new Error('[instagram] abc: Unable to extract data; please report this issue'),
      'https://www.instagram.com/reel/abc/',
    );

    expect(message).toContain('Instagram changed its page format');
    expect(message).toContain('Bundled yt-dlp version: 2026.01.01');
  });

  it('classifies anti-bot failures with an actionable retry path', () => {
    const message = profileProbe('/pot').getUserFacingExtractionError(
      new Error('HTTP Error 403: Forbidden'),
      'https://www.tiktok.com/@user/video/123',
    );

    expect(message).toContain('blocked the downloader');
    expect(message).toContain('complete any challenge');
  });

  it('uses the site origin as referer for non-YouTube URLs', () => {
    expect(profileProbe('/pot').getRefererForUrl('https://www.instagram.com/reel/abc/')).toBe(
      'https://www.instagram.com/',
    );
  });

  it('redacts signed URLs and cookie files in command logs', () => {
    const message = profileProbe('/pot').getSafeArgsForLog([
      '--cookies',
      '/tmp/yt-dlp-cookies-secret.txt',
      'Referer:https://example.com/watch?session=secret',
      'https://cdn.example.com/video.m3u8?token=secret',
    ]);

    expect(message).toContain('--cookies [cookies-file]');
    expect(message).toContain('Referer:https://example.com/watch?[redacted]');
    expect(message).toContain('https://cdn.example.com/video.m3u8?[redacted]');
    expect(message).not.toContain('secret');
  });

  it('only allows safe request headers to be replayed through yt-dlp args', () => {
    const p = profileProbe('/pot');
    expect(p.isAllowedDownloadHeader('Referer')).toBe(true);
    expect(p.isAllowedDownloadHeader('Cookie')).toBe(false);
    expect(p.isAllowedDownloadHeader('Authorization')).toBe(false);
  });
});
