import { ipcMain } from 'electron';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { Bookmark, IPC_CHANNELS } from '../../shared/types';
import { writeFileAtomic } from '../utils/fsAtomic';
import log from 'electron-log/main';

const MAX_BOOKMARKS = 1000;

type ShellSender = { send: (channel: string, ...args: unknown[]) => void };

export interface BookmarksManagerOptions {
  storePath: string;
  /** Notified with the full list whenever bookmarks change. */
  shellSender: ShellSender;
}

export class BookmarksManager {
  /** Newest first. */
  private bookmarks: Bookmark[] = [];
  private storePath: string;
  private shellSender: ShellSender;

  constructor(options: BookmarksManagerOptions) {
    this.storePath = options.storePath;
    this.shellSender = options.shellSender;
    this.bookmarks = this.loadBookmarks();

    ipcMain.handle(IPC_CHANNELS.BOOKMARK_TOGGLE, (_event, url: string, title?: string) => {
      if (typeof url !== 'string' || !isBookmarkableUrl(url)) return { bookmarked: false };
      return { bookmarked: this.toggle(url, typeof title === 'string' ? title : '') };
    });
    ipcMain.handle(IPC_CHANNELS.BOOKMARK_LIST, () => this.list());
    ipcMain.handle(IPC_CHANNELS.BOOKMARK_REMOVE, (_event, id: string) => {
      if (typeof id !== 'string') return false;
      return this.remove(id);
    });
    ipcMain.handle(IPC_CHANNELS.BOOKMARK_STATUS, (_event, url: string) => {
      return typeof url === 'string' && this.isBookmarked(url);
    });
  }

  /** Returns the new bookmarked state for the URL. */
  toggle(url: string, title: string): boolean {
    const existing = this.bookmarks.find((bookmark) => bookmark.url === url);
    if (existing) {
      this.bookmarks = this.bookmarks.filter((bookmark) => bookmark.url !== url);
      this.persistAndNotify();
      return false;
    }

    if (this.bookmarks.length >= MAX_BOOKMARKS) {
      log.warn(`Bookmark limit reached (${MAX_BOOKMARKS})`);
      return false;
    }
    this.bookmarks.unshift({ id: randomUUID(), url, title: title || url, createdAt: Date.now() });
    this.persistAndNotify();
    return true;
  }

  remove(id: string): boolean {
    const before = this.bookmarks.length;
    this.bookmarks = this.bookmarks.filter((bookmark) => bookmark.id !== id);
    if (this.bookmarks.length === before) return false;
    this.persistAndNotify();
    return true;
  }

  isBookmarked(url: string): boolean {
    return this.bookmarks.some((bookmark) => bookmark.url === url);
  }

  list(): Bookmark[] {
    return [...this.bookmarks];
  }

  private persistAndNotify(): void {
    try {
      writeFileAtomic(this.storePath, JSON.stringify(this.bookmarks, null, 2));
    } catch (err: unknown) {
      log.warn('Failed to save bookmarks:', err instanceof Error ? err.message : String(err));
    }
    this.shellSender.send(IPC_CHANNELS.BOOKMARK_CHANGED, this.list());
  }

  private loadBookmarks(): Bookmark[] {
    try {
      if (!fs.existsSync(this.storePath)) return [];
      const raw = JSON.parse(fs.readFileSync(this.storePath, 'utf-8'));
      if (!Array.isArray(raw)) return [];
      return raw
        .filter(
          (bookmark): bookmark is Bookmark =>
            typeof bookmark === 'object' &&
            bookmark !== null &&
            typeof bookmark.id === 'string' &&
            typeof bookmark.url === 'string' &&
            typeof bookmark.title === 'string' &&
            typeof bookmark.createdAt === 'number',
        )
        .slice(0, MAX_BOOKMARKS);
    } catch (err: unknown) {
      log.warn('Failed to load bookmarks:', err instanceof Error ? err.message : String(err));
      return [];
    }
  }

  destroy(): void {
    ipcMain.removeHandler(IPC_CHANNELS.BOOKMARK_TOGGLE);
    ipcMain.removeHandler(IPC_CHANNELS.BOOKMARK_LIST);
    ipcMain.removeHandler(IPC_CHANNELS.BOOKMARK_REMOVE);
    ipcMain.removeHandler(IPC_CHANNELS.BOOKMARK_STATUS);
  }
}

function isBookmarkableUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}
