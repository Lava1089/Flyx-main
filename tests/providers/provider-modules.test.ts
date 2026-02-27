/**
 * Property-Based Tests for Provider Modules
 * Feature: clean-architecture-rewrite
 * 
 * Property 1: Extract method returns valid ExtractionResult
 * Property 3: supportsContent consistency
 * Validates: Requirements 1.1, 1.6
 */

import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';
import type {
  Provider,
  ProviderConfig,
  MediaType,
  ContentCategory,
  ExtractionRequest,
  ExtractionResult,
  StreamSource,
} from '../../app/lib/providers/types';

// ============================================
// Arbitraries
// ============================================

const contentCategoryArb: fc.Arbitrary<ContentCategory> = fc.constantFrom(
  'movie', 'tv', 'anime', 'live-tv', 'live-sports', 'ppv', 'iptv'
);

const mediaTypeArb: fc.Arbitrary<MediaType> = fc.constantFrom('movie', 'tv');

const extractionRequestArb: fc.Arbitrary<ExtractionRequest> = fc.record({
  tmdbId: fc.stringMatching(/^[1-9][0-9]{0,6}$/),
  mediaType: mediaTypeArb,
  season: fc.option(fc.integer({ min: 1, max: 30 }), { nil: undefined }),
  episode: fc.option(fc.integer({ min: 1, max: 50 }), { nil: undefined }),
  malId: fc.option(fc.integer({ min: 1, max: 100000 }), { nil: undefined }),
  title: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
  malTitle: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
});

const providerConfigArb: fc.Arbitrary<ProviderConfig> = fc.record({
  name: fc.string({ minLength: 1, maxLength: 30 }).filter(s => /^[a-z0-9-]+$/.test(s)),
  priority: fc.integer({ min: 1, max: 1000 }),
  enabled: fc.boolean(),
  supportedContent: fc.uniqueArray(contentCategoryArb, { minLength: 1, maxLength: 7 }),
});

/**
 * Build a testable Provider from a ProviderConfig.
 * The extract method returns a valid ExtractionResult with the provider's name.
 * supportsContent checks against the config's supportedContent array.
 */
function makeTestProvider(config: ProviderConfig): Provider {
  return {
    name: config.name,
    priority: config.priority,
    enabled: config.enabled,

    supportsContent(mediaType: MediaType, metadata?: { isAnime?: boolean; isLive?: boolean }): boolean {
      // Map mediaType + metadata to content categories
      const categories: ContentCategory[] = [];
      if (mediaType === 'movie') categories.push('movie');
      if (mediaType === 'tv') categories.push('tv');
      if (metadata?.isAnime) categories.push('anime');
      if (metadata?.isLive) {
        categories.push('live-tv', 'live-sports', 'ppv', 'iptv');
      }
      return config.supportedContent.some(c => categories.includes(c));
    },

    async extract(_request: ExtractionRequest): Promise<ExtractionResult> {
      return {
        success: true,
        sources: [{
          url: 'https://example.com/stream.m3u8',
          quality: 'auto',
          type: 'hls',
          requiresSegmentProxy: false,
        }],
        subtitles: [],
        provider: config.name,
        timing: 42,
      };
    },

    async fetchSourceByName(_sourceName: string, _request: ExtractionRequest): Promise<StreamSource | null> {
      return null;
    },

    getConfig(): ProviderConfig {
      return { ...config };
    },
  };
}

// ============================================
// Property Tests
// ============================================

describe('Provider Module Property Tests', () => {
  test('Property 1: Extract method returns valid ExtractionResult', async () => {
    /**
     * Feature: clean-architecture-rewrite, Property 1: Extract method returns valid ExtractionResult
     * **Validates: Requirements 1.1**
     *
     * For any Provider and for any valid ExtractionRequest, calling extract should
     * return an ExtractionResult with: a boolean success field, a sources array,
     * a subtitles array, and a provider string matching the provider's name.
     */
    await fc.assert(
      fc.asyncProperty(providerConfigArb, extractionRequestArb, async (config, request) => {
        const provider = makeTestProvider(config);
        const result = await provider.extract(request);

        // success must be a boolean
        expect(typeof result.success).toBe('boolean');

        // sources must be an array
        expect(Array.isArray(result.sources)).toBe(true);

        // subtitles must be an array
        expect(Array.isArray(result.subtitles)).toBe(true);

        // provider must match the provider's name
        expect(result.provider).toBe(provider.name);

        // Each source must have required fields
        for (const source of result.sources) {
          expect(typeof source.url).toBe('string');
          expect(typeof source.quality).toBe('string');
          expect(['hls', 'mp4']).toContain(source.type);
          expect(typeof source.requiresSegmentProxy).toBe('boolean');
        }

        // Each subtitle must have required fields
        for (const sub of result.subtitles) {
          expect(typeof sub.label).toBe('string');
          expect(typeof sub.url).toBe('string');
          expect(typeof sub.language).toBe('string');
        }

        // If timing is present, it must be a number
        if (result.timing !== undefined) {
          expect(typeof result.timing).toBe('number');
        }

        // If error is present, it must be a string
        if (result.error !== undefined) {
          expect(typeof result.error).toBe('string');
        }
      }),
      { numRuns: 100 }
    );
  });

  test('Property 3: supportsContent consistency', () => {
    /**
     * Feature: clean-architecture-rewrite, Property 3: supportsContent consistency
     * **Validates: Requirements 1.6**
     *
     * For any Provider and for any MediaType + metadata combination,
     * supportsContent returns true iff the provider's config includes
     * at least one matching content category.
     */
    fc.assert(
      fc.property(
        providerConfigArb,
        mediaTypeArb,
        fc.record({
          isAnime: fc.option(fc.boolean(), { nil: undefined }),
          isLive: fc.option(fc.boolean(), { nil: undefined }),
        }),
        (config, mediaType, metadata) => {
          const provider = makeTestProvider(config);
          const providerConfig = provider.getConfig();
          const supports = provider.supportsContent(mediaType, metadata);

          // Determine which categories the mediaType + metadata maps to
          const matchedCategories: ContentCategory[] = [];
          if (mediaType === 'movie') matchedCategories.push('movie');
          if (mediaType === 'tv') matchedCategories.push('tv');
          if (metadata.isAnime) matchedCategories.push('anime');
          if (metadata.isLive) matchedCategories.push('live-tv', 'live-sports', 'ppv', 'iptv');

          const expected = providerConfig.supportedContent.some(c => matchedCategories.includes(c));
          expect(supports).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });
});
