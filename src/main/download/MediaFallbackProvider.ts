import type { DownloadTarget } from './DownloadTargetResolver';

export interface CapturedMediaFallback {
  url: string;
  pageUrl: string;
  title?: string;
  requestHeaders?: Record<string, string>;
  resourceType?: string;
  statusCode?: number;
  mimeType?: string;
  contentLength?: number;
  capturedAt: number;
}

export interface MediaFallbackProvider {
  resolveDownloadTarget(pageUrl: string): Promise<DownloadTarget>;
  getMediaFallbackForPage(pageUrl: string): CapturedMediaFallback | null;
}
