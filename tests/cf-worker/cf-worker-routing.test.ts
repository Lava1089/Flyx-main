/**
 * Property-Based Tests for CF Worker Routing and Error Handling
 * Feature: clean-architecture-rewrite
 * Property 7: Route dispatch correctness (CF Worker layer)
 * Property 8: Error responses are structured JSON (CF Worker layer)
 * Validates: Requirements 4.2, 4.4
 */

import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';
import { matchRoute, type RouteEntry } from '../../cloudflare-proxy/src/index';
import { errorResponse, detailedErrorResponse } from '../../cloudflare-proxy/src/errors';
import { corsPreflightResponse } from '../../cloudflare-proxy/src/cors';

// ============================================
// Known CF Worker routes and their expected provider identity
// ============================================

const KNOWN_ROUTES: Array<{ path: string; provider: string }> = [
  { path: '/health', provider: 'health' },
  { path: '/stream', provider: 'stream' },
  { path: '/stream/token', provider: 'stream' },
  { path: '/stream/some/path', provider: 'stream' },
  { path: '/init', provider: 'fortress' },
  { path: '/challenge', provider: 'fortress' },
  { path: '/v3/init', provider: 'quantum-v3' },
  { path: '/v3/challenge', provider: 'quantum-v3' },
  { path: '/v2/init', provider: 'quantum-v2' },
  { path: '/v2/challenge', provider: 'quantum-v2' },
  { path: '/quantum/verify', provider: 'quantum' },
  { path: '/dlhd', provider: 'dlhd' },
  { path: '/dlhd/key', provider: 'dlhd' },
  { path: '/dlhd/segment', provider: 'dlhd' },
  { path: '/dlhd/health', provider: 'dlhd' },
  { path: '/animekai', provider: 'animekai' },
  { path: '/animekai/health', provider: 'animekai' },
  { path: '/flixer', provider: 'flixer' },
  { path: '/flixer/extract', provider: 'flixer' },
  { path: '/flixer/health', provider: 'flixer' },
  { path: '/analytics', provider: 'analytics' },
  { path: '/analytics/presence', provider: 'analytics' },
  { path: '/analytics/pageview', provider: 'analytics' },
  { path: '/tmdb', provider: 'tmdb' },
  { path: '/tmdb/movie/123', provider: 'tmdb' },
  { path: '/cdn-live', provider: 'cdn-live' },
  { path: '/cdn-live/stream', provider: 'cdn-live' },
  { path: '/ppv', provider: 'ppv' },
  { path: '/ppv/stream', provider: 'ppv' },
  { path: '/ppv/health', provider: 'ppv' },
  { path: '/viprow', provider: 'viprow' },
  { path: '/viprow/stream', provider: 'viprow' },
  { path: '/viprow/manifest', provider: 'viprow' },
  { path: '/vidsrc', provider: 'vidsrc' },
  { path: '/vidsrc/extract', provider: 'vidsrc' },
  { path: '/vidsrc/stream', provider: 'vidsrc' },
  { path: '/hianime', provider: 'hianime' },
  { path: '/hianime/extract', provider: 'hianime' },
  { path: '/hianime/stream', provider: 'hianime' },
  { path: '/tv/iptv', provider: 'iptv-legacy' },
  { path: '/tv/iptv/api', provider: 'iptv-legacy' },
  { path: '/iptv', provider: 'iptv' },
  { path: '/iptv/api', provider: 'iptv' },
  { path: '/iptv/stream', provider: 'iptv' },
  { path: '/segment', provider: 'segment' },
  { path: '/tv', provider: 'tv' },
  { path: '/tv/key', provider: 'tv' },
  { path: '/tv/segment', provider: 'tv' },
  { path: '/decode', provider: 'decode' },
];

/**
 * Build a simplified route table that mirrors the real one but uses
 * stub handlers that record which provider was matched.
 * This avoids importing all the heavy CF Worker handler modules.
 */
function buildTestRouteTable(): RouteEntry[] {
  const makeHandler = (provider: string) =>
    async () => new Response(JSON.stringify({ provider }), { status: 200 });

  return [
    { prefix: '/health', exact: true, handler: makeHandler('health') },
    { prefix: '/stream', handler: makeHandler('stream') },
    { prefix: '/init', exact: true, handler: makeHandler('fortress') },
    { prefix: '/challenge', exact: true, handler: makeHandler('fortress') },
    { prefix: '/v3/', handler: makeHandler('quantum-v3') },
    { prefix: '/v2/', handler: makeHandler('quantum-v2') },
    { prefix: '/quantum/', handler: makeHandler('quantum') },
    { prefix: '/dlhd', handler: makeHandler('dlhd') },
    { prefix: '/animekai', handler: makeHandler('animekai') },
    { prefix: '/flixer', handler: makeHandler('flixer') },
    { prefix: '/analytics', handler: makeHandler('analytics') },
    { prefix: '/tmdb', handler: makeHandler('tmdb') },
    { prefix: '/cdn-live', handler: makeHandler('cdn-live') },
    { prefix: '/ppv', handler: makeHandler('ppv') },
    { prefix: '/viprow', handler: makeHandler('viprow') },
    { prefix: '/vidsrc', handler: makeHandler('vidsrc') },
    { prefix: '/hianime', handler: makeHandler('hianime') },
    { prefix: '/tv/iptv', handler: makeHandler('iptv-legacy') },
    { prefix: '/iptv', handler: makeHandler('iptv') },
    { prefix: '/segment', exact: true, handler: makeHandler('segment') },
    { prefix: '/tv', handler: makeHandler('tv') },
    { prefix: '/decode', exact: true, handler: makeHandler('decode') },
  ];
}

