import { describe, expect, it } from 'vitest';
import { planDownloadPersistence } from '../../src/main/download/DownloadQueueStore';
import type { DownloadItem } from '../../src/shared/types';

function createDownload(id: string, overrides: Partial<DownloadItem> = {}): DownloadItem {
  return {
    id,
    url: `https://example.com/${id}`,
    title: id,
    filename: `${id}.mp4`,
    savePath: `/tmp/${id}.mp4`,
    type: 'video',
    status: 'queued',
    progress: 0,
    createdAt: 100,
    queueOrder: 100,
    ...overrides,
  };
}

describe('planDownloadPersistence', () => {
  it('upserts only changed downloads and deletes removed downloads', () => {
    const first = createDownload('first');
    const second = createDownload('second', { queueOrder: 200 });
    const initial = planDownloadPersistence(new Map(), [first, second]);

    expect(initial.upserts.map((item) => item.id)).toEqual(['first', 'second']);
    expect(initial.deletedIds).toEqual([]);

    const unchanged = planDownloadPersistence(initial.nextPayloads, [first, second]);
    expect(unchanged.upserts).toEqual([]);
    expect(unchanged.deletedIds).toEqual([]);

    const changed = planDownloadPersistence(initial.nextPayloads, [
      createDownload('first', { progress: 50 }),
      createDownload('third', { queueOrder: 300 }),
    ]);
    expect(changed.upserts.map((item) => item.id)).toEqual(['first', 'third']);
    expect(changed.deletedIds).toEqual(['second']);
    expect(JSON.parse(changed.nextPayloads.get('first')!).progress).toBe(50);
  });

  it('ignores transient progress metadata', () => {
    const initial = planDownloadPersistence(new Map(), [createDownload('first', { speed: '1 MiB/s', eta: '10s' })]);
    const transientUpdate = planDownloadPersistence(initial.nextPayloads, [
      createDownload('first', { speed: '2 MiB/s', eta: '5s' }),
    ]);

    expect(transientUpdate.upserts).toEqual([]);
    const payload = JSON.parse(transientUpdate.nextPayloads.get('first')!);
    expect(payload).not.toHaveProperty('speed');
    expect(payload).not.toHaveProperty('eta');
  });

  it('keeps writes proportional to changes at the history limit', () => {
    const downloads = Array.from({ length: 500 }, (_, index) =>
      createDownload(`download-${index}`, { queueOrder: index }),
    );
    const initial = planDownloadPersistence(new Map(), downloads);
    const updated = downloads.map((item, index) => (index === 250 ? { ...item, progress: 50 } : item));

    const incremental = planDownloadPersistence(initial.nextPayloads, updated);

    expect(incremental.upserts).toHaveLength(1);
    expect(incremental.upserts[0].id).toBe('download-250');
    expect(incremental.deletedIds).toEqual([]);
  });
});
