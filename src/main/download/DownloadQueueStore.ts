import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import type { DownloadItem } from '../../shared/types';
import log from 'electron-log/main';

const SCHEMA_VERSION = 1;

interface PersistedDownload {
  id: string;
  status: DownloadItem['status'];
  queueOrder: number;
  createdAt: number;
  payload: string;
}

export interface DownloadPersistencePlan {
  upserts: PersistedDownload[];
  deletedIds: string[];
  nextPayloads: Map<string, string>;
}

export function planDownloadPersistence(
  previousPayloads: ReadonlyMap<string, string>,
  items: DownloadItem[],
): DownloadPersistencePlan {
  const upserts: PersistedDownload[] = [];
  const nextPayloads = new Map<string, string>();

  for (const item of items) {
    const payload = JSON.stringify({ ...item, speed: undefined, eta: undefined });
    nextPayloads.set(item.id, payload);
    if (previousPayloads.get(item.id) === payload) continue;

    upserts.push({
      id: item.id,
      status: item.status,
      queueOrder: item.queueOrder ?? item.createdAt,
      createdAt: item.createdAt,
      payload,
    });
  }

  const deletedIds = Array.from(previousPayloads.keys()).filter((id) => !nextPayloads.has(id));
  return { upserts, deletedIds, nextPayloads };
}

export interface DownloadStateStore {
  load(): DownloadItem[];
  save(items: DownloadItem[]): void;
  close(): void;
}

export class SqliteDownloadStateStore implements DownloadStateStore {
  private readonly db: Database.Database;
  private persistedPayloads = new Map<string, string>();
  private closed = false;

  constructor(
    databasePath: string,
    private readonly legacyJsonPath?: string,
  ) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.initializeSchema();
    this.persistedPayloads = this.readPersistedPayloads();
    this.importLegacyJsonOnce();
  }

  load(): DownloadItem[] {
    const rows = this.db
      .prepare('SELECT payload FROM downloads ORDER BY queue_order ASC, created_at ASC')
      .all() as Array<{ payload: string }>;

    return rows.flatMap((row) => {
      try {
        const item = JSON.parse(row.payload) as DownloadItem;
        return item && typeof item.id === 'string' ? [item] : [];
      } catch (error) {
        log.error('Skipping invalid download row:', error);
        return [];
      }
    });
  }

  save(items: DownloadItem[]): void {
    const { upserts, deletedIds, nextPayloads } = planDownloadPersistence(this.persistedPayloads, items);
    if (upserts.length === 0 && deletedIds.length === 0) return;

    const upsert = this.db.prepare(`
      INSERT INTO downloads (id, status, queue_order, created_at, updated_at, payload)
      VALUES (@id, @status, @queueOrder, @createdAt, @updatedAt, @payload)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        queue_order = excluded.queue_order,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        payload = excluded.payload
    `);
    const deleteById = this.db.prepare('DELETE FROM downloads WHERE id = ?');
    const persistChanges = this.db.transaction(() => {
      const updatedAt = Date.now();
      for (const id of deletedIds) deleteById.run(id);
      for (const item of upserts) {
        upsert.run({
          ...item,
          updatedAt,
        });
      }
    });
    persistChanges();
    this.persistedPayloads = nextPayloads;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS downloads (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        queue_order INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        payload TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_downloads_queue
        ON downloads(status, queue_order, created_at);
    `);
    this.db
      .prepare('INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)')
      .run('schema_version', String(SCHEMA_VERSION));
  }

  private readPersistedPayloads(): Map<string, string> {
    const rows = this.db.prepare('SELECT id, payload FROM downloads').all() as Array<{
      id: string;
      payload: string;
    }>;
    return new Map(rows.map((row) => [row.id, row.payload]));
  }

  private importLegacyJsonOnce(): void {
    if (!this.legacyJsonPath) return;
    const imported = this.db.prepare('SELECT value FROM schema_meta WHERE key = ?').get('legacy_json_imported') as
      | { value: string }
      | undefined;
    if (imported) return;

    const count = (this.db.prepare('SELECT COUNT(*) AS count FROM downloads').get() as { count: number }).count;
    if (count > 0 || !fs.existsSync(this.legacyJsonPath)) {
      this.markLegacyImported();
      return;
    }

    let items: DownloadItem[];
    try {
      const parsed = JSON.parse(fs.readFileSync(this.legacyJsonPath, 'utf-8')) as unknown;
      if (!Array.isArray(parsed)) throw new Error('Legacy download state must be an array');
      items = parsed.filter((item): item is DownloadItem =>
        Boolean(item && typeof item === 'object' && 'id' in item && typeof item.id === 'string'),
      );
    } catch (error) {
      log.error('Failed to import legacy download state:', error);
      this.backupCorruptedLegacyState();
      this.markLegacyImported();
      return;
    }

    try {
      this.save(items);
    } catch (error) {
      log.error('Failed to persist imported legacy download state:', error);
      return;
    }

    this.markLegacyImported();
    log.info(`Imported ${items.length} downloads from legacy JSON state`);
  }

  private markLegacyImported(): void {
    this.db
      .prepare('INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)')
      .run('legacy_json_imported', String(Date.now()));
  }

  private backupCorruptedLegacyState(): void {
    if (!this.legacyJsonPath || !fs.existsSync(this.legacyJsonPath)) return;
    try {
      fs.copyFileSync(this.legacyJsonPath, `${this.legacyJsonPath}.corrupted.${Date.now()}`);
    } catch (error) {
      log.error('Failed to backup corrupted legacy download state:', error);
    }
  }
}
