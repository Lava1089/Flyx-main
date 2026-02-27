/**
 * VIPRow Provider Module
 *
 * Wraps the existing VIPRow live TV logic behind the unified Provider interface.
 * VIPRow handles live sports events via Cloudflare Worker proxy.
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
import { getVIPRowStream } from '../../livetv/source-providers';

const SUPPORTED_CONTENT: ContentCategory[] = ['live-sports'];

export class VIPRowProvider implements Provider {
  readonly name = 'viprow';
  readonly priority = 110;
  readonly enabled = true;

  supportsContent(_mediaType: MediaType, metadata?: { isAnime?: boolean; isLive?: boolean }): boolean {
    return metadata?.isLive === true;
  }

  async extract(request: ExtractionRequest): Promise<ExtractionResult> {
    const start = Date.now();
    try {
      // For VIPRow, tmdbId is used as the event URL
      const result = await getVIPRowStream(request.tmdbId);
      if (!result.success || !result.streamUrl) {
        return {
          success: false,
          sources: [],
          subtitles: [],
          provider: this.name,
          error: result.error || 'VIPRow stream not available',
          timing: Date.now() - start,
        };
      }
      return {
        success: true,
        sources: [{
          url: result.streamUrl,
          quality: 'auto',
          type: 'hls',
          title: 'VIPRow',
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
        error: err.message || 'VIPRow extraction failed',
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
