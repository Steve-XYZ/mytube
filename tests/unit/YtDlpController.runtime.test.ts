import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { app } from 'electron';
import { probeYtDlpVersion, YtDlpController } from '../../src/main/download/YtDlpController';

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

describe('YtDlpController version probing', () => {
  it('probes a binary version asynchronously', async () => {
    let settled = false;
    const versionPromise = probeYtDlpVersion(process.execPath, process.env).then((version) => {
      settled = true;
      return version;
    });

    expect(settled).toBe(false);
    await expect(versionPromise).resolves.toBe(process.version);
  });
});

describe('YtDlpController metadata cancellation', () => {
  it('accepts per-request cancellation options', () => {
    expect(YtDlpController.prototype.getVideoInfo.length).toBe(2);
  });

  it('terminates an in-flight metadata process when aborted', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-cancel-test-'));
    const binaryPath = path.join(tempDir, 'yt-dlp');
    fs.writeFileSync(binaryPath, "#!/bin/sh\ntrap 'exit 0' TERM\nwhile :; do sleep 1; done\n", { mode: 0o755 });
    const controller = Object.create(YtDlpController.prototype) as {
      ytdlpPath: string;
      ffmpegPath: string;
      execYtDlp(
        args: string[],
        sourceUrl: string | undefined,
        profile: { name: string },
        options: { signal: AbortSignal; maxRuntimeMs: number; idleTimeoutMs: number },
      ): Promise<string>;
    };
    controller.ytdlpPath = binaryPath;
    controller.ffmpegPath = tempDir;
    const abortController = new AbortController();

    try {
      const request = controller.execYtDlp(
        [],
        undefined,
        { name: 'test' },
        {
          signal: abortController.signal,
          maxRuntimeMs: 5_000,
          idleTimeoutMs: 5_000,
        },
      );
      setTimeout(() => abortController.abort(), 20);

      await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

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
  impersonate?: string;
  youtubeClient?: string;
  usePotProvider?: boolean;
  useBrowserHeaders?: boolean;
};
type ProfileProbe = {
  potProviderServerHome: string | null;
  getDownloadProfiles: (url: string, options: { formatId?: string }) => DownloadProfile[];
  buildDownloadArgs: (
    url: string,
    options: {
      outputDir: string;
      videoQuality?: 'best' | '1080p' | '720p' | '480p' | 'audio-only';
      videoFormat?: 'mp4' | 'mkv' | 'webm';
      audioFormat?: 'mp3' | 'm4a' | 'opus';
      speedLimitKbps?: number;
      audioOnly?: boolean;
    },
  ) => string[];
  getUserFacingExtractionError: (err: unknown, url: string) => string;
  getRefererForUrl: (url: string) => string | null;
  getSafeArgsForLog: (args: string[]) => string;
  redactSensitiveTextForLog: (text: string) => string;
  isAllowedDownloadHeader: (headerName: string) => boolean;
  ytdlpVersion: string | null;
  shouldRetryDownloadWithNextProfile: (url: string, error: string, profile: DownloadProfile) => boolean;
  withCommonArgs: (
    args: string[],
    sourceUrl: string | undefined,
    profile: DownloadProfile,
  ) => Promise<{ args: string[]; cleanup: () => void }>;
  ffmpegPath: string;
  nodeRuntimePath: string | null;
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

  it('keeps browser impersonation as a fallback profile for non-YouTube URLs', () => {
    const names = profileProbe('/pot')
      .getDownloadProfiles('https://vimeo.com/123', {})
      .map((p) => p.name);
    expect(names).toEqual(['browser-context', 'browser-impersonated']);
  });

  it('uses browser headers for non-YouTube URLs', () => {
    const profiles = profileProbe('/pot').getDownloadProfiles('https://vimeo.com/123', {});
    expect(profiles[0]).toMatchObject({ name: 'browser-context', useBrowserHeaders: true });
  });

  it('passes the impersonation target to yt-dlp only in the fallback profile', async () => {
    const p = profileProbe(null);
    p.ffmpegPath = '/ffmpeg';
    p.nodeRuntimePath = null;

    const { args, cleanup } = await p.withCommonArgs([], undefined, {
      name: 'browser-impersonated',
      impersonate: 'chrome',
    });

    expect(args).toContain('--impersonate');
    expect(args).toContain('chrome');
    cleanup();
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

  it('retries anti-bot failures once with browser impersonation for non-YouTube downloads', () => {
    const p = profileProbe('/pot');
    const browserProfile = { name: 'browser-context' };
    expect(
      p.shouldRetryDownloadWithNextProfile('https://vimeo.com/1', 'HTTP Error 403: Forbidden', browserProfile),
    ).toBe(true);
    expect(p.shouldRetryDownloadWithNextProfile('https://vimeo.com/1', 'Unsupported URL', browserProfile)).toBe(false);
  });
});

describe('YtDlpController download argument building', () => {
  it('applies quality, merge format, and speed limit preferences', () => {
    const args = profileProbe(null).buildDownloadArgs('https://example.com/video', {
      outputDir: '/downloads',
      videoQuality: '720p',
      videoFormat: 'mkv',
      speedLimitKbps: 2048,
    });

    expect(args).toContain('--merge-output-format');
    expect(args).toContain('mkv');
    expect(args).toContain('bv*[height<=720]+ba/b[height<=720]');
    expect(args).toContain('--limit-rate');
    expect(args).toContain('2048K');
  });

  it('uses the configured audio format for audio-only downloads', () => {
    const args = profileProbe(null).buildDownloadArgs('https://example.com/video', {
      outputDir: '/downloads',
      videoQuality: 'audio-only',
      audioFormat: 'm4a',
    });

    expect(args).toContain('-x');
    expect(args).toContain('--audio-format');
    expect(args).toContain('m4a');
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

  it('redacts signed URLs and cookie files in yt-dlp stderr text', () => {
    const message = profileProbe('/pot').redactSensitiveTextForLog(
      'ERROR: unable to download https://cdn.example.com/video.m3u8?token=secret using /tmp/yt-dlp-cookies-secret.txt',
    );

    expect(message).toContain('https://cdn.example.com/video.m3u8?[redacted]');
    expect(message).toContain('[cookies-file]');
    expect(message).not.toContain('secret');
  });

  it('only allows safe request headers to be replayed through yt-dlp args', () => {
    const p = profileProbe('/pot');
    expect(p.isAllowedDownloadHeader('Referer')).toBe(true);
    expect(p.isAllowedDownloadHeader('Cookie')).toBe(false);
    expect(p.isAllowedDownloadHeader('Authorization')).toBe(false);
  });
});
