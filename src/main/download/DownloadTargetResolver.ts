import type { CapturedMediaFallback } from './MediaFallbackProvider';
import { isDirectMediaResourceUrl, isLikelyMediaUrl } from './MediaUrlClassifier';

export type DownloadTargetSource = 'page' | 'permalink' | 'canonical' | 'active-media' | 'captured-media';

export interface ActiveMediaSnapshot {
  canonicalUrl?: string;
  permalinkUrls?: string[];
  mediaUrl?: string;
  hasPageMediaMetadata?: boolean;
  title?: string;
}

export interface DownloadTarget {
  pageUrl: string;
  url: string;
  source: DownloadTargetSource;
  title?: string;
  fallback?: CapturedMediaFallback;
}

/**
 * Resolve the resource the user is actually looking at without trusting a
 * single signal. Platform permalinks remain the preferred yt-dlp input, while
 * direct media requests are kept as a browser-context fallback.
 */
export function resolveDownloadTarget(
  pageUrl: string,
  snapshot?: ActiveMediaSnapshot | null,
  capturedCandidates: CapturedMediaFallback[] = [],
): DownloadTarget {
  if (isLikelyMediaUrl(pageUrl) || snapshot?.hasPageMediaMetadata) {
    return { pageUrl, url: pageUrl, source: 'page', title: snapshot?.title };
  }

  for (const candidate of snapshot?.permalinkUrls || []) {
    const resolved = resolveHttpUrl(candidate, pageUrl);
    if (resolved && isLikelyMediaUrl(resolved)) {
      return { pageUrl, url: resolved, source: 'permalink', title: snapshot?.title };
    }
  }

  const canonicalUrl = resolveHttpUrl(snapshot?.canonicalUrl, pageUrl);
  if (canonicalUrl && isLikelyMediaUrl(canonicalUrl)) {
    return { pageUrl, url: canonicalUrl, source: 'canonical', title: snapshot?.title };
  }

  const mediaUrl = resolveHttpUrl(snapshot?.mediaUrl, pageUrl);
  if (mediaUrl) {
    const matchingFallback = capturedCandidates.find((candidate) => candidate.url === mediaUrl);
    return {
      pageUrl,
      url: mediaUrl,
      source: 'active-media',
      title: snapshot?.title || matchingFallback?.title,
      fallback: matchingFallback,
    };
  }

  const captured = capturedCandidates.find(isCapturedMediaCandidate);
  if (captured) {
    return {
      pageUrl,
      url: captured.url,
      source: 'captured-media',
      title: snapshot?.title || captured.title,
      fallback: captured,
    };
  }

  return { pageUrl, url: pageUrl, source: 'page', title: snapshot?.title };
}

export function rankCapturedMediaCandidates(candidates: CapturedMediaFallback[]): CapturedMediaFallback[] {
  return candidates
    .filter((candidate) => candidate.statusCode === undefined || isSuccessfulStatus(candidate.statusCode))
    .slice()
    .sort((a, b) => scoreCapturedMediaCandidate(b) - scoreCapturedMediaCandidate(a) || b.capturedAt - a.capturedAt);
}

export function scoreCapturedMediaCandidate(candidate: CapturedMediaFallback): number {
  const url = candidate.url.toLowerCase();
  const mimeType = candidate.mimeType?.toLowerCase() || '';
  let score = candidate.statusCode === undefined ? 0 : 1000;

  if (isManifest(url, mimeType)) score += 900;
  else if (mimeType.startsWith('video/')) score += 800;
  else if (/\.(?:mp4|m4v|webm|mov|mkv)(?:$|[?#])/.test(url)) score += 700;
  else if (mimeType.startsWith('audio/')) score += 300;
  else if (/\.(?:mp3|m4a|wav|flac|aac)(?:$|[?#])/.test(url)) score += 250;

  if (candidate.resourceType === 'media') score += 250;
  if ((candidate.contentLength || 0) >= 10 * 1024 * 1024) score += 350;
  else if ((candidate.contentLength || 0) >= 1024 * 1024) score += 150;

  if (/(?:^|[/_-])(?:segment|chunk|fragment|frag)[/_-]?\d*/.test(url) || /\.(?:m4s|ts|cmfv|cmfa)(?:$|[?#])/.test(url)) {
    score -= 1200;
  }
  if (/(?:doubleclick|googleadservices|adservice|\/ads?\/|tracking|beacon|pixel)/.test(url)) {
    score -= 1000;
  }

  return score;
}

function isSuccessfulStatus(statusCode: number): boolean {
  return (statusCode >= 200 && statusCode < 300) || statusCode === 304;
}

function isManifest(url: string, mimeType: string): boolean {
  return (
    /\.(?:m3u8|mpd)(?:$|[?#])/.test(url) ||
    /(?:application\/vnd\.apple\.mpegurl|application\/x-mpegurl|application\/dash\+xml)/.test(mimeType)
  );
}

function isCapturedMediaCandidate(candidate: CapturedMediaFallback): boolean {
  const mimeType = candidate.mimeType?.toLowerCase() || '';
  return (
    candidate.resourceType === 'media' ||
    isDirectMediaResourceUrl(candidate.url) ||
    mimeType.startsWith('video/') ||
    mimeType.startsWith('audio/') ||
    isManifest(candidate.url.toLowerCase(), mimeType)
  );
}

function resolveHttpUrl(candidate: string | undefined, baseUrl: string): string | null {
  if (!candidate) return null;

  try {
    const resolved = new URL(candidate, baseUrl);
    return ['http:', 'https:'].includes(resolved.protocol) ? resolved.toString() : null;
  } catch {
    return null;
  }
}
