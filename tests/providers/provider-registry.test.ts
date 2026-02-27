/**
 * Property-Based Tests for ProviderRegistry
 * Feature: clean-architecture-rewrite
 * Validates: Requirements 1.4, 2.3, 2.4, 2.5, 8.3, 9.1, 9.2, 9.3
 */

import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';
import { ProviderRegistry } from '../../app/lib/providers/registry';
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
  name: fc.string({ minLength: 1, maxLength: 30 }).filter(s => /^[a-z0-9-]+$/.test(s)),
  priority: fc.integer({ min: 1, max: 1000 }),
  enabled: fc.boolean(),
  supportedContent: fc.uniqueArray(contentCategoryArb, { minLength: 1, maxLength: 7 }),
});

/**
 * Build a stub Provider from a ProviderConfig for testing registry behavior.
 */
function makeStubProvider(config: ProviderConfig): Provider {
  return {
    name: config.name,
    priority: config.priority,
    enabled: config.enabled,
    supportsContent(mediaType: MediaType, _metadata?: { isAnime?: boolean; isLive?: boolean }): boolean {
      // Map MediaType to the ContentCategory values that match
      const categories: ContentCategory[] = [];
      if (mediaType === 'movie') categories.push('movie');
      if (mediaType === 'tv') categories.push('tv');
      return config.supportedContent.some(c => categories.includes(c));
    },
    async extract(_request: ExtractionRequest): Promise<ExtractionResult> {
      return { success: false, sources: [], subtitles: [], provider: config.name, error: 'stub' };
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
 * Generate a list of ProviderConfigs with unique names.
 */
const uniqueProviderConfigsArb = fc
  .uniqueArray(providerConfigArb, { minLength: 1, maxLength: 15, selector: c => c.name })
  .filter(arr => arr.length >= 1);

// ============================================
// Property Tests
// ============================================

describe('ProviderRegistry Property Tests', () => {
  test('Property 2: Provider names are unique in registry', () => {
    /**
     * Feature: clean-architecture-rewrite, Property 2: Provider names are unique in registry
     * Validates: Requirements 1.4
     *
     * For any set of providers registered in the ProviderRegistry, no two providers
     * should have the same name. Registering a duplicate name throws.
     */
    fc.assert(
      fc.property(uniqueProviderConfigsArb, (configs) => {
        const registry = new ProviderRegistry();
        for (const config of configs) {
          registry.register(makeStubProvider(config));
        }

        // Registering any existing name again must throw
        for (const config of configs) {
          expect(() => registry.register(makeStubProvider(config))).toThrow();
        }

        // The number of retrievable providers equals the number registered
        const allEnabled = configs.filter(c => c.enabled);
        const retrieved = registry.getAllEnabled();
        expect(retrieved.length).toBe(allEnabled.length);
      }),
      { numRuns: 100 }
    );
  });

  test('Property 4: ProviderConfig serialization round-trip', () => {
    /**
     * Feature: clean-architecture-rewrite, Property 4: ProviderConfig serialization round-trip
     * Validates: Requirements 2.3, 9.1, 9.2, 9.3
     *
     * For any valid array of ProviderConfig objects, serializing via serializeConfig()
     * and deserializing via deserializeConfig() produces a deeply equal array.
     */
    fc.assert(
      fc.property(uniqueProviderConfigsArb, (configs) => {
        const registry = new ProviderRegistry();
        for (const config of configs) {
          registry.register(makeStubProvider(config));
        }

        const serialized = registry.serializeConfig();
        const deserialized = ProviderRegistry.deserializeConfig(serialized);

        // Round-trip should produce equivalent configs
        expect(deserialized.length).toBe(configs.length);

        for (const original of configs) {
          const found = deserialized.find(d => d.name === original.name);
          expect(found).toBeDefined();
          expect(found!.priority).toBe(original.priority);
          expect(found!.enabled).toBe(original.enabled);
          expect([...found!.supportedContent].sort()).toEqual([...original.supportedContent].sort());
        }
      }),
      { numRuns: 100 }
    );
  });

  test('Property 5: Registry get-by-name correctness', () => {
    /**
     * Feature: clean-architecture-rewrite, Property 5: Registry get-by-name correctness
     * Validates: Requirements 2.4
     *
     * For any provider registered in the registry, get(name) returns that provider.
     * For unknown names, get returns undefined.
     */
    fc.assert(
      fc.property(
        uniqueProviderConfigsArb,
        fc.string({ minLength: 1, maxLength: 30 }).filter(s => /^[a-z0-9-]+$/.test(s)),
        (configs, randomName) => {
          const registry = new ProviderRegistry();
          for (const config of configs) {
            registry.register(makeStubProvider(config));
          }

          // Every registered name should return the correct provider
          for (const config of configs) {
            const provider = registry.get(config.name);
            expect(provider).toBeDefined();
            expect(provider!.name).toBe(config.name);
            expect(provider!.priority).toBe(config.priority);
          }

          // An unregistered name should return undefined
          const isRegistered = configs.some(c => c.name === randomName);
          if (!isRegistered) {
            expect(registry.get(randomName)).toBeUndefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 6: getForContent returns enabled, supporting providers in priority order', () => {
    /**
     * Feature: clean-architecture-rewrite, Property 6: getForContent returns enabled, supporting providers in priority order
     * Validates: Requirements 2.5, 5.3, 8.3
     *
     * For any set of registered providers and any content type query, getForContent
     * returns only enabled providers that support that content, sorted ascending by priority.
     */
    fc.assert(
      fc.property(uniqueProviderConfigsArb, mediaTypeArb, (configs, mediaType) => {
        const registry = new ProviderRegistry();
        for (const config of configs) {
          registry.register(makeStubProvider(config));
        }

        const result = registry.getForContent(mediaType);

        // All returned providers must be enabled
        for (const p of result) {
          expect(p.enabled).toBe(true);
        }

        // All returned providers must support the queried content
        for (const p of result) {
          expect(p.supportsContent(mediaType)).toBe(true);
        }

        // Results must be sorted by ascending priority
        for (let i = 1; i < result.length; i++) {
          expect(result[i].priority).toBeGreaterThanOrEqual(result[i - 1].priority);
        }

        // No eligible provider should be missing from the result
        const eligible = configs.filter(c => {
          const categories: ContentCategory[] = [];
          if (mediaType === 'movie') categories.push('movie');
          if (mediaType === 'tv') categories.push('tv');
          return c.enabled && c.supportedContent.some(sc => categories.includes(sc));
        });
        expect(result.length).toBe(eligible.length);
      }),
      { numRuns: 100 }
    );
  });
});
