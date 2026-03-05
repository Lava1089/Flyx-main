import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  PROXY_CORS_HEADERS,
  REQUIRED_CORS_HEADERS,
  addProxyCorsHeaders,
  handleProxyPreflightRequest,
  hasRequiredCorsHeaders,
  getMissingCorsHeaders,
  allowsAllOrigins,
  getCorsHeaders,
  createCorsErrorResponse,
} from '../src/proxy/cors';

/**
 * Property 9: CORS Headers Presence
 * **Validates: Requirements 5.8**
 * 
 * For any response from the Worker's proxy endpoints, the response SHALL include:
 * - Access-Control-Allow-Origin: *
 * - Access-Control-Allow-Methods with appropriate methods
 * - Access-Control-Allow-Headers with appropriate headers
 */
describe('Property 9: CORS Headers Presence', () => {
  // Generator for response status codes (excluding 204 which can't have body)
  const statusCodeArb = fc.constantFrom(200, 201, 400, 404, 500, 502);

  // Generator for content types
  const contentTypeArb = fc.constantFrom(
    'application/vnd.apple.mpegurl',
    'video/mp2t',
    'application/octet-stream',
    'application/json',
    'text/plain'
  );

  // Generator for response body
  const bodyArb = fc.oneof(
    fc.constant(null),
    fc.string({ minLength: 0, maxLength: 100 }),
  );

  // Generator for mock responses
  const responseArb = fc.tuple(
    statusCodeArb,
    contentTypeArb,
    bodyArb,
  ).map(([status, contentType, body]) => {
    const headers = new Headers({ 'Content-Type': contentType });
    return new Response(body, { status, headers });
  });

  describe('Required CORS headers are always present', () => {
    /**
     * Property: Access-Control-Allow-Origin SHALL be present in all proxy responses
     */
    it('should include Access-Control-Allow-Origin in all responses', () => {
      fc.assert(
        fc.property(responseArb, (response) => {
          const corsResponse = addProxyCorsHeaders(response);
          
          expect(corsResponse.headers.has('Access-Control-Allow-Origin')).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Access-Control-Allow-Methods SHALL be present in all proxy responses
     */
    it('should include Access-Control-Allow-Methods in all responses', () => {
      fc.assert(
        fc.property(responseArb, (response) => {
          const corsResponse = addProxyCorsHeaders(response);
          
          expect(corsResponse.headers.has('Access-Control-Allow-Methods')).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Access-Control-Allow-Headers SHALL be present in all proxy responses
     */
    it('should include Access-Control-Allow-Headers in all responses', () => {
      fc.assert(
        fc.property(responseArb, (response) => {
          const corsResponse = addProxyCorsHeaders(response);
          
          expect(corsResponse.headers.has('Access-Control-Allow-Headers')).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: All required CORS headers SHALL be present after adding
     */
    it('should include all required CORS headers', () => {
      fc.assert(
        fc.property(responseArb, (response) => {
          const corsResponse = addProxyCorsHeaders(response);
          
          expect(hasRequiredCorsHeaders(corsResponse)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Access-Control-Allow-Origin allows all origins', () => {
    /**
     * Property: Access-Control-Allow-Origin SHALL be "*" to allow any client
     */
    it('should allow all origins with "*"', () => {
      fc.assert(
        fc.property(responseArb, (response) => {
          const corsResponse = addProxyCorsHeaders(response);
          
          expect(allowsAllOrigins(corsResponse)).toBe(true);
          expect(corsResponse.headers.get('Access-Control-Allow-Origin')).toBe('*');
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Response body and status are preserved', () => {
    /**
     * Property: Original response status SHALL be preserved
     */
    it('should preserve original response status', () => {
      fc.assert(
        fc.property(responseArb, (response) => {
          const corsResponse = addProxyCorsHeaders(response);
          
          expect(corsResponse.status).toBe(response.status);
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Original Content-Type header SHALL be preserved
     */
    it('should preserve original Content-Type header', () => {
      fc.assert(
        fc.property(responseArb, (response) => {
          const originalContentType = response.headers.get('Content-Type');
          const corsResponse = addProxyCorsHeaders(response);
          
          expect(corsResponse.headers.get('Content-Type')).toBe(originalContentType);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Preflight request handling', () => {
    /**
     * Property: Preflight response SHALL have 204 status
     */
    it('should return 204 status for preflight requests', () => {
      const preflightResponse = handleProxyPreflightRequest();
      
      expect(preflightResponse.status).toBe(204);
    });

    /**
     * Property: Preflight response SHALL have all required CORS headers
     */
    it('should include all required CORS headers in preflight response', () => {
      const preflightResponse = handleProxyPreflightRequest();
      
      expect(hasRequiredCorsHeaders(preflightResponse)).toBe(true);
    });

    /**
     * Property: Preflight response SHALL have null body
     */
    it('should have null body for preflight response', async () => {
      const preflightResponse = handleProxyPreflightRequest();
      const body = await preflightResponse.text();
      
      expect(body).toBe('');
    });
  });

  describe('CORS header utilities', () => {
    /**
     * Property: getMissingCorsHeaders SHALL return empty array when all headers present
     */
    it('should return empty array when all CORS headers present', () => {
      fc.assert(
        fc.property(responseArb, (response) => {
          const corsResponse = addProxyCorsHeaders(response);
          const missing = getMissingCorsHeaders(corsResponse);
          
          expect(missing).toEqual([]);
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: getCorsHeaders SHALL return all CORS headers
     */
    it('should extract all CORS headers from response', () => {
      fc.assert(
        fc.property(responseArb, (response) => {
          const corsResponse = addProxyCorsHeaders(response);
          const corsHeaders = getCorsHeaders(corsResponse);
          
          // Should have at least the required headers
          expect(Object.keys(corsHeaders).length).toBeGreaterThanOrEqual(REQUIRED_CORS_HEADERS.length);
          
          // All keys should start with Access-Control-
          for (const key of Object.keys(corsHeaders)) {
            expect(key.toLowerCase().startsWith('access-control-')).toBe(true);
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Error responses include CORS headers', () => {
    /**
     * Property: Error responses SHALL include CORS headers
     */
    it('should include CORS headers in error responses', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }),
          (errorMessage) => {
            const errorResponse = createCorsErrorResponse(errorMessage);
            
            expect(hasRequiredCorsHeaders(errorResponse)).toBe(true);
            expect(errorResponse.status).toBe(403);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});

describe('CORS Headers Configuration', () => {
  it('should have correct default CORS headers', () => {
    expect(PROXY_CORS_HEADERS['Access-Control-Allow-Origin']).toBe('*');
    expect(PROXY_CORS_HEADERS['Access-Control-Allow-Methods']).toContain('GET');
    expect(PROXY_CORS_HEADERS['Access-Control-Allow-Methods']).toContain('OPTIONS');
    expect(PROXY_CORS_HEADERS['Access-Control-Allow-Headers']).toContain('Content-Type');
    expect(PROXY_CORS_HEADERS['Access-Control-Allow-Headers']).toContain('Range');
  });

  it('should expose necessary headers for streaming', () => {
    expect(PROXY_CORS_HEADERS['Access-Control-Expose-Headers']).toContain('Content-Length');
    expect(PROXY_CORS_HEADERS['Access-Control-Expose-Headers']).toContain('Content-Range');
  });

  it('should have appropriate max-age for caching', () => {
    const maxAge = parseInt(PROXY_CORS_HEADERS['Access-Control-Max-Age']);
    expect(maxAge).toBeGreaterThan(0);
  });
});
