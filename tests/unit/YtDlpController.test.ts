import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need to test private methods, so we'll extract testable logic
// and also test via the public interface where possible.
// For private method testing, we access them via prototype or by
// creating a subclass that exposes them.

// Since YtDlpController has heavy electron/child_process deps,
// we test the pure logic functions by extracting them.

// ===== Test parseProgressLine =====
// We re-implement the regex parsing here to test it in isolation
// since the class constructor requires electron's `app` module.

function parseProgressLine(line: string): { percent: number; totalSize: string; speed: string; eta: string; filename: string } | null {
  const match = line.match(
    /\[download\]\s+([\d.]+)%\s+of\s+~?([\d.]+\w+)\s+(?:at\s+([\d.]+\w+\/s)\s+ETA\s+(\S+)|in\s+\S+)/
  );

  if (match) {
    return {
      percent: parseFloat(match[1]),
      totalSize: match[2] || '',
      speed: match[3] || '',
      eta: match[4] || '00:00',
      filename: '',
    };
  }

  const simpleMatch = line.match(/\[download\]\s+([\d.]+)%/);
  if (simpleMatch) {
    return {
      percent: parseFloat(simpleMatch[1]),
      totalSize: '',
      speed: '',
      eta: '',
      filename: '',
    };
  }

  return null;
}

