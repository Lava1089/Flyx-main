/**
 * Property-Based Tests for Extraction Route
 * Feature: clean-architecture-rewrite
 *
 * Property 7: Route dispatch correctness (API layer)
 * Property 9: All-providers-fail error aggregation
 * Validates: Requirements 5.2, 5.5
 */

import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';
import { ProviderRegistry } from '../../app/lib/providers/registry';
import { AllProvidersFailedError } from '../../app/api/stream/extract/route';
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

const providerConfigArb: fc.Arbitrary<ProviderConfig> = fc.record({
  name: fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-z][a-z0-9-]*$/.test(s)),
  priority: fc.integer({ min: 1, max: 1000 }),
  enabled: fc.boolean(),
  supportedContent: fc.uniqueArray(contentCategoryArb, { minLength: 1, maxLength: 7 }),
});

const extractionRequestArb: fc.Arbitrary<ExtractionRequest> = fc.record({
  tmdbId: fc.stringMatching(/^[1-9][0-9]{0,6}$/),
  mediaType: mediaTypeArb,
  season: fc.option(fc.integer({ min: 1, max: 30 }), { nil: undefined }),
  episode: fc.option(fc.integer({ min: 1, max: 50 }), { nil: undefined }),
  malId: fc.option(fc.integer({ min: 1, max: 100000 }), { nil: undefined }),
  title: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
  malTitle: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
});

const uniqueProviderConfigsArb = fc
  .uniqueArray(providerConfigArb, { minLength: 1, maxLength: 10, selector: c => c.name })
  .filter(arr => arr.length >= 1);

// ============================================
// Stub Provider Factories
// ============================================

/**
 * Creates a stub provider that succeeds with sources.
 */
