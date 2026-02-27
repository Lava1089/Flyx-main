/**
 * CDN-Live Provider Module
 *
 * Wraps the existing CDN-Live extractor behind the unified Provider interface.
 * CDN-Live decodes HUNTER obfuscation from player pages to extract M3U8 URLs.
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
import { getCDNLiveStream } from '../../livetv/source-providers';

const SUPPORTED_CONTENT: ContentCategory[] = ['live-tv'];

export class CDNLiveProvider implements Provider {
  readonly name = 'cdn-live';
  readonly priority = 105;
  readonly enabled = true;

  supportsContent(_mediaType: MediaType, metadata?: { isAnime?: boolean; isLive?: boolean }): boolean {
    return metadata?.isLive === true;
  }

  async extract(request: ExtractionRequest): Promise<ExtractionResult> {
    const start = Date.now();
    try {
      // For CDN-Live, tmdbId is used as the channel name/ID
      const result = await getCDNLiveStream(request.tmdbId);
      if (!result.success || !result.streamUrl) {
        return {
          success: false,
          sources: [],
          subtitles: [],
          provider: this.name,
          error: result.error || 'CDN-Live stream not available',
          timing: Date.now() - start,
        };
      }
      return {
        success: true,
        sources: [{
          url: result.streamUrl,
          quality: 'auto',
          type: 'hls',
          title: 'CDN-Live',
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
        error: err.message || 'CDN-Live extraction failed',
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
