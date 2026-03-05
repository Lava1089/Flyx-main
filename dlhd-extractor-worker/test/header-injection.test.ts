import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  buildUpstreamHeaders,
  buildResponseHeaders,
  hasRequiredHeaders,
  getMissingHeaders,
} from '../src/proxy/handler';
import { DecodedProxyParams } from '../src/proxy/url-encoder';

/**
 * Property 7: Header Injection Completeness
 * **Validates: Requirements 5.1, 5.3, 5.7**
 * 
 * For any proxied request to upstream resources (M3U8, segments, keys),
 * the proxy SHALL include all headers specified in the stream's required
 * headers configuration.
 */
describe('Property 7: Header Injection Completeness', () => {
  // Generator for header names (valid HTTP header names, excluding reserved JS properties)
  const headerNameArb = fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-'.split('')),
    { minLength: 1, maxLength: 20 }
  ).filter(s => /^[a-zA-Z][a-zA-Z0-9-]*$/.test(s) && !['constructor', 'prototype', '__proto__', 'toString', 'valueOf'].includes(s));

  // Generator for header values (printable ASCII)
  const headerValueArb = fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_./:?=& '.split('')),
    { minLength: 1, maxLength: 100 }
  );

  // Generator for headers object
  const headersArb = fc.dictionary(headerNameArb, headerValueArb, { minKeys: 0, maxKeys: 5 });

  // Generator for URL
  const urlArb = fc.tuple(
    fc.constantFrom('http', 'https'),
    fc.domain(),
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_/'.split('')), { minLength: 1, maxLength: 30 }),
  ).map(([protocol, domain, path]) => `${protocol}://${domain}/${path}`);

  // Generator for DecodedProxyParams
  const decodedParamsArb = fc.tuple(
    urlArb,
    headersArb,
    fc.option(urlArb, { nil: undefined }),
    fc.option(urlArb, { nil: undefined }),
  ).map(([url, headers, referer, origin]): DecodedProxyParams => ({
    url,
    headers,
    referer: referer ?? undefined,
    origin: origin ?? undefined,
  }));

  describe('All specified headers are included', () => {
    /**
     * Property: All headers from DecodedProxyParams SHALL be included in upstream request
     */
    it('should include all headers from decoded params', () => {
      fc.assert(
        fc.property(decodedParamsArb, (params) => {
          const upstreamHeaders = buildUpstreamHeaders(params);
          
          // All headers from params should be in upstream headers
          for (const [key, value] of Object.entries(params.headers)) {
            expect(upstreamHeaders[key]).toBe(value);
          }
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Referer header SHALL be included when provided
     */
    it('should include Referer header when provided', () => {
      fc.assert(
        fc.property(
          decodedParamsArb.filter(p => p.referer !== undefined),
          (params) => {
            const upstreamHeaders = buildUpstreamHeaders(params);
            
            expect(upstreamHeaders['Referer']).toBe(params.referer);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Origin header SHALL be included when provided
     */
    it('should include Origin header when provided', () => {
      fc.assert(
        fc.property(
          decodedParamsArb.filter(p => p.origin !== undefined),
          (params) => {
            const upstreamHeaders = buildUpstreamHeaders(params);
            
            expect(upstreamHeaders['Origin']).toBe(params.origin);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Default headers are always present', () => {
    /**
     * Property: User-Agent header SHALL always be present
     */
    it('should always include User-Agent header', () => {
      fc.assert(
        fc.property(decodedParamsArb, (params) => {
          const upstreamHeaders = buildUpstreamHeaders(params);
          
          expect(upstreamHeaders['User-Agent']).toBeDefined();
          expect(upstreamHeaders['User-Agent'].length).toBeGreaterThan(0);
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Accept header SHALL always be present
     */
    it('should always include Accept header', () => {
      fc.assert(
        fc.property(decodedParamsArb, (params) => {
          const upstreamHeaders = buildUpstreamHeaders(params);
          
          expect(upstreamHeaders['Accept']).toBeDefined();
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Accept-Language header SHALL always be present
     */
    it('should always include Accept-Language header', () => {
      fc.assert(
        fc.property(decodedParamsArb, (params) => {
          const upstreamHeaders = buildUpstreamHeaders(params);
          
          expect(upstreamHeaders['Accept-Language']).toBeDefined();
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Custom headers override defaults', () => {
    /**
     * Property: Custom headers SHALL override default headers
     */
    it('should allow custom headers to override defaults', () => {
      const customUserAgent = 'CustomBot/1.0';
      const params: DecodedProxyParams = {
        url: 'https://example.com/stream.m3u8',
        headers: {
          'User-Agent': customUserAgent,
        },
      };
      
      const upstreamHeaders = buildUpstreamHeaders(params);
      
      expect(upstreamHeaders['User-Agent']).toBe(customUserAgent);
    });
  });

  describe('Header validation utilities', () => {
    /**
     * Property: hasRequiredHeaders SHALL return true when all required headers present
     */
    it('should correctly identify when all required headers are present', () => {
      fc.assert(
        fc.property(
          fc.array(headerNameArb, { minLength: 1, maxLength: 5 }),
          (requiredHeaders) => {
            // Create headers object with all required headers
            const headers: Record<string, string> = {};
            for (const name of requiredHeaders) {
              headers[name] = 'value';
            }
            
            expect(hasRequiredHeaders(headers, requiredHeaders)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: hasRequiredHeaders SHALL return false when headers are missing
     */
    it('should correctly identify when required headers are missing', () => {
      fc.assert(
        fc.property(
          fc.array(headerNameArb, { minLength: 2, maxLength: 5 }),
          (requiredHeaders) => {
            // Create headers object with only first header
            const headers: Record<string, string> = {
              [requiredHeaders[0]]: 'value',
            };
            
            // Should be false since we're missing other headers
            if (requiredHeaders.length > 1) {
              expect(hasRequiredHeaders(headers, requiredHeaders)).toBe(false);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: getMissingHeaders SHALL return exactly the missing headers
     */
    it('should return exactly the missing headers', () => {
      fc.assert(
        fc.property(
          fc.array(headerNameArb, { minLength: 2, maxLength: 5 }),
          fc.integer({ min: 1, max: 4 }),
          (allHeaders, includeCount) => {
            const uniqueHeaders = [...new Set(allHeaders)];
            if (uniqueHeaders.length < 2) return; // Skip if not enough unique headers
            
            const actualIncludeCount = Math.min(includeCount, uniqueHeaders.length - 1);
            
            // Include only some headers
            const headers: Record<string, string> = {};
            for (let i = 0; i < actualIncludeCount; i++) {
              headers[uniqueHeaders[i]] = 'value';
            }
            
            const missing = getMissingHeaders(headers, uniqueHeaders);
            
            // Missing should be the headers we didn't include
            expect(missing.length).toBe(uniqueHeaders.length - actualIncludeCount);
            
            // All missing headers should not be in our headers object
            for (const m of missing) {
              expect(headers[m]).toBeUndefined();
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Case-insensitive header matching', () => {
    /**
     * Property: Header matching SHALL be case-insensitive
     */
    it('should match headers case-insensitively', () => {
      const headers = {
        'Content-Type': 'application/json',
        'X-Custom-Header': 'value',
      };
      
      expect(hasRequiredHeaders(headers, ['content-type'])).toBe(true);
      expect(hasRequiredHeaders(headers, ['CONTENT-TYPE'])).toBe(true);
      expect(hasRequiredHeaders(headers, ['x-custom-header'])).toBe(true);
    });
  });
});

describe('Response Header Building', () => {
  it('should copy passthrough headers from upstream response', () => {
    const upstreamHeaders = new Headers({
      'Content-Type': 'video/mp2t',
      'Content-Length': '12345',
      'Cache-Control': 'max-age=3600',
      'X-Custom-Header': 'should-not-copy',
    });
    
    const mockResponse = new Response(null, { headers: upstreamHeaders });
    const responseHeaders = buildResponseHeaders(mockResponse);
    
    expect(responseHeaders.get('Content-Type')).toBe('video/mp2t');
    expect(responseHeaders.get('Content-Length')).toBe('12345');
    expect(responseHeaders.get('Cache-Control')).toBe('max-age=3600');
    expect(responseHeaders.get('X-Custom-Header')).toBeNull();
  });

  it('should add additional headers to response', () => {
    const mockResponse = new Response(null);
    const responseHeaders = buildResponseHeaders(mockResponse, {
      'X-Proxy-Header': 'added',
    });
    
    expect(responseHeaders.get('X-Proxy-Header')).toBe('added');
  });
});
