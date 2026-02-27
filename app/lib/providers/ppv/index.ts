/**
 * PPV Provider Module
 *
 * Wraps PPV (Pay-Per-View) live event logic behind the unified Provider interface.
 * PPV events are routed through the RPI proxy and CF Worker.
 * Requirements: 1.1, 1.6, 1.7, 2.1, 8.2
 */

import type {
  Provider,
  ProviderConfig,
  ExtractionRequest,
  ExtractionResult,
  StreamSource,
  MediaType,
  ContentCategory,
} from '../types';

const SUPPORTED_CONTENT: ContentCategory[] = ['ppv'];

export class PPVProvider implements Provider {
  readonly name = 'ppv';
  readonly priority = 120;
  readonly enabled = true;

  supportsContent(_mediaType: MediaType, metadata?: { isAnime?: boolean; isLive?: boolean }): boolean {
    return metadata?.isLive === true;
  }

  async extract(request: ExtractionRequest): Promise<ExtractionResult> {
    const start = Date.now();
    try {
      // PPV streams are fetched via the CF Worker /ppv endpoint
      const cfProxyUrl = process.env.NEXT_PUBLIC_CF_STREAM_PROXY_URL;
      if (!cfProxyUrl) {
        return {
          success: false,
          sources: [],
          subtitles: [],
          provider: this.name,
          error: 'CF proxy URL not configured for PPV',
          timing: Date.now() - start,
        };
      }
      const baseUrl = cfProxyUrl.replace(/\/stream\/?$/, '');
      const streamUrl = `${baseUrl}/ppv/stream?id=${encodeURIComponent(request.tmdbId)}`;

      return {
        success: true,
        sources: [{
          url: streamUrl,
          quality: 'auto',
          type: 'hls',
          title: 'PPV',
          requiresSegmentProxy: false,
        }],
        subtitles: [],
        provider: this.name,
        timing: Date.now() - start,
      };
    } catch (err: any) {
      return {
        success: false,
        sources: [],
        subtitles: [],
        provider: this.name,
        error: err.message || 'PPV extraction failed',
        timing: Date.now() - start,
      };
    }
  }

  async fetchSourceByName(_sourceName: string, request: ExtractionRequest): Promise<StreamSource | null> {
    const result = await this.extract(request);
    return result.sources[0] || null;
  }

  getConfig(): ProviderConfig {
    return {
      name: this.name,
      priority: this.priority,
      enabled: this.enabled,
      supportedContent: [...SUPPORTED_CONTENT],
    };
  }
}
