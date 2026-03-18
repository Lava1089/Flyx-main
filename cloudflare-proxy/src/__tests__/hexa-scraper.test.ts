/**
 * Property-based tests for hexa-scraper.ts
 *
 * Feature: hexa-resilient-extraction
 * Properties 3, 4, 5
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  extractFingerprint,
  extractApiDomain,
  extractApiRoutes,
} from '../hexa-scraper';

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generates a random alphanumeric fingerprint value */
const arbFingerprintValue = fc.string({
  minLength: 5,
  maxLength: 30,
  unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')),
});

/** Generates random JS "noise" that does NOT contain fingerprint/domain patterns */
const arbJsNoise = fc.string({
  minLength: 0,
  maxLength: 200,
  unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789 (){};=+\n\t'.split('')),
});

/** Generates a random lowercase alpha string for domain parts */
const arbAlpha = (min: number, max: number) =>
  fc.string({ minLength: min, maxLength: max, unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')) });

// ---------------------------------------------------------------------------
// Property 3: JS Bundle Fingerprint Extraction
// Feature: hexa-resilient-extraction, Property 3: JS Bundle Fingerprint Extraction
// Validates: Requirements REQ-FP-1.1
// ---------------------------------------------------------------------------

describe('Property 3: JS Bundle Fingerprint Extraction', () => {
  it('extracts fingerprint value when x-fingerprint-lite pattern is present', async () => {
    const arbFingerprintFormat = fc.oneof(
      // "x-fingerprint-lite": "VALUE"
      arbFingerprintValue.map(v => ({ js: `"x-fingerprint-lite": "${v}"`, expected: v })),
      // 'x-fingerprint-lite': 'VALUE'
      arbFingerprintValue.map(v => ({ js: `'x-fingerprint-lite': '${v}'`, expected: v })),
      // "x-fingerprint-lite", "VALUE"  (function args style)
      arbFingerprintValue.map(v => ({ js: `"x-fingerprint-lite", "${v}"`, expected: v })),
      // x-fingerprint-lite = "VALUE"
      arbFingerprintValue.map(v => ({ js: `x-fingerprint-lite = "${v}"`, expected: v })),
    );

    await fc.assert(
      fc.property(
        arbJsNoise,
        arbFingerprintFormat,
        arbJsNoise,
        (prefix, fp, suffix) => {
          const jsContent = `${prefix}${fp.js}${suffix}`;
          const result = extractFingerprint(jsContent);
          expect(result).toBe(fp.expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns null when no fingerprint pattern is present', async () => {
    // Generate JS content that cannot contain the fingerprint pattern
    const arbSafeNoise = fc.string({
      minLength: 0,
      maxLength: 300,
      unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789 (){};=+\n\t[]'.split('')),
    }).filter(s => !s.includes('fingerprint'));

    await fc.assert(
      fc.property(arbSafeNoise, (jsContent) => {
        const result = extractFingerprint(jsContent);
        expect(result).toBeNull();
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: JS Bundle API Domain Extraction
// Feature: hexa-resilient-extraction, Property 4: JS Bundle API Domain Extraction
// Validates: Requirements REQ-DOMAIN-1.2
// ---------------------------------------------------------------------------

describe('Property 4: JS Bundle API Domain Extraction', () => {
  it('extracts domain when moviedb URL pattern is present in quoted context', async () => {
    const arbMoviedbDomain = fc.tuple(
      arbAlpha(0, 5),  // prefix before "moviedb"
      arbAlpha(0, 5),  // suffix after "moviedb"
      arbAlpha(2, 8),  // second-level domain
      arbAlpha(2, 4),  // TLD
    ).map(([pre, post, sld, tld]) => {
      const domain = `https://${pre}moviedb${post}.${sld}.${tld}`;
      return domain;
    });

    await fc.assert(
      fc.property(
        arbJsNoise,
        arbMoviedbDomain,
        arbJsNoise,
        (prefix, domain, suffix) => {
          // In real JS bundles, URLs are always quoted — use quotes as delimiters
          const jsContent = `${prefix}"${domain}"${suffix}`;
          const result = extractApiDomain(jsContent);
          expect(result).toBe(domain);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns null when no moviedb domain pattern is present', async () => {
    const arbSafeNoise = fc.string({
      minLength: 0,
      maxLength: 300,
      unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789 (){};=+\n\t'.split('')),
    }).filter(s => !s.includes('moviedb'));

    await fc.assert(
      fc.property(arbSafeNoise, (jsContent) => {
        const result = extractApiDomain(jsContent);
        expect(result).toBeNull();
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5: JS Bundle Route Extraction
// Feature: hexa-resilient-extraction, Property 5: JS Bundle Route Extraction
// Validates: Requirements REQ-ROUTE-1.1
// ---------------------------------------------------------------------------

describe('Property 5: JS Bundle Route Extraction', () => {
  it('extracts route patterns when API path patterns are present', async () => {
    const arbVersion = fc.oneof(
      fc.constant(''),
      fc.integer({ min: 1, max: 5 }).map(v => `/v${v}`),
    );

    await fc.assert(
      fc.property(
        arbVersion,
        arbJsNoise,
        (version, noise) => {
          // Build JS content with quoted route patterns
          const timePath = `/api${version}/time`;
          const moviePath = `/api${version}/tmdb/movie/550/images`;
          const tvPath = `/api${version}/tmdb/tv/100/season/1/episode/1/images`;

          const jsContent = `${noise}"${timePath}"${noise}"${moviePath}"${noise}"${tvPath}"${noise}`;
          const result = extractApiRoutes(jsContent);

          expect(result).not.toBeNull();
          if (result) {
            // Time route should match exactly
            if (result.time) {
              expect(result.time).toBe(timePath);
            }
            // Movie route should contain the version prefix
            if (result.movieImages) {
              expect(result.movieImages).toContain(`/api${version}/tmdb/movie/`);
            }
            // TV route should contain the version prefix
            if (result.tvImages) {
              expect(result.tvImages).toContain(`/api${version}/tmdb/tv/`);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns null when no API route patterns are present', async () => {
    const arbSafeNoise = fc.string({
      minLength: 0,
      maxLength: 300,
      unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789 (){};=+\n\t'.split('')),
    }).filter(s => !s.includes('/api'));

    await fc.assert(
      fc.property(arbSafeNoise, (jsContent) => {
        const result = extractApiRoutes(jsContent);
        expect(result).toBeNull();
      }),
      { numRuns: 100 },
    );
  });
});
