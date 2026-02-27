/**
 * AnimeKai Provider Module
 *
 * Wraps the existing animekai-extractor.ts logic behind the unified Provider interface.
 * Requirements: 1.1, 1.6, 1.7, 2.1
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
  extractAnimeKaiStreams,
  fetchAnimeKaiSourceByName,
  ANIMEKAI_ENABLED,
} from '../../services/animekai-extractor';

const SUPPORTED_CONTENT: ContentCategory[] = ['anime'];

export class AnimeKaiProvider implements Provider {
  readonly name = 'animekai';
  readonly priority = 30;
  readonly enabled = ANIMEKAI_ENABLED;

  supportsContent(mediaType: MediaType, metadata?: { isAnime?: boolean; isLive?: boolean }): boolean {
    // AnimeKai only handles anime content
    if (metadata?.isAnime) return true;
    // Without metadata, anime content comes through as movie/tv — rely on caller to set isAnime
    return false;
  }

  async extract(request: ExtractionRequest): Promise<ExtractionResult> {
    const start = Date.now();
    try {
      const result = await extractAnimeKaiStreams(
        request.tmdbId,
        request.mediaType,
        request.season,
        request.episode,
        request.malId,
        request.malTitle,
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
        error: err.message || 'AnimeKai extraction failed',
        timing: Date.now() - start,
      };
    }
  }

  async fetchSourceByName(sourceName: string, request: ExtractionRequest): Promise<StreamSource | null> {
    try {
      const source = await fetchAnimeKaiSourceByName(
        sourceName,
        request.tmdbId,
        request.mediaType,
        request.season,
        request.episode,
        request.malId,
        request.malTitle,
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
    };
  }
}
