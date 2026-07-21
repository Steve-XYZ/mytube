import { describe, expect, it } from 'vitest';
import { rankCapturedMediaCandidates, resolveDownloadTarget } from '../../src/main/download/DownloadTargetResolver';
import type { CapturedMediaFallback } from '../../src/main/download/MediaFallbackProvider';

const PAGE = 'https://www.instagram.com/explore/';

function captured(url: string): CapturedMediaFallback {
  return {
    url,
    pageUrl: PAGE,
    title: 'Captured reel',
    requestHeaders: { Referer: 'https://www.instagram.com/' },
    capturedAt: Date.now(),
  };
}

describe('resolveDownloadTarget', () => {
  it('keeps a specific platform permalink as the primary extractor input', () => {
    const pageUrl = 'https://www.instagram.com/reel/abc123/';

    expect(
      resolveDownloadTarget(pageUrl, {
        canonicalUrl: 'https://www.instagram.com/',
        mediaUrl: 'https://cdn.example.com/video.mp4',
      }),
    ).toMatchObject({ pageUrl, url: pageUrl, source: 'page' });
  });

  it('uses a media permalink associated with the active video on a browsing page', () => {
    const result = resolveDownloadTarget(PAGE, {
      permalinkUrls: ['/reel/active123/'],
      canonicalUrl: PAGE,
      mediaUrl: 'blob:https://www.instagram.com/local-media',
    });

    expect(result).toMatchObject({
      pageUrl: PAGE,
      url: 'https://www.instagram.com/reel/active123/',
      source: 'permalink',
    });
  });

  it('uses a media canonical URL when the active element has no permalink', () => {
    const result = resolveDownloadTarget('https://www.tiktok.com/foryou', {
      canonicalUrl: 'https://www.tiktok.com/@creator/video/123456',
    });

    expect(result).toMatchObject({
      url: 'https://www.tiktok.com/@creator/video/123456',
      source: 'canonical',
    });
  });

  it('keeps an unknown media page when the document exposes strong media metadata', () => {
    const pageUrl = 'https://video.example.com/watch/episode-26';
    const result = resolveDownloadTarget(pageUrl, {
      hasPageMediaMetadata: true,
      mediaUrl: 'https://cdn.example.com/temporary-source.mp4?token=secret',
    });

    expect(result).toMatchObject({ pageUrl, url: pageUrl, source: 'page' });
  });

  it('still uses active media on an unknown browsing page without media metadata', () => {
    const pageUrl = 'https://video.example.com/feed';
    const mediaUrl = 'https://cdn.example.com/active-video.mp4?token=secret';
    const result = resolveDownloadTarget(pageUrl, { hasPageMediaMetadata: false, mediaUrl });

    expect(result).toMatchObject({ pageUrl, url: mediaUrl, source: 'active-media' });
  });

  it('preserves captured browser context for the active direct media URL', () => {
    const fallback = captured('https://cdn.example.com/reel.mp4?token=secret');
    const result = resolveDownloadTarget(
      PAGE,
      { mediaUrl: 'https://cdn.example.com/reel.mp4?token=secret', title: 'Active reel' },
      [fallback],
    );

    expect(result).toMatchObject({
      url: fallback.url,
      source: 'active-media',
      title: 'Active reel',
      fallback,
    });
  });

  it('accepts an active video source without a file extension', () => {
    const fallback = {
      ...captured('https://cdn.example.com/playback?id=123'),
      resourceType: 'media',
    };
    const result = resolveDownloadTarget(PAGE, { mediaUrl: fallback.url }, [fallback]);

    expect(result).toMatchObject({ url: fallback.url, source: 'active-media', fallback });
  });

  it('falls back to a captured direct resource when the DOM only exposes a blob URL', () => {
    const fallback = captured('https://cdn.example.com/playlist.m3u8?token=secret');
    const result = resolveDownloadTarget(PAGE, { mediaUrl: 'blob:https://www.instagram.com/abc' }, [fallback]);

    expect(result).toMatchObject({ url: fallback.url, source: 'captured-media', fallback });
  });

  it('uses a captured XHR media response without relying on a file extension', () => {
    const fallback = {
      ...captured('https://cdn.example.com/playback?id=signed-resource'),
      resourceType: 'xhr',
      statusCode: 200,
      mimeType: 'application/vnd.apple.mpegurl',
    };
    const result = resolveDownloadTarget(PAGE, { mediaUrl: 'blob:https://www.instagram.com/abc' }, [fallback]);

    expect(result).toMatchObject({ url: fallback.url, source: 'captured-media', fallback });
  });

  it('returns the page when no trustworthy media target exists', () => {
    expect(
      resolveDownloadTarget(PAGE, {
        canonicalUrl: 'javascript:alert(1)',
        mediaUrl: 'blob:https://www.instagram.com/abc',
      }),
    ).toEqual({ pageUrl: PAGE, url: PAGE, source: 'page', title: undefined });
  });
});

describe('rankCapturedMediaCandidates', () => {
  it('prefers a successful video response over a newer audio response', () => {
    const video = {
      ...captured('https://cdn.example.com/video.mp4'),
      statusCode: 206,
      mimeType: 'video/mp4',
      contentLength: 20 * 1024 * 1024,
      resourceType: 'media',
    };
    const audio = {
      ...captured('https://cdn.example.com/audio.m4a'),
      statusCode: 200,
      mimeType: 'audio/mp4',
      capturedAt: video.capturedAt + 1000,
    };

    expect(rankCapturedMediaCandidates([audio, video])).toEqual([video, audio]);
  });

  it('prefers an adaptive manifest over media segments and advertising', () => {
    const manifest = {
      ...captured('https://cdn.example.com/master.m3u8'),
      statusCode: 200,
      mimeType: 'application/vnd.apple.mpegurl',
    };
    const segment = {
      ...captured('https://cdn.example.com/chunk_0042.m4s'),
      statusCode: 200,
      mimeType: 'video/iso.segment',
      resourceType: 'media',
      contentLength: 15 * 1024 * 1024,
    };
    const ad = {
      ...captured('https://adservice.example.com/ads/video.mp4'),
      statusCode: 200,
      mimeType: 'video/mp4',
      resourceType: 'media',
      contentLength: 30 * 1024 * 1024,
    };

    expect(rankCapturedMediaCandidates([segment, ad, manifest])[0]).toBe(manifest);
  });

  it('drops failed responses before selecting a fallback', () => {
    const failed = { ...captured('https://cdn.example.com/video.mp4'), statusCode: 403 };

    expect(rankCapturedMediaCandidates([failed])).toEqual([]);
  });
});
