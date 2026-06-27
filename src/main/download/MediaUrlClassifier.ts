export interface MediaUrlClassification {
  platform: string;
  isMediaPage: boolean;
  reason?: string;
}

const DIRECT_MEDIA_EXTENSIONS = /\.(?:mp4|m4v|webm|mov|mkv|mp3|m4a|wav|flac|m3u8|mpd)(?:$|[?#])/i;

export function classifyMediaUrl(url: string): MediaUrlClassification {
  try {
    const parsed = new URL(url);
    const host = normalizeHost(parsed.hostname);
    const pathname = normalizePath(parsed.pathname);

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return unsupported('unknown', 'Only http and https URLs can be downloaded.');
    }

    if (DIRECT_MEDIA_EXTENSIONS.test(`${pathname}${parsed.search}`)) {
      return media('direct');
    }

    if (isYouTubeHost(host)) {
      return classifyYouTubeUrl(host, pathname, parsed);
    }

    if (host === 'instagram.com') {
      return classifyInstagramUrl(pathname);
    }

    if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) {
      return classifyTikTokUrl(pathname);
    }

    if (host === 'twitter.com' || host === 'x.com') {
      return classifyStatusUrl('x', pathname);
    }

    if (host === 'facebook.com' || host === 'fb.watch' || host.endsWith('.facebook.com')) {
      return classifyFacebookUrl(host, pathname, parsed);
    }

    if (host === 'reddit.com' || host.endsWith('.reddit.com')) {
      return classifyRedditUrl(pathname);
    }

    if (host === 'vimeo.com' || host.endsWith('.vimeo.com')) {
      return classifyPathBasedPlatform('vimeo', pathname, /^\/(?:\d+|channels\/[^/]+\/\d+|groups\/[^/]+\/videos\/\d+)/);
    }

    if (host === 'dailymotion.com' || host.endsWith('.dailymotion.com')) {
      return classifyPathBasedPlatform('dailymotion', pathname, /^\/video\/[^/]+/);
    }

    if (host === 'twitch.tv' || host.endsWith('.twitch.tv')) {
      return classifyPathBasedPlatform('twitch', pathname, /^\/(?:videos\/\d+|[^/]+\/clip\/[^/]+|clip\/[^/]+)/);
    }

    if (host === 'rumble.com' || host.endsWith('.rumble.com')) {
      return classifyPathBasedPlatform('rumble', pathname, /^\/v[^/]+/);
    }

    if (host === 'bilibili.com' || host.endsWith('.bilibili.com')) {
      return classifyPathBasedPlatform('bilibili', pathname, /^\/video\/[^/]+/);
    }

    if (host === 'odysee.com' || host.endsWith('.odysee.com')) {
      return classifyPathBasedPlatform('odysee', pathname, /^\/@[^/]+\/[^/]+/);
    }

    if (host === 'soundcloud.com' || host.endsWith('.soundcloud.com')) {
      return classifyTrackLikeUrl('soundcloud', pathname);
    }

    if (host === 'bandcamp.com' || host.endsWith('.bandcamp.com')) {
      return classifyPathBasedPlatform('bandcamp', pathname, /^\/track\/[^/]+/);
    }

    return unsupported('unknown', 'This page is not recognized as a downloadable media page.');
  } catch {
    return unsupported('unknown', 'Invalid URL.');
  }
}

export function isLikelyMediaUrl(url: string): boolean {
  return classifyMediaUrl(url).isMediaPage;
}

function classifyYouTubeUrl(host: string, pathname: string, parsed: URL): MediaUrlClassification {
  if (host === 'youtu.be') {
    return pathname.length > 1 ? media('youtube') : unsupported('youtube', 'Open a specific YouTube video first.');
  }

  if (pathname === '/watch' && parsed.searchParams.has('v')) {
    return media('youtube');
  }

  if (/^\/(?:shorts|live)\/[^/]+/.test(pathname)) {
    return media('youtube');
  }

  return unsupported('youtube', 'Open a specific YouTube video, Short, or live URL first.');
}

function classifyInstagramUrl(pathname: string): MediaUrlClassification {
  if (/^\/(?:p|reel|reels|tv)\/[^/]+/.test(pathname)) {
    return media('instagram');
  }

  if (/^\/stories\/[^/]+\/\d+/.test(pathname)) {
    return media('instagram');
  }

  return unsupported('instagram', 'Open a specific Instagram post, reel, story, or video first.');
}

function classifyTikTokUrl(pathname: string): MediaUrlClassification {
  if (/^\/@[^/]+\/video\/\d+/.test(pathname) || /^\/(?:t|v|embed\/v2)\/[^/]+/.test(pathname)) {
    return media('tiktok');
  }

  return unsupported('tiktok', 'Open a specific TikTok video first.');
}

function classifyStatusUrl(platform: string, pathname: string): MediaUrlClassification {
  if (/^\/(?:i\/)?[^/]+\/status\/\d+/.test(pathname) || /^\/i\/status\/\d+/.test(pathname)) {
    return media(platform);
  }

  return unsupported(platform, 'Open a specific post/status URL first.');
}

function classifyFacebookUrl(host: string, pathname: string, parsed: URL): MediaUrlClassification {
  if (host === 'fb.watch' && pathname.length > 1) {
    return media('facebook');
  }

  if (parsed.searchParams.has('v') && pathname === '/watch') {
    return media('facebook');
  }

  if (/^\/(?:reel|watch|share\/v|[^/]+\/videos)\/[^/]+/.test(pathname)) {
    return media('facebook');
  }

  return unsupported('facebook', 'Open a specific Facebook watch, reel, or video URL first.');
}

function classifyRedditUrl(pathname: string): MediaUrlClassification {
  if (/^\/(?:r\/[^/]+\/)?comments\/[^/]+/.test(pathname) || /^\/r\/[^/]+\/comments\/[^/]+/.test(pathname)) {
    return media('reddit');
  }

  return unsupported('reddit', 'Open a specific Reddit post first.');
}

function classifyPathBasedPlatform(platform: string, pathname: string, pattern: RegExp): MediaUrlClassification {
  return pattern.test(pathname)
    ? media(platform)
    : unsupported(platform, `Open a specific ${platform} media URL first.`);
}

function classifyTrackLikeUrl(platform: string, pathname: string): MediaUrlClassification {
  const parts = pathname.split('/').filter(Boolean);
  return parts.length >= 2 ? media(platform) : unsupported(platform, `Open a specific ${platform} track URL first.`);
}

function normalizeHost(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/^m\./, '');
}

function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/';
}

function media(platform: string): MediaUrlClassification {
  return { platform, isMediaPage: true };
}

function unsupported(platform: string, reason: string): MediaUrlClassification {
  return { platform, isMediaPage: false, reason };
}

function isYouTubeHost(host: string): boolean {
  return host === 'youtube.com' || host === 'youtu.be';
}
