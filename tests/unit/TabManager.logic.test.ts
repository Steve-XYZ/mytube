import { describe, it, expect } from 'vitest';
import {
  classifyMediaUrl,
  isDirectMediaResourceUrl,
  isLikelyMediaUrl,
} from '../../src/main/download/MediaUrlClassifier';

/**
 * Tests for pure logic functions from TabManager.
 * Since TabManager is heavily coupled to Electron (BaseWindow, WebContentsView, ipcMain),
 * we extract and test the pure logic functions independently.
 */

// ===== isAllowedUrl =====
function isAllowedUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return ['http:', 'https:', 'blob:', 'about:', 'mytube:'].includes(u.protocol);
  } catch {
    return false;
  }
}

// ===== isSearchQuery =====
function isSearchQuery(input: string): boolean {
  if (input.includes(' ')) return true;
  if (!input.includes('.') && !input.includes(':')) return true;
  return false;
}

// ===== buildSearchUrl =====
function buildSearchUrl(query: string, engine: string = 'google'): string {
  const encoded = encodeURIComponent(query);
  switch (engine) {
    case 'duckduckgo':
      return `https://duckduckgo.com/?q=${encoded}`;
    case 'bing':
      return `https://www.bing.com/search?q=${encoded}`;
    default:
      return `https://www.google.com/search?q=${encoded}`;
  }
}

// ===== escapeHtml =====
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ===== getFriendlyError =====
function getFriendlyError(code: number): string {
  switch (code) {
    case -2:
      return 'Network Error';
    case -6:
      return 'File Not Found';
    case -7:
      return 'Too Many Redirects';
    case -100:
      return 'Connection Closed';
    case -101:
      return 'Connection Reset';
    case -102:
      return 'Connection Refused';
    case -103:
      return 'Connection Failed';
    case -104:
      return 'Connection Timed Out';
    case -105:
      return 'Could Not Resolve Host';
    case -106:
      return 'No Internet Connection';
    case -109:
      return 'Address Unreachable';
    case -118:
      return 'Connection Timed Out';
    case -200:
      return 'Certificate Error';
    case -201:
      return 'Certificate Date Invalid';
    case -202:
      return 'Certificate Authority Invalid';
    default:
      return 'This Page Could Not Be Loaded';
  }
}

// ===== Tests =====

