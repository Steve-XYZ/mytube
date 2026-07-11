import { describe, expect, it } from 'vitest';
import { TabManager } from '../../src/main/window/TabManager';
import type { CapturedMediaFallback } from '../../src/main/download/MediaFallbackProvider';

interface RequestDetails {
  id: number;
  webContentsId: number;
  url: string;
  resourceType: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string[]>;
  statusCode?: number;
}

type CaptureProbe = {
  tabs: Map<string, unknown>;
  tabIdsByWebContentsId: Map<number, string>;
  capturedMediaByTabId: Map<string, CapturedMediaFallback[]>;
  pendingMediaRequests: Map<number, unknown>;
  navigationIdsByTabId: Map<string, number>;
  captureMediaRequest(details: RequestDetails): void;
  captureMediaResponse(details: RequestDetails): void;
  getMediaFallbackForPage(pageUrl: string): CapturedMediaFallback | null;
};

const PAGE_URL = 'https://www.instagram.com/explore/';

function createProbe(): CaptureProbe {
  const probe = Object.create(TabManager.prototype) as CaptureProbe;
  probe.tabs = new Map([
    [
      'tab-1',
      {
        id: 'tab-1',
        info: {
          url: PAGE_URL,
          title: 'Instagram',
          mediaState: 'detected',
        },
      },
    ],
  ]);
  probe.tabIdsByWebContentsId = new Map([[42, 'tab-1']]);
  probe.capturedMediaByTabId = new Map();
  probe.pendingMediaRequests = new Map();
  probe.navigationIdsByTabId = new Map([['tab-1', 1]]);
  return probe;
}

function request(id: number, url: string): RequestDetails {
  return {
    id,
    webContentsId: 42,
    url,
    resourceType: 'media',
    requestHeaders: {
      Referer: 'https://www.instagram.com/',
      Cookie: 'must-not-be-replayed',
    },
  };
}

describe('TabManager media request capture', () => {
  it('promotes a request only after a successful media response', () => {
    const probe = createProbe();
    const details = request(1, 'https://cdn.example.com/reel.mp4?token=secret');

    probe.captureMediaRequest(details);
    expect(probe.getMediaFallbackForPage(PAGE_URL)).toBeNull();

    probe.captureMediaResponse({
      ...details,
      statusCode: 206,
      responseHeaders: {
        'Content-Type': ['video/mp4'],
        'Content-Length': ['20971520'],
      },
    });

    expect(probe.getMediaFallbackForPage(PAGE_URL)).toMatchObject({
      url: details.url,
      statusCode: 206,
      mimeType: 'video/mp4',
      contentLength: 20 * 1024 * 1024,
      requestHeaders: { Referer: 'https://www.instagram.com/' },
    });
  });

  it('discards failed responses', () => {
    const probe = createProbe();
    const details = request(2, 'https://cdn.example.com/reel.mp4');

    probe.captureMediaRequest(details);
    probe.captureMediaResponse({ ...details, statusCode: 403 });

    expect(probe.getMediaFallbackForPage(PAGE_URL)).toBeNull();
  });

  it('discards a response that completes after the tab navigated elsewhere', () => {
    const probe = createProbe();
    const details = request(3, 'https://cdn.example.com/old-reel.mp4');

    probe.captureMediaRequest(details);
    probe.navigationIdsByTabId.set('tab-1', 2);
    probe.captureMediaResponse({
      ...details,
      statusCode: 200,
      responseHeaders: { 'Content-Type': ['video/mp4'] },
    });

    expect(probe.getMediaFallbackForPage(PAGE_URL)).toBeNull();
  });
});
