export interface CapturedMediaFallback {
  url: string;
  pageUrl: string;
  title?: string;
  requestHeaders?: Record<string, string>;
  resourceType?: string;
  capturedAt: number;
}

export interface MediaFallbackProvider {
  getMediaFallbackForPage(pageUrl: string): CapturedMediaFallback | null;
}
