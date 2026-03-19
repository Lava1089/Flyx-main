/**
 * Uflix Provider Module
 *
 * Wraps the uflix-extractor.ts behind the unified Provider interface.
 * Uflix returns embed URLs from 5 servers (2embed, smashy, gdrive, vidsrc, vidplus).
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
import {
  extractUflixStreams,
  fetchUflixSourceByName,
} from '../../services/uflix-extractor';

const SUPPORTED_CONTENT: ContentCategory[] = ['movie', 'tv'];

export class UflixProvider implements Provider {
  readonly name = 'uflix';
  readonly priority = 20;
  readonly enabled = true;

  supportsContent(mediaType: MediaType, _metadata?: { isAnime?: boolean; isLive?: boolean }): boolean {
    if (mediaType === 'movie') return SUPPORTED_CONTENT.includes('movie');
    if (mediaType === 'tv') return SUPPORTED_CONTENT.includes('tv');
    return false;
  }

  async extract(request: ExtractionRequest): Promise<ExtractionResult> {
    const start = Date.now();
    try {
      const result = await extractUflixStreams(
        request.tmdbId,
        request.mediaType,
        request.season,
        request.episode,
      );
      return {
        success: result.success,
        sources: (result.sources || []).map(s => this.normalizeSource(s)),
        subtitles: (result.subtitles || []).map(sub => ({
          label: sub.label,
          url: sub.url,
          language: sub.language,
        })),
        provider: this.name,
        error: result.error,
        timing: Date.now() - start,
      };
    } catch (err: any) {
      return {
        success: false,
        sources: [],
        subtitles: [],
        provider: this.name,
        error: err.message || 'Uflix extraction failed',
        timing: Date.now() - start,
      };
    }
  }

  async fetchSourceByName(sourceName: string, request: ExtractionRequest): Promise<StreamSource | null> {
    try {
      const source = await fetchUflixSourceByName(
        sourceName,
        request.tmdbId,
        request.mediaType,
        request.season,
        request.episode,
      );
      return source ? this.normalizeSource(source) : null;
    } catch {
      return null;
    }
  }

  getConfig(): ProviderConfig {
    return {
      name: this.name,
      priority: this.priority,
      enabled: this.enabled,
      supportedContent: [...SUPPORTED_CONTENT],
    };
  }

  private normalizeSource(s: any): StreamSource {
    return {
      url: s.url,
      quality: s.quality || 'auto',
      type: s.type || 'hls',
      title: s.title,
      language: s.language,
      server: s.server,
      referer: s.referer,
      requiresSegmentProxy: s.requiresSegmentProxy ?? false,
      skipOrigin: s.skipOrigin,
      ...(s.status && { status: s.status }),
    };
  }
}