describe('TabManager - isKnownVideoUrl', () => {
  describe('YouTube', () => {
    it('detects youtube.com/watch URLs', () => {
      expect(isLikelyMediaUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
    });

    it('detects youtube.com/shorts URLs', () => {
      expect(isLikelyMediaUrl('https://www.youtube.com/shorts/abc123')).toBe(true);
    });

    it('detects youtu.be short links', () => {
      expect(isLikelyMediaUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
    });

    it('detects m.youtube.com', () => {
      expect(isLikelyMediaUrl('https://m.youtube.com/watch?v=abc')).toBe(true);
    });

    it('rejects youtube.com homepage', () => {
      expect(isLikelyMediaUrl('https://www.youtube.com/')).toBe(false);
    });

    it('rejects youtube.com/channel pages', () => {
      expect(isLikelyMediaUrl('https://www.youtube.com/channel/UC123')).toBe(false);
    });

    it('rejects youtube.com/results (search)', () => {
      expect(isLikelyMediaUrl('https://www.youtube.com/results?search_query=test')).toBe(false);
    });
  });

  describe('other platforms', () => {
    it('detects vimeo.com', () => {
      expect(isLikelyMediaUrl('https://vimeo.com/123456')).toBe(true);
    });

    it('detects tiktok.com', () => {
      expect(isLikelyMediaUrl('https://www.tiktok.com/@user/video/123')).toBe(true);
    });

    it('detects twitter.com', () => {
      expect(isLikelyMediaUrl('https://twitter.com/user/status/123')).toBe(true);
    });

    it('detects x.com', () => {
      expect(isLikelyMediaUrl('https://x.com/user/status/123')).toBe(true);
    });

    it('detects instagram post and reel URLs', () => {
      expect(isLikelyMediaUrl('https://www.instagram.com/p/abc123/')).toBe(true);
      expect(isLikelyMediaUrl('https://www.instagram.com/reel/abc123/')).toBe(true);
    });

    it('detects reddit.com', () => {
      expect(isLikelyMediaUrl('https://www.reddit.com/r/funny/comments/abc/title/')).toBe(true);
    });

    it('detects twitch.tv', () => {
      expect(isLikelyMediaUrl('https://www.twitch.tv/videos/123')).toBe(true);
    });

    it('detects soundcloud.com', () => {
      expect(isLikelyMediaUrl('https://soundcloud.com/artist/track')).toBe(true);
    });

    it('detects bandcamp.com', () => {
      expect(isLikelyMediaUrl('https://artist.bandcamp.com/track/song')).toBe(true);
    });

    it('detects bilibili.com', () => {
      expect(isLikelyMediaUrl('https://www.bilibili.com/video/BV123')).toBe(true);
    });

    it('detects localized and non-localized TokyVideo pages', () => {
      expect(isLikelyMediaUrl('https://www.tokyvideo.com/es/video/episode-26')).toBe(true);
      expect(isLikelyMediaUrl('https://www.tokyvideo.com/video/episode-26')).toBe(true);
    });

    it('detects direct media URLs', () => {
      expect(isLikelyMediaUrl('https://cdn.example.com/video.mp4?token=abc')).toBe(true);
      expect(isLikelyMediaUrl('https://cdn.example.com/live/playlist.m3u8')).toBe(true);
      expect(isDirectMediaResourceUrl('https://cdn.example.com/video.mp4?token=abc')).toBe(true);
      expect(isDirectMediaResourceUrl('https://cdn.example.com/live/playlist.m3u8')).toBe(true);
    });
  });

  describe('non-video URLs', () => {
    it('rejects google.com', () => {
      expect(isLikelyMediaUrl('https://www.google.com')).toBe(false);
    });

    it('rejects github.com', () => {
      expect(isLikelyMediaUrl('https://github.com/user/repo')).toBe(false);
    });

    it('rejects browsing pages on supported platforms', () => {
      expect(isLikelyMediaUrl('https://www.instagram.com/explore/')).toBe(false);
      expect(isLikelyMediaUrl('https://www.instagram.com/openai/')).toBe(false);
      expect(isLikelyMediaUrl('https://www.tiktok.com/@openai')).toBe(false);
      expect(isLikelyMediaUrl('https://x.com/explore')).toBe(false);
      expect(isLikelyMediaUrl('https://www.facebook.com/some.profile')).toBe(false);
      expect(isLikelyMediaUrl('https://evilbandcamp.com/track/song')).toBe(false);
      expect(isLikelyMediaUrl('https://www.tokyvideo.com/es/')).toBe(false);
    });

    it('rejects invalid URLs', () => {
      expect(isLikelyMediaUrl('not a url')).toBe(false);
      expect(isLikelyMediaUrl('')).toBe(false);
      expect(isDirectMediaResourceUrl('ftp://cdn.example.com/video.mp4')).toBe(false);
    });

    it('explains Instagram browsing pages as non-media', () => {
      expect(classifyMediaUrl('https://www.instagram.com/explore/')).toMatchObject({
        platform: 'instagram',
        isMediaPage: false,
      });
    });
  });
});

describe('TabManager - isAllowedUrl', () => {
  it('allows http URLs', () => {
    expect(isAllowedUrl('http://example.com')).toBe(true);
  });

  it('allows https URLs', () => {
    expect(isAllowedUrl('https://example.com')).toBe(true);
  });

  it('allows the internal new tab URL', () => {
    expect(isAllowedUrl('mytube://newtab')).toBe(true);
  });

  it('rejects javascript: protocol', () => {
    expect(isAllowedUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejects file: protocol', () => {
    expect(isAllowedUrl('file:///etc/passwd')).toBe(false);
  });

  it('rejects data: protocol', () => {
    expect(isAllowedUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('rejects ftp: protocol', () => {
    expect(isAllowedUrl('ftp://files.example.com')).toBe(false);
  });

  it('rejects invalid URLs', () => {
    expect(isAllowedUrl('not a url')).toBe(false);
    expect(isAllowedUrl('')).toBe(false);
  });

  it('allows about:blank', () => {
    expect(isAllowedUrl('about:blank')).toBe(true);
  });
});

describe('TabManager - isSearchQuery', () => {
  it('detects queries with spaces', () => {
    expect(isSearchQuery('how to code')).toBe(true);
    expect(isSearchQuery('hello world')).toBe(true);
  });

  it('detects queries without dots or colons', () => {
    expect(isSearchQuery('javascript')).toBe(true);
    expect(isSearchQuery('react')).toBe(true);
  });

  it('treats domain-like input as non-search', () => {
    expect(isSearchQuery('google.com')).toBe(false);
    expect(isSearchQuery('example.org')).toBe(false);
  });

  it('treats URLs with protocol as non-search', () => {
    expect(isSearchQuery('https://example.com')).toBe(false);
  });

  it('treats input with colon as non-search', () => {
    expect(isSearchQuery('localhost:3000')).toBe(false);
  });
});

describe('TabManager - buildSearchUrl', () => {
  it('builds Google search URL by default', () => {
    const url = buildSearchUrl('test query');
    expect(url).toBe('https://www.google.com/search?q=test%20query');
  });

  it('builds DuckDuckGo search URL', () => {
    const url = buildSearchUrl('test query', 'duckduckgo');
    expect(url).toBe('https://duckduckgo.com/?q=test%20query');
  });

  it('builds Bing search URL', () => {
    const url = buildSearchUrl('test query', 'bing');
    expect(url).toBe('https://www.bing.com/search?q=test%20query');
  });

  it('encodes special characters', () => {
    const url = buildSearchUrl('C++ templates & generics');
    expect(url).toContain('C%2B%2B');
    expect(url).toContain('%26');
  });

  it('defaults to google for unknown engines', () => {
    const url = buildSearchUrl('test', 'yahoo' as any);
    expect(url).toContain('google.com');
  });
});

describe('TabManager - escapeHtml', () => {
  it('escapes ampersands', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes angle brackets', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  it('escapes single quotes', () => {
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('handles multiple escapes together', () => {
    expect(escapeHtml('<a href="test">&</a>')).toBe('&lt;a href=&quot;test&quot;&gt;&amp;&lt;/a&gt;');
  });

  it('leaves clean strings untouched', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });
});

describe('TabManager - getFriendlyError', () => {
  it('returns correct message for DNS error', () => {
    expect(getFriendlyError(-105)).toBe('Could Not Resolve Host');
  });

  it('returns correct message for timeout', () => {
    expect(getFriendlyError(-104)).toBe('Connection Timed Out');
  });

  it('returns correct message for no internet', () => {
    expect(getFriendlyError(-106)).toBe('No Internet Connection');
  });

  it('returns correct message for certificate errors', () => {
    expect(getFriendlyError(-200)).toBe('Certificate Error');
    expect(getFriendlyError(-201)).toBe('Certificate Date Invalid');
    expect(getFriendlyError(-202)).toBe('Certificate Authority Invalid');
  });

  it('returns generic message for unknown codes', () => {
    expect(getFriendlyError(-999)).toBe('This Page Could Not Be Loaded');
    expect(getFriendlyError(0)).toBe('This Page Could Not Be Loaded');
  });

  it('handles connection errors', () => {
    expect(getFriendlyError(-100)).toBe('Connection Closed');
    expect(getFriendlyError(-101)).toBe('Connection Reset');
    expect(getFriendlyError(-102)).toBe('Connection Refused');
    expect(getFriendlyError(-103)).toBe('Connection Failed');
  });
});

describe('TabManager - getFilenameFromUrl', () => {
  function getFilenameFromUrl(url: string): string {
    try {
      const pathname = new URL(url).pathname;
      const parts = pathname.split('/');
      return parts[parts.length - 1] || 'image';
    } catch {
      return 'image';
    }
  }

  it('extracts filename from URL', () => {
    expect(getFilenameFromUrl('https://example.com/images/photo.jpg')).toBe('photo.jpg');
  });

  it('returns "image" for root path', () => {
    expect(getFilenameFromUrl('https://example.com/')).toBe('image');
  });

  it('returns "image" for invalid URL', () => {
    expect(getFilenameFromUrl('not a url')).toBe('image');
  });

  it('extracts last path segment', () => {
    expect(getFilenameFromUrl('https://example.com/a/b/c/file.png')).toBe('file.png');
  });
});
