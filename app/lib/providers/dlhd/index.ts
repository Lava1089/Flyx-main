/**
 * DLHD Provider Module
 *
 * Wraps the existing DLHD live TV logic behind the unified Provider interface.
 * DLHD is the primary live TV source using residential IP proxy.
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
import { getDLHDStream } from '../../livetv/source-providers';

const SUPPORTED_CONTENT: ContentCategory[] = ['live-tv', 'live-sports'];

export class DLHDProvider implements Provider {
  readonly name = 'dlhd';
  readonly priority = 100;
  readonly enabled = true;

  supportsContent(_mediaType: MediaType, metadata?: { isAnime?: boolean; isLive?: boolean }): boolean {
    return metadata?.isLive === true;
  }

  async extract(request: ExtractionRequest): Promise<ExtractionResult> {
    const start = Date.now();
    try {
      // For live TV, tmdbId is used as the channel ID
      const result = await getDLHDStream(request.tmdbId);
      if (!result.success || !result.streamUrl) {
        return {
          success: false,
          sources: [],
          subtitles: [],
          provider: this.name,
          error: result.error || 'DLHD stream not available',
          timing: Date.now() - start,
        };
      }
      return {
        success: true,
        sources: [{
          url: result.streamUrl,
          quality: 'auto',
          type: 'hls',
          title: 'DLHD',
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
        error: err.message || 'DLHD extraction failed',
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
