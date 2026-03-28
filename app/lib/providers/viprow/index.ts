/**
 * VIPRow Provider Module (Legacy — delegates to PPV)
 *
 * VIPRow has been replaced by PPV.to for live sports events.
 * This module is kept for registry compatibility but uses getPPVStream.
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
import { getPPVStream } from '../../livetv/source-providers';

const SUPPORTED_CONTENT: ContentCategory[] = ['live-sports'];

export class VIPRowProvider implements Provider {
  readonly name = 'viprow';
  readonly priority = 110;
  readonly enabled = false; // Disabled — PPV provider handles live events now

  supportsContent(_mediaType: MediaType, metadata?: { isAnime?: boolean; isLive?: boolean }): boolean {
    return metadata?.isLive === true;
  }

  async extract(request: ExtractionRequest): Promise<ExtractionResult> {
    const start = Date.now();
    try {
      const result = await getPPVStream(request.tmdbId);
      if (!result.success || !result.streamUrl) {
        return {
          success: false,
          sources: [],
          subtitles: [],
          provider: this.name,
          error: result.error || 'Stream not available',
          timing: Date.now() - start,
        };
      }
      return {
        success: true,
        sources: [{
          url: result.streamUrl,
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
        error: err.message || 'Extraction failed',
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
