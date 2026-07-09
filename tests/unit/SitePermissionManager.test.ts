import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ipcMain } from 'electron';
import type { Session, WebContents } from 'electron';
import {
  SitePermissionManager,
  classifyPermission,
  permissionOriginOf,
  parseSitePermissionStore,
} from '../../src/main/window/SitePermissionManager';

const SHELL_ID = 999;

type RequestHandler = (
  webContents: WebContents | null,
  permission: string,
  callback: (allow: boolean) => void,
  details: { requestingUrl?: string },
) => void;
type CheckHandler = (webContents: WebContents | null, permission: string, requestingOrigin: string) => boolean;

function makeFakeSession() {
  const holder: { request: RequestHandler | null; check: CheckHandler | null } = { request: null, check: null };
  const session = {
    setPermissionRequestHandler: vi.fn((handler: RequestHandler | null) => {
      holder.request = handler;
    }),
    setPermissionCheckHandler: vi.fn((handler: CheckHandler | null) => {
      holder.check = handler;
    }),
  } as unknown as Session;
  return { session, holder };
}

function fakeWebContents(id: number, url = 'https://site.test/page'): WebContents {
  return { id, getURL: () => url } as unknown as WebContents;
}

function respondFromShell(id: string, allow: boolean): void {
  const handlers = (ipcMain as unknown as { _handlers: Map<string, (...args: unknown[]) => unknown> })._handlers;
  const handler = handlers.get('permission:respond');
  if (!handler) throw new Error('permission:respond handler not registered');
  handler(null, id, allow);
}

