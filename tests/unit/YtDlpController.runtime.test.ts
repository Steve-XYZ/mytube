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

    expect(controller.resolveBinaryDir()).toBe(
      path.join(app.getAppPath(), 'bin', controller.getPlatformDir()),
    );
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

type DownloadProfile = { name: string; youtubeClient?: string; usePotProvider?: boolean };
type ProfileProbe = {
  potProviderServerHome: string | null;
  getDownloadProfiles: (url: string, options: { formatId?: string }) => DownloadProfile[];
  shouldRetryDownloadWithNextProfile: (url: string, error: string, profile: DownloadProfile) => boolean;
};

const profileProbe = (potHome: string | null) => {
  const p = Object.create(YtDlpController.prototype) as ProfileProbe;
  p.potProviderServerHome = potHome;
  return p;
};

const YT = 'https://www.youtube.com/watch?v=abc';

describe('YtDlpController download profile selection', () => {
  it('tries mweb+pot first and falls back to public for a best YouTube download', () => {
    const names = profileProbe('/pot').getDownloadProfiles(YT, {}).map((p) => p.name);
    expect(names).toEqual(['youtube-mweb-pot', 'youtube-public']);
  });

  it('uses only the public profile when a specific formatId is requested', () => {
    const names = profileProbe('/pot').getDownloadProfiles(YT, { formatId: '137' }).map((p) => p.name);
    expect(names).toEqual(['youtube-public']);
  });

  it('uses only the public profile when no PO-token provider is available', () => {
    const names = profileProbe(null).getDownloadProfiles(YT, {}).map((p) => p.name);
    expect(names).toEqual(['youtube-public']);
  });

  it('uses the default profile for non-YouTube URLs', () => {
    const names = profileProbe('/pot').getDownloadProfiles('https://vimeo.com/123', {}).map((p) => p.name);
    expect(names).toEqual(['default']);
  });

  it('retries past the pot profile on a recoverable format error', () => {
    const p = profileProbe('/pot');
    const potProfile = { name: 'youtube-mweb-pot', usePotProvider: true };
    expect(
      p.shouldRetryDownloadWithNextProfile(YT, 'ERROR: Requested format is not available', potProfile),
    ).toBe(true);
  });

  it('does not retry from the public profile', () => {
    const p = profileProbe('/pot');
    const publicProfile = { name: 'youtube-public' };
    expect(
      p.shouldRetryDownloadWithNextProfile(YT, 'ERROR: Requested format is not available', publicProfile),
    ).toBe(false);
  });

  it('does not retry for non-YouTube downloads', () => {
    const p = profileProbe('/pot');
    const potProfile = { name: 'youtube-mweb-pot', usePotProvider: true };
    expect(p.shouldRetryDownloadWithNextProfile('https://vimeo.com/1', 'whatever', potProfile)).toBe(false);
  });
});
