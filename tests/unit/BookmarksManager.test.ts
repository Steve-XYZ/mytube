import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BookmarksManager } from '../../src/main/bookmarks/BookmarksManager';

describe('BookmarksManager', () => {
  let dir: string;
  let storePath: string;
  let manager: BookmarksManager;
  let sent: Array<{ channel: string; bookmarks: unknown }>;

  function createManager() {
    manager = new BookmarksManager({
      storePath,
      shellSender: { send: (channel: string, bookmarks: unknown) => sent.push({ channel, bookmarks }) },
    });
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmarks-test-'));
    storePath = path.join(dir, 'bookmarks.json');
    sent = [];
    createManager();
  });

  afterEach(() => {
    manager.destroy();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('toggles a bookmark on and off', () => {
    expect(manager.toggle('https://a.test/', 'Page A')).toBe(true);
    expect(manager.isBookmarked('https://a.test/')).toBe(true);

    expect(manager.toggle('https://a.test/', 'Page A')).toBe(false);
    expect(manager.isBookmarked('https://a.test/')).toBe(false);
  });

  it('lists newest first and falls back to the URL as title', () => {
    manager.toggle('https://a.test/', '');
    manager.toggle('https://b.test/', 'Page B');

    const list = manager.list();
    expect(list.map((bookmark) => bookmark.url)).toEqual(['https://b.test/', 'https://a.test/']);
    expect(list[1].title).toBe('https://a.test/');
  });

  it('removes by id', () => {
    manager.toggle('https://a.test/', 'A');
    const [bookmark] = manager.list();
    expect(manager.remove(bookmark.id)).toBe(true);
    expect(manager.remove(bookmark.id)).toBe(false);
    expect(manager.list()).toHaveLength(0);
  });

  it('notifies the shell with the updated list on every change', () => {
    manager.toggle('https://a.test/', 'A');
    manager.toggle('https://b.test/', 'B');
    const [bookmark] = manager.list();
    manager.remove(bookmark.id);

    expect(sent).toHaveLength(3);
    expect(sent.every((event) => event.channel === 'bookmark:changed')).toBe(true);
    expect((sent[2].bookmarks as Array<{ url: string }>).map((item) => item.url)).toEqual(['https://a.test/']);
  });

  it('persists and reloads bookmarks', () => {
    manager.toggle('https://a.test/', 'Page A');
    manager.destroy();

    createManager();
    expect(manager.isBookmarked('https://a.test/')).toBe(true);
    expect(manager.list()[0].title).toBe('Page A');
  });

  it('recovers from a corrupt store file', () => {
    manager.destroy();
    fs.writeFileSync(storePath, '[{"broken": true}, "junk"]');
    createManager();
    expect(manager.list()).toHaveLength(0);
  });
});

// Guards the IPC surface: toggling through the handler rejects non-web URLs.
describe('BookmarksManager IPC validation', () => {
  it('rejects non-web URLs through the toggle handler', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmarks-ipc-test-'));
    const manager = new BookmarksManager({
      storePath: path.join(dir, 'bookmarks.json'),
      shellSender: { send: vi.fn() },
    });

    const { ipcMain } = await import('electron');
    const handlers = (ipcMain as unknown as { _handlers: Map<string, (...args: unknown[]) => unknown> })._handlers;
    const toggle = handlers.get('bookmark:toggle')!;

    expect(toggle(null, 'mytube://newtab', 'New Tab')).toEqual({ bookmarked: false });
    expect(toggle(null, 'file:///x', 'File')).toEqual({ bookmarked: false });
    expect(manager.list()).toHaveLength(0);

    manager.destroy();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
