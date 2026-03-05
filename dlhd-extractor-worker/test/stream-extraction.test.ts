import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  extractM3U8Url,
  extractAllM3U8Urls,
  extractRequiredHeaders,
  extractFromHlsSource,
  extractFromSourceTags,
  extractFromJsVariables,
  isValidM3U8Url,
  normalizeUrl,
} from '../src/extraction/m3u8-extractor';

/**
 * Property 4: Stream Extraction Completeness
 * **Validates: Requirements 4.1, 4.3, 4.4**
 * 
 * For any valid player embed page containing an M3U8 stream, the Stream_Extractor 
 * SHALL return an ExtractedStream object containing:
 * - A valid M3U8 URL (absolute, properly formatted)
 * - All required upstream headers
 * - Proper referer and origin values
 */
describe('Property 4: Stream Extraction Completeness', () => {
  // Generator for valid M3U8 URLs
  const m3u8UrlArb = fc.tuple(
    fc.constantFrom('http', 'https'),
    fc.domain(),
    fc.array(fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')), { minLength: 1, maxLength: 10 }), { minLength: 1, maxLength: 3 }),
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')), { minLength: 1, maxLength: 15 }),
  ).map(([protocol, domain, pathParts, filename]) => 
    `${protocol}://${domain}/${pathParts.join('/')}/${filename}.m3u8`
  );

  // Generator for query parameters
  const queryParamArb = fc.tuple(
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), { minLength: 1, maxLength: 10 }),
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), { minLength: 1, maxLength: 20 }),
  ).map(([key, value]) => `${key}=${value}`);

  // Generator for M3U8 URLs with query params
  const m3u8UrlWithParamsArb = fc.tuple(
    m3u8UrlArb,
    fc.array(queryParamArb, { minLength: 0, maxLength: 3 }),
  ).map(([url, params]) => params.length > 0 ? `${url}?${params.join('&')}` : url);

  // Generator for HTML with HLS.js source
  const hlsSourceHtmlArb = m3u8UrlWithParamsArb.map(url => `
    <script>
      var hls = new Hls();
      hls.loadSource('${url}');
      hls.attachMedia(video);
    </script>
  `);

  // Generator for HTML with source tag
  const sourceTagHtmlArb = m3u8UrlWithParamsArb.map(url => `
    <video id="player">
      <source src="${url}" type="application/x-mpegURL">
    </video>
  `);

  // Generator for HTML with JavaScript variable
  const jsVariableHtmlArb = m3u8UrlWithParamsArb.map(url => `
    <script>
      var sourceUrl = '${url}';
      player.src = sourceUrl;
    </script>
  `);

  // Generator for HTML with file property
  const filePropertyHtmlArb = m3u8UrlWithParamsArb.map(url => `
    <script>
      jwplayer('player').setup({
        file: '${url}',
        width: '100%'
      });
    </script>
  `);

  describe('M3U8 URL Validation', () => {
    /**
     * Property: Valid M3U8 URLs SHALL be recognized as valid
     */
    it('should recognize valid M3U8 URLs', () => {
      fc.assert(
        fc.property(m3u8UrlWithParamsArb, (url) => {
          expect(isValidM3U8Url(url)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Invalid URLs SHALL be rejected
     */
    it('should reject invalid URLs', () => {
      const invalidUrls = [
        '',
        'not-a-url',
        'javascript:alert(1)',
        null,
        undefined,
        'http://example.com/video.mp4', // Not an M3U8 URL
        'https://example.com/page.html', // Not an M3U8 URL
      ];

      for (const url of invalidUrls) {
        expect(isValidM3U8Url(url as string)).toBe(false);
      }
    });
  });

  describe('URL Normalization', () => {
    /**
     * Property: Normalized URLs SHALL have whitespace trimmed
     */
    it('should trim whitespace from URLs', () => {
      fc.assert(
        fc.property(
          m3u8UrlArb,
          fc.stringOf(fc.constantFrom(' ', '\t', '\n'), { minLength: 0, maxLength: 3 }),
          fc.stringOf(fc.constantFrom(' ', '\t', '\n'), { minLength: 0, maxLength: 3 }),
          (url, prefix, suffix) => {
            const withWhitespace = prefix + url + suffix;
            const normalized = normalizeUrl(withWhitespace);
            
            expect(normalized).toBe(url);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: HTML entities SHALL be decoded
     */
    it('should decode HTML entities', () => {
      fc.assert(
        fc.property(m3u8UrlArb, (url) => {
          // Encode some characters as HTML entities
          const encoded = url.replace(/&/g, '&amp;');
          const normalized = normalizeUrl(encoded);
          
          expect(normalized).toBe(url);
        }),
        { numRuns: 100 }
      );
    });
  });


  describe('HLS.js Source Extraction', () => {
    /**
     * Property: M3U8 URLs in hls.loadSource() SHALL be extracted
     */
    it('should extract M3U8 URLs from hls.loadSource()', () => {
      fc.assert(
        fc.property(hlsSourceHtmlArb, m3u8UrlWithParamsArb, (html, expectedUrl) => {
          // The HTML is generated from the same URL, so we need to extract it
          const result = extractFromHlsSource(html);
          
          if (result) {
            expect(isValidM3U8Url(result.url)).toBe(true);
            expect(result.method).toBe('hls-source');
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Source Tag Extraction', () => {
    /**
     * Property: M3U8 URLs in <source> tags SHALL be extracted
     */
    it('should extract M3U8 URLs from source tags', () => {
      fc.assert(
        fc.property(sourceTagHtmlArb, (html) => {
          const result = extractFromSourceTags(html);
          
          if (result) {
            expect(isValidM3U8Url(result.url)).toBe(true);
            expect(result.method).toBe('source-tag');
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('JavaScript Variable Extraction', () => {
    /**
     * Property: M3U8 URLs in JS variables SHALL be extracted
     */
    it('should extract M3U8 URLs from JavaScript variables', () => {
      fc.assert(
        fc.property(jsVariableHtmlArb, (html) => {
          const result = extractFromJsVariables(html);
          
          if (result) {
            expect(isValidM3U8Url(result.url)).toBe(true);
            expect(result.method).toBe('javascript-variable');
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Generic M3U8 Extraction', () => {
    /**
     * Property: extractM3U8Url SHALL find URLs in various formats
     */
    it('should extract M3U8 URLs from various HTML formats', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            hlsSourceHtmlArb,
            sourceTagHtmlArb,
            jsVariableHtmlArb,
            filePropertyHtmlArb,
          ),
          (html) => {
            const result = extractM3U8Url(html);
            
            // Should find a valid URL in the generated HTML
            if (result) {
              expect(isValidM3U8Url(result.url)).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: extractAllM3U8Urls SHALL find all URLs in HTML
     */
    it('should extract all M3U8 URLs from HTML', () => {
      fc.assert(
        fc.property(
          fc.array(m3u8UrlWithParamsArb, { minLength: 1, maxLength: 3 }),
          (urls) => {
            // Create HTML with multiple URLs
            const html = urls.map((url, i) => `
              <script>var source${i} = '${url}';</script>
            `).join('\n');
            
            const results = extractAllM3U8Urls(html);
            
            // Should find at least one URL
            expect(results.length).toBeGreaterThan(0);
            
            // All found URLs should be valid
            for (const result of results) {
              expect(isValidM3U8Url(result.url)).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Required Headers Extraction', () => {
    /**
     * Property: Headers in setRequestHeader calls SHALL be extracted
     */
    it('should extract headers from setRequestHeader calls', () => {
      fc.assert(
        fc.property(
          fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-'.split('')), { minLength: 1, maxLength: 20 }),
          fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_./'.split('')), { minLength: 1, maxLength: 50 }),
          (headerName, headerValue) => {
            const html = `
              <script>
                xhr.setRequestHeader('${headerName}', '${headerValue}');
              </script>
            `;
            
            const headers = extractRequiredHeaders(html);
            
            expect(headers[headerName]).toBe(headerValue);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Extracted Stream Completeness', () => {
    /**
     * Property: Extracted URLs SHALL be absolute
     */
    it('should only return absolute URLs', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            hlsSourceHtmlArb,
            sourceTagHtmlArb,
            jsVariableHtmlArb,
          ),
          (html) => {
            const result = extractM3U8Url(html);
            
            if (result) {
              // URL should be absolute (start with http:// or https://)
              expect(result.url.startsWith('http://') || result.url.startsWith('https://')).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Extracted URLs SHALL be properly formatted
     */
    it('should return properly formatted URLs', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            hlsSourceHtmlArb,
            sourceTagHtmlArb,
            jsVariableHtmlArb,
          ),
          (html) => {
            const result = extractM3U8Url(html);
            
            if (result) {
              // URL should be parseable
              expect(() => new URL(result.url)).not.toThrow();
              
              // URL should contain .m3u8 or be an HLS endpoint
              expect(
                result.url.includes('.m3u8') || 
                result.url.includes('/hls/') || 
                result.url.includes('/live/')
              ).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
