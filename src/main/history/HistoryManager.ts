import { ipcMain } from 'electron';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { HistoryEntry, IPC_CHANNELS } from '../../shared/types';
import { writeFileAtomic } from '../utils/fsAtomic';
import log from 'electron-log/main';

const MAX_HISTORY_ENTRIES = 2000;
// A reload or quick revisit of the same URL updates the entry instead of
// stacking duplicates, mirroring what mainstream browsers do.
const REVISIT_MERGE_WINDOW_MS = 30_000;
const SAVE_DEBOUNCE_MS = 1000;
const DEFAULT_LIST_LIMIT = 200;

export interface HistoryQuery {
  search?: string;
  limit?: number;
}

export interface HistoryManagerOptions {
  storePath: string;
}

export class HistoryManager {
  /** Newest first. */
  private entries: HistoryEntry[] = [];
  private storePath: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: HistoryManagerOptions) {
    this.storePath = options.storePath;
    this.entries = this.loadEntries();

    ipcMain.handle(IPC_CHANNELS.HISTORY_LIST, (_event, query?: unknown) => this.list(sanitizeQuery(query)));
    ipcMain.handle(IPC_CHANNELS.HISTORY_DELETE, (_event, id: string) => {
      if (typeof id !== 'string') return false;
      return this.deleteEntry(id);
    });
    ipcMain.handle(IPC_CHANNELS.HISTORY_CLEAR, () => {
      this.clear();
      return true;
    });
  }

  /** Called by TabManager on main-frame navigations. */
  recordVisit(url: string, title: string): void {
    if (!isRecordableUrl(url)) return;

    const now = Date.now();
    const latest = this.entries[0];
    if (latest && latest.url === url && now - latest.visitedAt < REVISIT_MERGE_WINDOW_MS) {
      latest.visitedAt = now;
      if (title) latest.title = title;
    } else {
      this.entries.unshift({ id: randomUUID(), url, title: title || url, visitedAt: now });
      if (this.entries.length > MAX_HISTORY_ENTRIES) {
        this.entries.length = MAX_HISTORY_ENTRIES;
      }
    }
    this.scheduleSave();
  }

  /** Page titles usually arrive after did-navigate; update the latest visit. */
  updateVisitTitle(url: string, title: string): void {
    if (!title || !isRecordableUrl(url)) return;
    const entry = this.entries.find((candidate) => candidate.url === url);
    if (entry && entry.title !== title) {
      entry.title = title;
      this.scheduleSave();
    }
  }

  list(query: HistoryQuery): HistoryEntry[] {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_HISTORY_ENTRIES);
    const search = query.search?.trim().toLowerCase();
    const matches = search
      ? this.entries.filter(
          (entry) => entry.url.toLowerCase().includes(search) || entry.title.toLowerCase().includes(search),
        )
      : this.entries;
    return matches.slice(0, limit);
  }

  deleteEntry(id: string): boolean {
    const before = this.entries.length;
    this.entries = this.entries.filter((entry) => entry.id !== id);
    if (this.entries.length === before) return false;
    this.scheduleSave();
    return true;
  }

  clear(): void {
    this.entries = [];
    this.scheduleSave();
    log.info('Browsing history cleared');
  }

  private loadEntries(): HistoryEntry[] {
    try {
      if (!fs.existsSync(this.storePath)) return [];
      const raw = JSON.parse(fs.readFileSync(this.storePath, 'utf-8'));
      if (!Array.isArray(raw)) return [];
      return raw
        .filter(
          (entry): entry is HistoryEntry =>
            typeof entry === 'object' &&
            entry !== null &&
            typeof entry.id === 'string' &&
            typeof entry.url === 'string' &&
            typeof entry.title === 'string' &&
            typeof entry.visitedAt === 'number',
        )
        .slice(0, MAX_HISTORY_ENTRIES);
    } catch (err: unknown) {
      log.warn('Failed to load history:', err instanceof Error ? err.message : String(err));
      return [];
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, SAVE_DEBOUNCE_MS);
  }

  private save(): void {
    try {
      writeFileAtomic(this.storePath, JSON.stringify(this.entries, null, 2));
    } catch (err: unknown) {
      log.warn('Failed to save history:', err instanceof Error ? err.message : String(err));
    }
  }

  destroy(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.save();
    ipcMain.removeHandler(IPC_CHANNELS.HISTORY_LIST);
    ipcMain.removeHandler(IPC_CHANNELS.HISTORY_DELETE);
    ipcMain.removeHandler(IPC_CHANNELS.HISTORY_CLEAR);
  }
}

function isRecordableUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

/** IPC payloads are caller-controlled; keep only well-typed query fields. */
function sanitizeQuery(query: unknown): HistoryQuery {
  if (typeof query !== 'object' || query === null) return {};
  const raw = query as Record<string, unknown>;
  const safe: HistoryQuery = {};
  if (typeof raw.search === 'string') safe.search = raw.search;
  if (typeof raw.limit === 'number' && Number.isFinite(raw.limit)) safe.limit = raw.limit;
  return safe;
}
