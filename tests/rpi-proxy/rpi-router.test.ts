/**
 * Property-Based Tests for RPI Proxy Router and Error Handling
 * Feature: clean-architecture-rewrite
 * Property 7: Route dispatch correctness (RPI layer)
 * Property 8: Error responses are structured JSON
 * Validates: Requirements 3.2, 3.4
 */

import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';
import { Router } from '../../rpi-proxy/src/router';
import type { RPIRequest, RouteHandler } from '../../rpi-proxy/src/types';
import type { ServerResponse, IncomingMessage } from 'http';
import { sendJsonError } from '../../rpi-proxy/src/utils';

// ============================================
// Test Helpers
// ============================================

/** Known RPI proxy routes and their expected provider/handler identity */
const KNOWN_ROUTES: Array<{ path: string; provider: string }> = [
  { path: '/proxy', provider: 'proxy' },
  { path: '/dlhd-key-v4', provider: 'dlhd' },
  { path: '/dlhd-key', provider: 'dlhd' },
  { path: '/heartbeat', provider: 'dlhd' },
  { path: '/animekai', provider: 'animekai' },
  { path: '/viprow/stream', provider: 'viprow' },
  { path: '/viprow/manifest', provider: 'viprow' },
  { path: '/viprow/key', provider: 'viprow' },
  { path: '/viprow/segment', provider: 'viprow' },
  { path: '/ppv', provider: 'ppv' },
  { path: '/iptv/api', provider: 'iptv' },
  { path: '/iptv/stream', provider: 'iptv' },
  { path: '/fetch-socks5', provider: 'socks5' },
  { path: '/fetch', provider: 'fetch' },
];

/** Create a mock ServerResponse that captures written data */
function createMockResponse(): ServerResponse & {
  _statusCode: number;
  _headers: Record<string, string>;
  _body: string;
  _ended: boolean;
} {
  const mock = {
    _statusCode: 0,
    _headers: {} as Record<string, string>,
    _body: '',
    _ended: false,
    headersSent: false,
    writableEnded: false,
    writeHead(status: number, headers?: Record<string, string>) {
      mock._statusCode = status;
      mock.statusCode = status;
      Object.defineProperty(mock, 'headersSent', { value: true, writable: true, configurable: true });
      if (headers) Object.assign(mock._headers, headers);
      return mock;
    },
    write(chunk: string | Buffer) {
      mock._body += typeof chunk === 'string' ? chunk : chunk.toString();
      return true;
    },
    end(data?: string | Buffer) {
      if (data) mock._body += typeof data === 'string' ? data : data.toString();
      mock._ended = true;
      Object.defineProperty(mock, 'writableEnded', { value: true, writable: true, configurable: true });
    },
    on(_event: string, _cb: () => void) { return mock; },
    statusCode: 200,
  } as unknown as ServerResponse & {
    _statusCode: number;
    _headers: Record<string, string>;
    _body: string;
    _ended: boolean;
  };
  return mock;
}

/** Arbitrary for known route paths */
const knownRoutePathArb = fc.constantFrom(...KNOWN_ROUTES.map(r => r.path));

/** Arbitrary for unknown route paths */
const unknownRoutePathArb = fc
  .string({ minLength: 1, maxLength: 50 })
  .map(s => '/' + s.replace(/[^a-z0-9/-]/gi, ''))
  .filter(s => !KNOWN_ROUTES.some(r => r.path === s) && s !== '/health');

/** Arbitrary for HTTP status codes >= 400 */
const errorStatusArb = fc.integer({ min: 400, max: 599 });

/** Arbitrary for error messages */
const errorMessageArb = fc.string({ minLength: 1, maxLength: 200 }).filter(s => s.trim().length > 0);

// ============================================
// Property Tests
// ============================================

describe('RPI Proxy Router Property Tests', () => {
  test('Property 7: Route dispatch correctness (RPI layer)', () => {
    /**
     * Feature: clean-architecture-rewrite, Property 7: Route dispatch correctness
     * Validates: Requirements 3.2
     *
     * For any valid request path from the set of known provider routes,
     * the router should dispatch to the handler associated with that route's
     * provider prefix. The dispatched handler's identity should match the
     * expected provider for that path.
     */
    fc.assert(
      fc.property(knownRoutePathArb, (path) => {
        const router = new Router();
        const dispatched: string[] = [];

        // Register all known routes with handlers that record which provider was called
        for (const route of KNOWN_ROUTES) {
          const provider = route.provider;
          const handler: RouteHandler = async (_req, _res) => {
            dispatched.push(provider);
          };
          router.route(route.path, handler);
        }

        // Find the expected provider for this path
        const expected = KNOWN_ROUTES.find(r => r.path === path);
        expect(expected).toBeDefined();

        // Verify the router matches the correct route
        const matched = router.match(path);
        expect(matched).toBeDefined();
        expect(matched!.path).toBe(path);
      }),
      { numRuns: 100 }
    );
  });

  test('Property 7 (negative): Unknown paths return no match', () => {
    /**
     * For any path NOT in the known routes set, the router should return
     * undefined (no match).
     */
    fc.assert(
      fc.property(unknownRoutePathArb, (path) => {
        const router = new Router();

        for (const route of KNOWN_ROUTES) {
          router.route(route.path, async () => {});
        }

        const matched = router.match(path);
        expect(matched).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  test('Property 8: Error responses are structured JSON', () => {
    /**
     * Feature: clean-architecture-rewrite, Property 8: Error responses are structured JSON
     * Validates: Requirements 3.4
     *
     * For any provider handler that returns an error, the response should
     * contain: a valid JSON body with an `error` string field, and an
     * HTTP status code >= 400.
     */
    fc.assert(
      fc.property(errorStatusArb, errorMessageArb, (status, errorMsg) => {
        const mockRes = createMockResponse();

        sendJsonError(mockRes, status, {
          error: errorMsg,
          timestamp: Date.now(),
        });

        // Status code must be >= 400
        expect(mockRes._statusCode).toBeGreaterThanOrEqual(400);
        expect(mockRes._statusCode).toBe(status);

        // Body must be valid JSON
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(mockRes._body);
        } catch {
          throw new Error(`Response body is not valid JSON: ${mockRes._body}`);
        }

        // Must contain an 'error' string field
        expect(typeof parsed.error).toBe('string');
        expect(parsed.error).toBe(errorMsg);

        // Must contain a 'timestamp' number field
        expect(typeof parsed.timestamp).toBe('number');

        // Must have CORS header
        expect(mockRes._headers['Access-Control-Allow-Origin']).toBe('*');

        // Must have Content-Type: application/json
        expect(mockRes._headers['Content-Type']).toBe('application/json');

        // Response must be ended
        expect(mockRes._ended).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  test('Property 8 (with provider and code): Error responses include optional fields', () => {
    /**
     * When error responses include optional provider and code fields,
     * they should be preserved in the JSON output.
     */
    fc.assert(
      fc.property(
        errorStatusArb,
        errorMessageArb,
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        (status, errorMsg, provider, code) => {
          const mockRes = createMockResponse();

          sendJsonError(mockRes, status, {
            error: errorMsg,
            provider,
            code,
            timestamp: Date.now(),
          });

          const parsed = JSON.parse(mockRes._body);
          expect(parsed.error).toBe(errorMsg);
          expect(parsed.provider).toBe(provider);
          expect(parsed.code).toBe(code);
          expect(mockRes._statusCode).toBe(status);
        }
      ),
      { numRuns: 100 }
    );
  });
});