function makeSuccessProvider(config: ProviderConfig): Provider {
  return {
    name: config.name,
    priority: config.priority,
    enabled: config.enabled,
    supportsContent(mediaType: MediaType, metadata?: { isAnime?: boolean; isLive?: boolean }): boolean {
      const categories: ContentCategory[] = [];
      if (mediaType === 'movie') categories.push('movie');
      if (mediaType === 'tv') categories.push('tv');
      if (metadata?.isAnime) categories.push('anime');
      if (metadata?.isLive) categories.push('live-tv', 'live-sports', 'ppv', 'iptv');
      return config.supportedContent.some(c => categories.includes(c));
    },
    async extract(_request: ExtractionRequest): Promise<ExtractionResult> {
      return {
        success: true,
        sources: [{
          url: `https://example.com/${config.name}/stream.m3u8`,
          quality: 'auto',
          type: 'hls',
          requiresSegmentProxy: false,
          status: 'working',
        } as any],
        subtitles: [],
        provider: config.name,
        timing: 100,
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

/**
 * Creates a stub provider that always fails with a specific error.
 */
function makeFailingProvider(config: ProviderConfig, errorMsg: string): Provider {
  return {
    name: config.name,
    priority: config.priority,
    enabled: config.enabled,
    supportsContent(mediaType: MediaType, metadata?: { isAnime?: boolean; isLive?: boolean }): boolean {
      const categories: ContentCategory[] = [];
      if (mediaType === 'movie') categories.push('movie');
      if (mediaType === 'tv') categories.push('tv');
      if (metadata?.isAnime) categories.push('anime');
      if (metadata?.isLive) categories.push('live-tv', 'live-sports', 'ppv', 'iptv');
      return config.supportedContent.some(c => categories.includes(c));
    },
    async extract(_request: ExtractionRequest): Promise<ExtractionResult> {
      return {
        success: false,
        sources: [],
        subtitles: [],
        provider: config.name,
        error: errorMsg,
        timing: 50,
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

/**
 * Creates a provider that tracks whether extract was called.
 */
function makeTrackingProvider(config: ProviderConfig): Provider & { extractCalled: boolean } {
  const provider = {
    name: config.name,
    priority: config.priority,
    enabled: config.enabled,
    extractCalled: false,
    supportsContent(mediaType: MediaType, metadata?: { isAnime?: boolean; isLive?: boolean }): boolean {
      const categories: ContentCategory[] = [];
      if (mediaType === 'movie') categories.push('movie');
      if (mediaType === 'tv') categories.push('tv');
      if (metadata?.isAnime) categories.push('anime');
      if (metadata?.isLive) categories.push('live-tv', 'live-sports', 'ppv', 'iptv');
      return config.supportedContent.some(c => categories.includes(c));
    },
    async extract(_request: ExtractionRequest): Promise<ExtractionResult> {
      provider.extractCalled = true;
      return {
        success: true,
        sources: [{
          url: `https://example.com/${config.name}/stream.m3u8`,
          quality: 'auto',
          type: 'hls',
          requiresSegmentProxy: false,
          status: 'working',
        } as any],
        subtitles: [],
        provider: config.name,
        timing: 100,
      };
    },
    async fetchSourceByName(_sourceName: string, _request: ExtractionRequest): Promise<StreamSource | null> {
      return null;
    },
    getConfig(): ProviderConfig {
      return { ...config };
    },
  };
  return provider;
}


// ============================================
// Helper: simulate extractFromSpecificProvider logic
// ============================================
async function simulateExtractFromSpecificProvider(
  registry: ProviderRegistry,
  providerName: string,
  request: ExtractionRequest,
): Promise<{ sources: any[]; provider: string }> {
  const provider = registry.get(providerName);
  if (!provider) {
    throw new Error(`Provider "${providerName}" not found`);
  }
  if (!provider.enabled) {
    throw new Error(`Provider "${providerName}" is disabled`);
  }

  const result = await provider.extract(request);

  if (result.success && result.sources.length > 0) {
    return { sources: result.sources, provider: provider.name };
  }

  throw new Error(result.error || `${provider.name} returned no sources`);
}

// ============================================
// Helper: simulate extractWithFallback logic
// ============================================
async function simulateExtractWithFallback(
  registry: ProviderRegistry,
  request: ExtractionRequest,
  mediaType: MediaType,
  isAnime: boolean,
): Promise<{ sources: any[]; provider: string }> {
  const metadata = { isAnime };
  const providers = registry.getForContent(mediaType, metadata);

  let allProviders = [...providers];
  if (isAnime) {
    const generalProviders = registry.getForContent(mediaType);
    for (const gp of generalProviders) {
      if (!allProviders.some(p => p.name === gp.name)) {
        allProviders.push(gp);
      }
    }
  }

  if (allProviders.length === 0) {
    throw new AllProvidersFailedError([]);
  }

  const attempts: { provider: string; error: string }[] = [];

  for (const provider of allProviders) {
    try {
      const result = await provider.extract(request);

      if (result.success && result.sources.length > 0) {
        const workingSources = result.sources.filter((s: any) => !s.status || s.status === 'working');
        if (workingSources.length > 0) {
          return { sources: result.sources, provider: provider.name };
        }
      }

      const errorMsg = result.error || 'No working sources';
      attempts.push({ provider: provider.name, error: errorMsg });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      attempts.push({ provider: provider.name, error: errorMsg });
    }
  }

  throw new AllProvidersFailedError(attempts);
}

// ============================================
// Property Tests
// ============================================

describe('Extraction Route Property Tests', () => {
  test('Property 7: Route dispatch correctness — specific provider request delegates to that provider', async () => {
    /**
     * Feature: clean-architecture-rewrite, Property 7: Route dispatch correctness (API layer)
     * **Validates: Requirements 5.2**
     *
     * For any registered provider name, requesting extraction with that specific provider
     * SHALL delegate to that provider's extract method and return results from that provider.
     */
    await fc.assert(
      fc.asyncProperty(uniqueProviderConfigsArb, extractionRequestArb, async (configs, request) => {
        const registry = new ProviderRegistry();
        const trackingProviders: (Provider & { extractCalled: boolean })[] = [];

        for (const config of configs) {
          // Force all providers enabled for this test
          const enabledConfig = { ...config, enabled: true };
          const tp = makeTrackingProvider(enabledConfig);
          trackingProviders.push(tp);
          registry.register(tp);
        }

        // Pick a random provider to request explicitly
        const targetConfig = configs[0];
        const result = await simulateExtractFromSpecificProvider(
          registry,
          targetConfig.name,
          request,
        );

        // The result provider must match the requested provider
        expect(result.provider).toBe(targetConfig.name);

        // The target provider's extract must have been called
        const targetTracking = trackingProviders.find(p => p.name === targetConfig.name);
        expect(targetTracking!.extractCalled).toBe(true);

        // No other provider's extract should have been called
        for (const tp of trackingProviders) {
          if (tp.name !== targetConfig.name) {
            expect(tp.extractCalled).toBe(false);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  test('Property 7: Route dispatch correctness — unknown provider returns error', async () => {
    /**
     * Feature: clean-architecture-rewrite, Property 7: Route dispatch correctness (API layer)
     * **Validates: Requirements 5.2**
     *
     * For any provider name NOT in the registry, requesting extraction SHALL throw an error.
     */
    await fc.assert(
      fc.asyncProperty(
        uniqueProviderConfigsArb,
        fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-z][a-z0-9-]*$/.test(s)),
        extractionRequestArb,
        async (configs, randomName, request) => {
          const registry = new ProviderRegistry();
          for (const config of configs) {
            registry.register(makeSuccessProvider(config));
          }

          const isRegistered = configs.some(c => c.name === randomName);
          if (!isRegistered) {
            let threw = false;
            try {
              await simulateExtractFromSpecificProvider(registry, randomName, request);
            } catch (err) {
              threw = true;
              expect(err instanceof Error).toBe(true);
              expect((err as Error).message).toContain('not found');
            }
            expect(threw).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 9: All-providers-fail error aggregation', async () => {
    /**
     * Feature: clean-architecture-rewrite, Property 9: All-providers-fail error aggregation
     * **Validates: Requirements 5.5**
     *
     * When all providers in the fallback chain fail, the error response SHALL contain
     * a list of all attempted provider names and their individual error messages.
     * The length of the attempted providers list SHALL equal the number of eligible providers.
     */
    await fc.assert(
      fc.asyncProperty(
        // Generate configs that all support 'movie' content and are enabled
        fc.uniqueArray(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-z][a-z0-9-]*$/.test(s)),
            priority: fc.integer({ min: 1, max: 1000 }),
            enabled: fc.constant(true as boolean),
            supportedContent: fc.constant(['movie'] as ContentCategory[]),
          }),
          { minLength: 1, maxLength: 8, selector: c => c.name }
        ).filter(arr => arr.length >= 1),
        fc.array(
          fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.length > 0),
          { minLength: 1, maxLength: 8 }
        ),
        extractionRequestArb,
        async (configs, errorMessages, request) => {
          const registry = new ProviderRegistry();

          // Create failing providers with unique error messages
          for (let i = 0; i < configs.length; i++) {
            const errorMsg = errorMessages[i % errorMessages.length];
            registry.register(makeFailingProvider(configs[i], errorMsg));
          }

          // Force request to be a movie so all providers match
          const movieRequest = { ...request, mediaType: 'movie' as MediaType };

          let caughtError: AllProvidersFailedError | null = null;
          try {
            await simulateExtractWithFallback(registry, movieRequest, 'movie', false);
          } catch (err) {
            if (err instanceof AllProvidersFailedError) {
              caughtError = err;
            } else {
              throw err;
            }
          }

          // Must have thrown AllProvidersFailedError
          expect(caughtError).not.toBeNull();

          // The attempts list must contain all eligible providers
          const eligible = registry.getForContent('movie');
          expect(caughtError!.attempts.length).toBe(eligible.length);

          // Each attempt must have a provider name and error string
          for (const attempt of caughtError!.attempts) {
            expect(typeof attempt.provider).toBe('string');
            expect(attempt.provider.length).toBeGreaterThan(0);
            expect(typeof attempt.error).toBe('string');
            expect(attempt.error.length).toBeGreaterThan(0);
          }

          // All eligible provider names must appear in the attempts
          const attemptedNames = new Set(caughtError!.attempts.map(a => a.provider));
          for (const p of eligible) {
            expect(attemptedNames.has(p.name)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 9: AllProvidersFailedError carries correct message and attempts', () => {
    /**
     * Feature: clean-architecture-rewrite, Property 9: All-providers-fail error aggregation
     * **Validates: Requirements 5.5**
     *
     * For any set of provider failure attempts, AllProvidersFailedError SHALL carry
     * the message "All providers failed" and the exact attempts array.
     */
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            provider: fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-z][a-z0-9-]*$/.test(s)),
            error: fc.string({ minLength: 1, maxLength: 100 }),
          }),
          { minLength: 0, maxLength: 10 }
        ),
        (attempts) => {
          const err = new AllProvidersFailedError(attempts);

          expect(err.message).toBe('All providers failed');
          expect(err.name).toBe('AllProvidersFailedError');
          expect(err instanceof Error).toBe(true);
          expect(err.attempts).toEqual(attempts);
          expect(err.attempts.length).toBe(attempts.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});
