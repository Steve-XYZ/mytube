import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import type { DownloadItem } from '../../shared/types';
import log from 'electron-log/main';

const SCHEMA_VERSION = 1;

export interface DownloadStateStore {
  load(): DownloadItem[];
  save(items: DownloadItem[]): void;
  close(): void;
}

export class SqliteDownloadStateStore implements DownloadStateStore {
  private readonly db: Database.Database;
  private closed = false;

  constructor(
    databasePath: string,
    private readonly legacyJsonPath?: string,
  ) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initializeSchema();
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
    const insert = this.db.prepare(`
      INSERT INTO downloads (id, status, queue_order, created_at, updated_at, payload)
      VALUES (@id, @status, @queueOrder, @createdAt, @updatedAt, @payload)
    `);
    const saveAll = this.db.transaction((downloads: DownloadItem[]) => {
      this.db.prepare('DELETE FROM downloads').run();
      const updatedAt = Date.now();
      for (const item of downloads) {
        insert.run({
          id: item.id,
          status: item.status,
          queueOrder: item.queueOrder ?? item.createdAt,
          createdAt: item.createdAt,
          updatedAt,
          payload: JSON.stringify({ ...item, speed: undefined, eta: undefined }),
        });
      }
    });
    saveAll(items);
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

  private importLegacyJsonOnce(): void {
    if (!this.legacyJsonPath) return;
    const imported = this.db.prepare('SELECT value FROM schema_meta WHERE key = ?').get('legacy_json_imported') as
      | { value: string }
      | undefined;
    if (imported) return;

    try {
      const count = (this.db.prepare('SELECT COUNT(*) AS count FROM downloads').get() as { count: number }).count;
      if (count === 0 && fs.existsSync(this.legacyJsonPath)) {
        const parsed = JSON.parse(fs.readFileSync(this.legacyJsonPath, 'utf-8')) as unknown;
        if (!Array.isArray(parsed)) throw new Error('Legacy download state must be an array');
        const items = parsed.filter((item): item is DownloadItem =>
          Boolean(item && typeof item === 'object' && 'id' in item && typeof item.id === 'string'),
        );
        this.save(items);
        log.info(`Imported ${items.length} downloads from legacy JSON state`);
      }
    } catch (error) {
      log.error('Failed to import legacy download state:', error);
      this.backupCorruptedLegacyState();
    } finally {
      this.db
        .prepare('INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)')
        .run('legacy_json_imported', String(Date.now()));
    }
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