describe('SitePermissionManager', () => {
  let dir: string;
  let storePath: string;
  let sent: Array<{ channel: string; payload: { id: string; origin: string; permission: string } }>;
  let manager: SitePermissionManager;
  let holder: { request: RequestHandler | null; check: CheckHandler | null };

  function createManager(promptTimeoutMs?: number) {
    const fake = makeFakeSession();
    holder = fake.holder;
    manager = new SitePermissionManager({
      storePath,
      shellSender: {
        send: (channel: string, payload: { id: string; origin: string; permission: string }) =>
          sent.push({ channel, payload }),
      },
      shellWebContentsId: SHELL_ID,
      session: fake.session,
      promptTimeoutMs,
    });
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-perms-test-'));
    storePath = path.join(dir, 'site-permissions.json');
    sent = [];
  });

  afterEach(() => {
    manager?.destroy();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('auto-allows playback permissions without prompting', () => {
    createManager();
    const callback = vi.fn();
    holder.request!(fakeWebContents(1), 'fullscreen', callback, {});
    expect(callback).toHaveBeenCalledWith(true);
    expect(sent).toHaveLength(0);
  });

  it('denies unlisted permissions without prompting', () => {
    createManager();
    const callback = vi.fn();
    holder.request!(fakeWebContents(1), 'geolocation', callback, {});
    expect(callback).toHaveBeenCalledWith(false);
    expect(sent).toHaveLength(0);
  });

  it('prompts for sensitive permissions and remembers an allow', () => {
    createManager();
    const callback = vi.fn();
    holder.request!(fakeWebContents(1), 'notifications', callback, { requestingUrl: 'https://site.test/a' });

    expect(callback).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    expect(sent[0].payload).toMatchObject({ origin: 'https://site.test', permission: 'notifications' });

    respondFromShell(sent[0].payload.id, true);
    expect(callback).toHaveBeenCalledWith(true);

    // Same origin asks again: no new prompt, stored decision answers.
    const second = vi.fn();
    holder.request!(fakeWebContents(1), 'notifications', second, { requestingUrl: 'https://site.test/b' });
    expect(second).toHaveBeenCalledWith(true);
    expect(sent).toHaveLength(1);

    expect(JSON.parse(fs.readFileSync(storePath, 'utf-8'))).toEqual({
      'https://site.test': { notifications: 'granted' },
    });
  });

  it('remembers a block decision', () => {
    createManager();
    const callback = vi.fn();
    holder.request!(fakeWebContents(1), 'clipboard-read', callback, { requestingUrl: 'https://site.test/' });
    respondFromShell(sent[0].payload.id, false);
    expect(callback).toHaveBeenCalledWith(false);

    const second = vi.fn();
    holder.request!(fakeWebContents(1), 'clipboard-read', second, { requestingUrl: 'https://site.test/' });
    expect(second).toHaveBeenCalledWith(false);
    expect(sent).toHaveLength(1);
  });

  it('shares a single prompt across concurrent identical requests', () => {
    createManager();
    const first = vi.fn();
    const second = vi.fn();
    holder.request!(fakeWebContents(1), 'media', first, { requestingUrl: 'https://site.test/' });
    holder.request!(fakeWebContents(1), 'media', second, { requestingUrl: 'https://site.test/' });

    expect(sent).toHaveLength(1);
    respondFromShell(sent[0].payload.id, true);
    expect(first).toHaveBeenCalledWith(true);
    expect(second).toHaveBeenCalledWith(true);
  });

  it('denies without remembering when the prompt times out', async () => {
    createManager(5);
    const callback = vi.fn();
    holder.request!(fakeWebContents(1), 'notifications', callback, { requestingUrl: 'https://site.test/' });

    await vi.waitFor(() => expect(callback).toHaveBeenCalledWith(false));

    // Not remembered: the next request prompts again.
    const second = vi.fn();
    holder.request!(fakeWebContents(1), 'notifications', second, { requestingUrl: 'https://site.test/' });
    expect(second).not.toHaveBeenCalled();
    expect(sent).toHaveLength(2);
  });

  it('never prompts for the shell or for non-web origins', () => {
    createManager();
    const fromShell = vi.fn();
    holder.request!(fakeWebContents(SHELL_ID), 'clipboard-read', fromShell, {});
    expect(fromShell).toHaveBeenCalledWith(false);

    const fromFile = vi.fn();
    holder.request!(fakeWebContents(1, 'file:///etc/passwd'), 'clipboard-read', fromFile, {});
    expect(fromFile).toHaveBeenCalledWith(false);
    expect(sent).toHaveLength(0);
  });

  it('answers permission checks from policy and stored decisions', () => {
    fs.writeFileSync(storePath, JSON.stringify({ 'https://site.test': { notifications: 'granted' } }));
    createManager();

    expect(holder.check!(fakeWebContents(1), 'fullscreen', 'https://other.test')).toBe(true);
    expect(holder.check!(fakeWebContents(1), 'notifications', 'https://site.test')).toBe(true);
    expect(holder.check!(fakeWebContents(1), 'notifications', 'https://other.test')).toBe(false);
    expect(holder.check!(fakeWebContents(1), 'geolocation', 'https://site.test')).toBe(false);
    expect(holder.check!(fakeWebContents(SHELL_ID), 'notifications', 'https://site.test')).toBe(false);
  });

  it('clears all stored decisions via IPC', () => {
    fs.writeFileSync(storePath, JSON.stringify({ 'https://site.test': { notifications: 'granted' } }));
    createManager();

    const handlers = (ipcMain as unknown as { _handlers: Map<string, (...args: unknown[]) => unknown> })._handlers;
    handlers.get('permission:clear-all')!(null);

    expect(holder.check!(fakeWebContents(1), 'notifications', 'https://site.test')).toBe(false);
    expect(JSON.parse(fs.readFileSync(storePath, 'utf-8'))).toEqual({});
  });
});

describe('classifyPermission', () => {
  it('classifies known permissions', () => {
    expect(classifyPermission('fullscreen')).toBe('allow');
    expect(classifyPermission('mediaKeySystem')).toBe('allow');
    expect(classifyPermission('media')).toBe('prompt');
    expect(classifyPermission('clipboard-read')).toBe('prompt');
    expect(classifyPermission('notifications')).toBe('prompt');
    expect(classifyPermission('geolocation')).toBe('deny');
    expect(classifyPermission('usb')).toBe('deny');
  });
});

describe('permissionOriginOf', () => {
  it('returns the origin for web URLs only', () => {
    expect(permissionOriginOf('https://site.test/deep/path?q=1')).toBe('https://site.test');
    expect(permissionOriginOf('http://127.0.0.1:8080/x')).toBe('http://127.0.0.1:8080');
    expect(permissionOriginOf('file:///etc/passwd')).toBeNull();
    expect(permissionOriginOf('mytube://newtab')).toBeNull();
    expect(permissionOriginOf('not a url')).toBeNull();
    expect(permissionOriginOf(undefined)).toBeNull();
  });
});

describe('parseSitePermissionStore', () => {
  it('keeps only well-formed origin/decision entries', () => {
    const parsed = parseSitePermissionStore({
      'https://good.test': { notifications: 'granted', media: 'denied', junk: 'maybe' },
      'not-an-origin': { notifications: 'granted' },
      'https://empty.test': { notifications: 'sometimes' },
      'https://weird.test': 'nope',
    });
    expect(parsed).toEqual({ 'https://good.test': { notifications: 'granted', media: 'denied' } });
  });

  it('returns an empty store for malformed roots', () => {
    for (const input of [null, [], 'x', 42]) {
      expect(parseSitePermissionStore(input)).toEqual({});
    }
  });
});
