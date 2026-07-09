import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HistoryManager } from '../../src/main/history/HistoryManager';

describe('HistoryManager', () => {
  let dir: string;
  let storePath: string;
  let manager: HistoryManager;

  beforeEach(() => {
    vi.useFakeTimers();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'history-test-'));
    storePath = path.join(dir, 'history.json');
    manager = new HistoryManager({ storePath });
  });

  afterEach(() => {
    manager.destroy();
    vi.useRealTimers();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('records visits newest first', () => {
    manager.recordVisit('https://a.test/', 'Page A');
    vi.advanceTimersByTime(60_000);
    manager.recordVisit('https://b.test/', 'Page B');

    const entries = manager.list({});
    expect(entries.map((entry) => entry.url)).toEqual(['https://b.test/', 'https://a.test/']);
    expect(entries[0].title).toBe('Page B');
  });

  it('merges quick revisits of the same URL instead of duplicating', () => {
    manager.recordVisit('https://a.test/', 'Page A');
    vi.advanceTimersByTime(5_000);
    manager.recordVisit('https://a.test/', 'Page A (updated)');

    const entries = manager.list({});
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe('Page A (updated)');
  });

  it('records separate entries when revisits are far apart', () => {
    manager.recordVisit('https://a.test/', 'Page A');
    vi.advanceTimersByTime(60_000);
    manager.recordVisit('https://a.test/', 'Page A');

    expect(manager.list({})).toHaveLength(2);
  });

  it('ignores non-web URLs', () => {
    manager.recordVisit('mytube://newtab', 'MyTube');
    manager.recordVisit('file:///etc/passwd', 'Nope');
    manager.recordVisit('data:text/html,x', 'Nope');
    expect(manager.list({})).toHaveLength(0);
  });

  it('updates the latest matching title', () => {
    manager.recordVisit('https://a.test/', '');
    manager.updateVisitTitle('https://a.test/', 'Real Title');
    expect(manager.list({})[0].title).toBe('Real Title');
  });

  it('searches url and title case-insensitively', () => {
    manager.recordVisit('https://videos.test/watch', 'Funny Cats');
    vi.advanceTimersByTime(60_000);
    manager.recordVisit('https://news.test/', 'Daily News');

    expect(manager.list({ search: 'CATS' }).map((entry) => entry.title)).toEqual(['Funny Cats']);
    expect(manager.list({ search: 'news.test' }).map((entry) => entry.title)).toEqual(['Daily News']);
    expect(manager.list({ search: 'nothing' })).toHaveLength(0);
  });

  it('deletes single entries and clears everything', () => {
    manager.recordVisit('https://a.test/', 'A');
    vi.advanceTimersByTime(60_000);
    manager.recordVisit('https://b.test/', 'B');

    const [newest] = manager.list({});
    expect(manager.deleteEntry(newest.id)).toBe(true);
    expect(manager.deleteEntry('missing')).toBe(false);
    expect(manager.list({}).map((entry) => entry.url)).toEqual(['https://a.test/']);

    manager.clear();
    expect(manager.list({})).toHaveLength(0);
  });

  it('persists entries and reloads them', () => {
    manager.recordVisit('https://a.test/', 'Page A');
    manager.destroy(); // flushes the debounced save

    const reloaded = new HistoryManager({ storePath });
    expect(reloaded.list({}).map((entry) => entry.url)).toEqual(['https://a.test/']);
    reloaded.destroy();
  });

  it('recovers from a corrupt store file', () => {
    manager.destroy();
    fs.writeFileSync(storePath, '{not json');
    manager = new HistoryManager({ storePath });
    expect(manager.list({})).toHaveLength(0);
  });
});