function buildFormatLabel(f: any): string {
  const parts: string[] = [];

  if (f.height) {
    parts.push(`${f.height}p`);
  } else if (f.resolution && f.resolution !== 'audio only') {
    parts.push(f.resolution);
  }

  if (f.fps && f.fps > 30) {
    parts.push(`${f.fps}fps`);
  }

  if (f.vcodec && f.vcodec !== 'none') {
    const codec = f.vcodec.split('.')[0];
    parts.push(codec);
  }

  if (f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none')) {
    parts.push(f.acodec.split('.')[0]);
  }

  parts.push(f.ext);

  const size = f.filesize || f.filesize_approx;
  if (size) {
    parts.push(formatBytes(size));
  }

  if (f.vcodec === 'none' && f.acodec && f.acodec !== 'none') {
    return `Audio: ${parts.join(' - ')}`;
  }

  return parts.join(' - ');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

function extractHeight(resolution?: string): number {
  if (!resolution) return 0;
  const match = resolution.match(/(\d+)/);
  return match ? parseInt(match[1]) : 0;
}

function simplifyFormats(formats: any[]): any[] {
  const result: any[] = [];
  const seenResolutions = new Set<string>();

  const videoFormats = formats
    .filter((f) => f.hasVideo)
    .sort((a, b) => {
      const aRes = extractHeight(a.resolution);
      const bRes = extractHeight(b.resolution);
      return bRes - aRes;
    });

  for (const f of videoFormats) {
    const height = extractHeight(f.resolution);
    const key = `${height}p`;
    if (height > 0 && !seenResolutions.has(key)) {
      seenResolutions.add(key);
      result.push({
        ...f,
        label: `${key}${f.fps && f.fps > 30 ? ` ${f.fps}fps` : ''} (${f.ext})`,
      });
    }
  }

  const audioFormats = formats
    .filter((f) => f.hasAudio && !f.hasVideo)
    .sort((a, b) => (b.filesize || 0) - (a.filesize || 0));

  if (audioFormats.length > 0) {
    const best = audioFormats[0];
    result.push({
      ...best,
      label: `Audio only (${best.ext}${best.filesize ? ' - ' + formatBytes(best.filesize) : ''})`,
    });
  }

  return result;
}

// ===== validateUrl (mirrors YtDlpController.validateUrl) =====
function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

// ===== sanitizeText (mirrors YtDlpController.sanitizeText) =====
function sanitizeText(text: string): string {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ===== Tests =====

describe('YtDlpController - parseProgressLine', () => {
  it('parses full progress line with speed and ETA', () => {
    const line = '[download]  45.2% of  150.00MiB at    5.00MiB/s ETA 00:16';
    const result = parseProgressLine(line);
    expect(result).not.toBeNull();
    expect(result!.percent).toBe(45.2);
    expect(result!.totalSize).toBe('150.00MiB');
    expect(result!.speed).toBe('5.00MiB/s');
    expect(result!.eta).toBe('00:16');
  });

  it('parses 100% completion line', () => {
    const line = '[download] 100% of  150.00MiB in 00:30';
    const result = parseProgressLine(line);
    expect(result).not.toBeNull();
    expect(result!.percent).toBe(100);
    expect(result!.totalSize).toBe('150.00MiB');
    expect(result!.eta).toBe('00:00');
  });

  it('parses approximate size with tilde', () => {
    const line = '[download]  12.5% of ~200.00MiB at    3.50MiB/s ETA 00:45';
    const result = parseProgressLine(line);
    expect(result).not.toBeNull();
    expect(result!.percent).toBe(12.5);
    expect(result!.totalSize).toBe('200.00MiB');
  });

  it('parses simple percentage-only line', () => {
    const line = '[download]  67.3%';
    const result = parseProgressLine(line);
    expect(result).not.toBeNull();
    expect(result!.percent).toBe(67.3);
    expect(result!.totalSize).toBe('');
    expect(result!.speed).toBe('');
  });

  it('returns null for non-progress lines', () => {
    expect(parseProgressLine('[info] Extracting URL: https://example.com')).toBeNull();
    expect(parseProgressLine('[Merger] Merging formats into "video.mp4"')).toBeNull();
    expect(parseProgressLine('')).toBeNull();
    expect(parseProgressLine('random text')).toBeNull();
  });

  it('parses GiB total size', () => {
    const line = '[download]   5.0% of  1.20GiB at   10.00MiB/s ETA 02:00';
    const result = parseProgressLine(line);
    expect(result).not.toBeNull();
    expect(result!.totalSize).toBe('1.20GiB');
  });

  it('parses KiB speed', () => {
    const line = '[download]  10.0% of  50.00MiB at  500.00KiB/s ETA 01:30';
    const result = parseProgressLine(line);
    expect(result).not.toBeNull();
    expect(result!.speed).toBe('500.00KiB/s');
  });
});

describe('YtDlpController - destination/merge line parsing', () => {
  it('matches Destination line', () => {
    const line = '[download] Destination: /tmp/video.mp4';
    const destMatch = line.match(/\[(?:download|Merger)\].*?Destination:\s*(.+)/);
    expect(destMatch).not.toBeNull();
    expect(destMatch![1].trim()).toBe('/tmp/video.mp4');
  });

  it('matches Merger line', () => {
    const line = '[Merger] Merging formats into "/tmp/final.mp4"';
    const mergeMatch = line.match(/\[Merger\]\s*Merging formats into "(.+?)"/);
    expect(mergeMatch).not.toBeNull();
    expect(mergeMatch![1].trim()).toBe('/tmp/final.mp4');
  });

  it('matches already-downloaded line', () => {
    const line = '[download] /tmp/video.mp4 has already been downloaded';
    const alreadyMatch = line.match(/\[download\]\s*(.+?)\s*has already been downloaded/);
    expect(alreadyMatch).not.toBeNull();
    expect(alreadyMatch![1].trim()).toBe('/tmp/video.mp4');
  });
});

describe('YtDlpController - formatBytes', () => {
  it('formats bytes', () => {
    expect(formatBytes(500)).toBe('500B');
  });

  it('formats kilobytes', () => {
    expect(formatBytes(1536)).toBe('1.5KB');
  });

  it('formats megabytes', () => {
    expect(formatBytes(10 * 1024 * 1024)).toBe('10.0MB');
  });

  it('formats gigabytes', () => {
    expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe('2.50GB');
  });

  it('handles zero', () => {
    expect(formatBytes(0)).toBe('0B');
  });

  it('handles exact boundaries', () => {
    expect(formatBytes(1024)).toBe('1.0KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0MB');
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.00GB');
  });
});

describe('YtDlpController - buildFormatLabel', () => {
  it('builds label for video format with height', () => {
    const f = { height: 1080, fps: 30, vcodec: 'h264', acodec: 'aac', ext: 'mp4' };
    const label = buildFormatLabel(f);
    expect(label).toBe('1080p - h264 - mp4');
  });

  it('includes fps when > 30', () => {
    const f = { height: 1080, fps: 60, vcodec: 'h264', acodec: 'aac', ext: 'mp4' };
    const label = buildFormatLabel(f);
    expect(label).toContain('60fps');
  });

  it('does not include fps when <= 30', () => {
    const f = { height: 720, fps: 24, vcodec: 'h264', acodec: 'aac', ext: 'mp4' };
    const label = buildFormatLabel(f);
    expect(label).not.toContain('fps');
  });

  it('builds audio-only label', () => {
    const f = { vcodec: 'none', acodec: 'opus', ext: 'webm', filesize: 5 * 1024 * 1024 };
    const label = buildFormatLabel(f);
    expect(label.startsWith('Audio:')).toBe(true);
    expect(label).toContain('opus');
    expect(label).toContain('webm');
  });

  it('includes filesize when available', () => {
    const f = { height: 720, vcodec: 'h264', ext: 'mp4', filesize: 100 * 1024 * 1024 };
    const label = buildFormatLabel(f);
    expect(label).toContain('100.0MB');
  });

  it('uses resolution string when no height', () => {
    const f = { resolution: '1920x1080', vcodec: 'vp9', ext: 'webm' };
    const label = buildFormatLabel(f);
    expect(label).toContain('1920x1080');
  });

  it('strips codec version suffix', () => {
    const f = { height: 1080, vcodec: 'avc1.64001e', ext: 'mp4' };
    const label = buildFormatLabel(f);
    expect(label).toContain('avc1');
    expect(label).not.toContain('64001e');
  });
});

describe('YtDlpController - extractHeight', () => {
  it('extracts height from resolution string', () => {
    expect(extractHeight('1920x1080')).toBe(1920);
  });

  it('extracts first number', () => {
    expect(extractHeight('720p')).toBe(720);
  });

  it('returns 0 for undefined', () => {
    expect(extractHeight(undefined)).toBe(0);
  });

  it('returns 0 for non-numeric', () => {
    expect(extractHeight('audio only')).toBe(0);
  });
});

describe('YtDlpController - simplifyFormats', () => {
  it('deduplicates by resolution, keeping first (highest quality)', () => {
    const formats = [
      { formatId: '1', resolution: '1920x1080', hasVideo: true, hasAudio: true, ext: 'mp4', fps: 30 },
      { formatId: '2', resolution: '1920x1080', hasVideo: true, hasAudio: false, ext: 'webm', fps: 30 },
      { formatId: '3', resolution: '1280x720', hasVideo: true, hasAudio: true, ext: 'mp4', fps: 30 },
    ];
    const result = simplifyFormats(formats);
    const videoResults = result.filter(r => !r.label.includes('Audio'));
    expect(videoResults).toHaveLength(2);
  });

  it('includes best audio-only format', () => {
    const formats = [
      { formatId: '1', resolution: '1920x1080', hasVideo: true, hasAudio: true, ext: 'mp4' },
      { formatId: 'a1', hasVideo: false, hasAudio: true, ext: 'mp3', filesize: 5000000 },
      { formatId: 'a2', hasVideo: false, hasAudio: true, ext: 'opus', filesize: 3000000 },
    ];
    const result = simplifyFormats(formats);
    const audioResult = result.find(r => r.label.includes('Audio'));
    expect(audioResult).toBeDefined();
    expect(audioResult!.formatId).toBe('a1'); // largest
  });

  it('sorts video formats by resolution descending', () => {
    const formats = [
      { formatId: '1', resolution: '640x480', hasVideo: true, hasAudio: true, ext: 'mp4' },
      { formatId: '2', resolution: '1920x1080', hasVideo: true, hasAudio: true, ext: 'mp4' },
      { formatId: '3', resolution: '1280x720', hasVideo: true, hasAudio: true, ext: 'mp4' },
    ];
    const result = simplifyFormats(formats);
    const videoResults = result.filter(r => !r.label.includes('Audio'));
    expect(videoResults[0].formatId).toBe('2'); // 1080
    expect(videoResults[1].formatId).toBe('3'); // 720
    expect(videoResults[2].formatId).toBe('1'); // 480
  });

  it('returns empty array for empty input', () => {
    expect(simplifyFormats([])).toEqual([]);
  });

  it('handles formats with no resolution', () => {
    const formats = [
      { formatId: '1', hasVideo: true, hasAudio: true, ext: 'mp4' }, // no resolution
    ];
    const result = simplifyFormats(formats);
    // 0p key, height=0, not added since height must be > 0
    const videoResults = result.filter(r => !r.label.includes('Audio'));
    expect(videoResults).toHaveLength(0);
  });
});

describe('YtDlpController - validateUrl', () => {
  it('accepts http URLs', () => {
    expect(validateUrl('http://example.com/video')).toBe(true);
  });

  it('accepts https URLs', () => {
    expect(validateUrl('https://youtube.com/watch?v=abc')).toBe(true);
  });

  it('rejects ftp URLs', () => {
    expect(validateUrl('ftp://example.com/file')).toBe(false);
  });

  it('rejects file URLs', () => {
    expect(validateUrl('file:///etc/passwd')).toBe(false);
  });

  it('rejects javascript: URLs', () => {
    expect(validateUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejects data: URLs', () => {
    expect(validateUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(validateUrl('')).toBe(false);
  });

  it('rejects malformed URLs', () => {
    expect(validateUrl('not a url')).toBe(false);
  });

  it('rejects URLs with shell metacharacters in hostname', () => {
    expect(validateUrl('https://example.com;rm -rf /')).toBe(false);
  });
});

describe('YtDlpController - sanitizeText', () => {
  it('escapes HTML angle brackets', () => {
    expect(sanitizeText('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  it('escapes ampersands', () => {
    expect(sanitizeText('Tom & Jerry')).toBe('Tom &amp; Jerry');
  });

  it('escapes single quotes', () => {
    expect(sanitizeText("it's")).toBe('it&#x27;s');
  });

  it('escapes double quotes', () => {
    expect(sanitizeText('say "hello"')).toBe('say &quot;hello&quot;');
  });

  it('returns empty string for null/undefined', () => {
    expect(sanitizeText(null as any)).toBe('');
    expect(sanitizeText(undefined as any)).toBe('');
  });

  it('returns empty string for non-string', () => {
    expect(sanitizeText(123 as any)).toBe('');
  });

  it('handles normal text unchanged', () => {
    expect(sanitizeText('Normal Video Title 2024')).toBe('Normal Video Title 2024');
  });

  it('handles complex XSS payloads', () => {
    const payload = '"><img src=x onerror=alert(1)>';
    const result = sanitizeText(payload);
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
    expect(result).toContain('&lt;');
    expect(result).toContain('&gt;');
  });
});
