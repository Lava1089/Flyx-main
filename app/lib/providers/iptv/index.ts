/**
 * IPTV Provider Module
 *
 * Wraps IPTV Stalker portal logic behind the unified Provider interface.
 * IPTV streams are routed through the RPI proxy for residential IP access.
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
import { getIPTVStreamProxyUrl } from '../../proxy-config';

const SUPPORTED_CONTENT: ContentCategory[] = ['iptv'];

export class IPTVProvider implements Provider {
  readonly name = 'iptv';
  readonly priority = 130;
  readonly enabled = true;

  supportsContent(_mediaType: MediaType, metadata?: { isAnime?: boolean; isLive?: boolean }): boolean {
    return metadata?.isLive === true;
  }

  async extract(request: ExtractionRequest): Promise<ExtractionResult> {
    const start = Date.now();
    try {
      // For IPTV, tmdbId is used as the stream URL
      const proxyUrl = getIPTVStreamProxyUrl(request.tmdbId);
      if (!proxyUrl) {
        return {
          success: false,
          sources: [],
          subtitles: [],
          provider: this.name,
          error: 'IPTV proxy not configured',
          timing: Date.now() - start,
        };
      }
      return {
        success: true,
        sources: [{
          url: proxyUrl,
          quality: 'auto',
          type: 'hls',
          title: 'IPTV',
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
        error: err.message || 'IPTV extraction failed',
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