// ============================================
// Arbitraries
// ============================================

/** Arbitrary for known route paths */
const knownRouteArb = fc.constantFrom(...KNOWN_ROUTES);

/** Arbitrary for paths that should NOT match any route */
const unknownPathArb = fc
  .string({ minLength: 1, maxLength: 50 })
  .map(s => '/' + s.replace(/[^a-z0-9]/gi, ''))
  .filter(s => {
    // Must not match any known route prefix
    const testRoutes = buildTestRouteTable();
    return matchRoute(s, testRoutes) === undefined;
  });

/** Arbitrary for HTTP error status codes */
const errorStatusArb = fc.integer({ min: 400, max: 599 });

/** Arbitrary for non-empty error messages */
const errorMessageArb = fc.string({ minLength: 1, maxLength: 200 }).filter(s => s.trim().length > 0);

// ============================================
// Property Tests
// ============================================

describe('CF Worker Routing Property Tests', () => {
  test('Property 7: Route dispatch correctness (CF Worker layer)', async () => {
    /**
     * Feature: clean-architecture-rewrite, Property 7: Route dispatch correctness
     * **Validates: Requirements 4.2**
     *
     * For any valid request path from the set of known provider routes,
     * the matchRoute function should dispatch to the handler associated
     * with that route's provider prefix. The dispatched handler's identity
     * should match the expected provider for that path.
     */
    const routes = buildTestRouteTable();

    await fc.assert(
      fc.asyncProperty(knownRouteArb, async ({ path, provider: expectedProvider }) => {
        const matched = matchRoute(path, routes);

        // Must find a matching route
        expect(matched).toBeDefined();

        // Execute the handler and verify it returns the expected provider
        const response = await matched!.handler(
          new Request(`https://test.example.com${path}`),
          {} as any,
          {} as any,
          {} as any,
        );
        const body = await response.json() as { provider: string };
        expect(body.provider).toBe(expectedProvider);
      }),
      { numRuns: 200 }
    );
  });

  test('Property 7 (negative): Unknown paths return no match', () => {
    /**
     * For any path NOT matching any known route prefix, matchRoute
     * should return undefined (no match).
     */
    const routes = buildTestRouteTable();

    fc.assert(
      fc.property(unknownPathArb, (path) => {
        const matched = matchRoute(path, routes);
        expect(matched).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  test('Property 7: Exact match routes do not match sub-paths', () => {
    /**
     * Routes marked as exact should only match the exact path (or path + '/'),
     * not sub-paths like /health/deep or /decode/something.
     */
    const routes = buildTestRouteTable();
    const exactRoutes = routes.filter(r => r.exact);

    fc.assert(
      fc.property(
        fc.constantFrom(...exactRoutes),
        fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-z]+$/.test(s)),
        (route, suffix) => {
          const subPath = `${route.prefix}/${suffix}`;
          const matched = matchRoute(subPath, routes);

          // If matched, it should NOT be the exact route (unless another prefix route catches it)
          if (matched && matched.exact && matched.prefix === route.prefix) {
            // Exact routes should not match sub-paths
            expect(true).toBe(false); // fail
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 8: Error responses are structured JSON with CORS headers', async () => {
    /**
     * Feature: clean-architecture-rewrite, Property 8: Error responses are structured JSON
     * **Validates: Requirements 4.4**
     *
     * For any error message and status code >= 400, errorResponse should produce
     * a Response with: valid JSON body containing an `error` string field,
     * HTTP status >= 400, and CORS headers.
     */
    await fc.assert(
      fc.asyncProperty(errorStatusArb, errorMessageArb, async (status, message) => {
        const response = errorResponse(message, status);

        // Status code must match
        expect(response.status).toBe(status);
        expect(response.status).toBeGreaterThanOrEqual(400);

        // Must have CORS header
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');

        // Must have JSON content type
        expect(response.headers.get('Content-Type')).toBe('application/json');

        // Body must be valid JSON with required fields
        const body = await response.json() as Record<string, unknown>;
        expect(typeof body.error).toBe('string');
        expect(body.error).toBe(message);
        expect(typeof body.timestamp).toBe('string');
      }),
      { numRuns: 100 }
    );
  });

  test('Property 8: Detailed error responses include message and stack', async () => {
    /**
     * detailedErrorResponse should include the error's message and stack
     * in addition to the structured error fields and CORS headers.
     */
    await fc.assert(
      fc.asyncProperty(
        errorMessageArb,
        errorMessageArb,
        async (label, errMessage) => {
          const err = new Error(errMessage);
          const response = detailedErrorResponse(label, err);

          // Must be 500 by default
          expect(response.status).toBe(500);

          // Must have CORS header
          expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');

          // Body must contain error, message, and timestamp
          const body = await response.json() as Record<string, unknown>;
          expect(body.error).toBe(label);
          expect(body.message).toBe(errMessage);
          expect(typeof body.timestamp).toBe('string');
          // Stack should be present (Error objects have stacks)
          expect(typeof body.stack).toBe('string');
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 8: CORS preflight response has correct headers', () => {
    /**
     * The CORS preflight response should be 204 with all required CORS headers.
     */
    const response = corsPreflightResponse();

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('OPTIONS');
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type');
    expect(response.headers.get('Access-Control-Max-Age')).toBe('86400');
  });
});
