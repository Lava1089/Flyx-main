import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import {
  CookieJar,
  Cookie,
  TokenGenerator,
  generateTimestamp,
  isTokenExpired,
  HeaderBuilder,
  AuthHandler,
  createDLHDAuthHandler,
} from '../src/auth';

/**
 * Property 3: Auth Context Completeness
 * **Validates: Requirements 3.2, 3.3, 3.4**
 * 
 * For any authentication context created by Auth_Handler:
 * - All required cookies SHALL be preserved across subsequent requests
 * - Generated tokens SHALL match the expected format and contain valid timestamps
 * - Required headers (Referer, Origin, User-Agent) SHALL be included when the target requires them
 */
describe('Property 3: Auth Context Completeness', () => {
  // Generators for test data
  const cookieNameArb = fc.string({ minLength: 1, maxLength: 32 })
    .filter(s => /^[a-zA-Z0-9_-]+$/.test(s));
  
  // Cookie values must not contain characters that would be modified during parsing
  // Exclude: semicolons, commas, quotes, whitespace at start/end, equals signs
  const cookieValueArb = fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.~!*()'.split('')),
    { minLength: 1, maxLength: 50 }
  );

  const channelIdArb = fc.integer({ min: 1, max: 99999 }).map(n => n.toString());
  
  const playerIdArb = fc.integer({ min: 1, max: 6 });

  const urlArb = fc.webUrl({ withFragments: false, withQueryParameters: false });

  describe('Cookie Preservation', () => {
    /**
     * Property: All cookies added to the jar SHALL be retrievable
     */
    it('should preserve all cookies added to the jar', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              name: cookieNameArb,
              value: cookieValueArb,
            }),
            { minLength: 1, maxLength: 20 }
          ),
          (cookieData) => {
            const jar = new CookieJar();
            
            // Add all cookies
            for (const { name, value } of cookieData) {
              jar.setCookie({ name, value });
            }
            
            // Verify all cookies are preserved (last value wins for duplicates)
            const expectedCookies = new Map<string, string>();
            for (const { name, value } of cookieData) {
              expectedCookies.set(name, value);
            }
            
            const actualCookies = jar.getCookiesMap();
            
            // All expected cookies should be present
            for (const [name, value] of expectedCookies) {
              expect(actualCookies.get(name)).toBe(value);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Cookie header string SHALL contain all non-expired cookies
     */
    it('should include all cookies in the cookie header string', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              name: cookieNameArb,
              value: cookieValueArb,
            }),
            { minLength: 1, maxLength: 10 }
          ),
          (cookieData) => {
            const jar = new CookieJar();
            
            // Add all cookies
            for (const { name, value } of cookieData) {
              jar.setCookie({ name, value });
            }
            
            const cookieHeader = jar.getCookieHeader();
            
            // Build expected map (last value wins)
            const expectedCookies = new Map<string, string>();
            for (const { name, value } of cookieData) {
              expectedCookies.set(name, value);
            }
            
            // Each cookie should appear in the header
            for (const [name, value] of expectedCookies) {
              expect(cookieHeader).toContain(`${name}=${value}`);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Parsing Set-Cookie headers SHALL correctly extract cookie data
     */
    it('should correctly parse Set-Cookie headers', () => {
      fc.assert(
        fc.property(
          cookieNameArb,
          cookieValueArb,
          (name, value) => {
            const jar = new CookieJar();
            const setCookieHeader = `${name}=${value}; Path=/; HttpOnly`;
            
            const cookie = jar.setFromHeader(setCookieHeader);
            
            expect(cookie).not.toBeNull();
            expect(cookie?.name).toBe(name);
            expect(cookie?.value).toBe(value);
            expect(cookie?.httpOnly).toBe(true);
            expect(cookie?.path).toBe('/');
            
            // Cookie should be retrievable
            expect(jar.getCookie(name)?.value).toBe(value);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Token Generation', () => {
    /**
     * Property: Generated tokens SHALL contain valid timestamps
     */
    it('should generate tokens with valid timestamps', () => {
      fc.assert(
        fc.property(
          channelIdArb,
          playerIdArb,
          (channelId, playerId) => {
            const generator = new TokenGenerator();
            const beforeTime = generateTimestamp();
            
            const token = generator.generate('stream', { channelId, playerId });
            
            const afterTime = generateTimestamp();
            
            // Token timestamp should be within the generation window
            expect(token.timestamp).toBeGreaterThanOrEqual(beforeTime);
            expect(token.timestamp).toBeLessThanOrEqual(afterTime);
            
            // Token should not be expired immediately
            expect(isTokenExpired(token)).toBe(false);
            
            // Token should have correct type
            expect(token.type).toBe('stream');
            
            // Token string should be non-empty
            expect(token.token.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Token expiration SHALL be set correctly
     */
    it('should set token expiration correctly', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('session', 'stream', 'embed', 'signature') as fc.Arbitrary<'session' | 'stream' | 'embed' | 'signature'>,
          channelIdArb,
          playerIdArb,
          (tokenType, channelId, playerId) => {
            const generator = new TokenGenerator();
            const token = generator.generate(tokenType, { channelId, playerId });
            
            // Expiration should be in the future
            expect(token.expiresAt).toBeGreaterThan(Date.now());
            
            // Expiration should be based on timestamp (30 min default)
            const expectedExpiry = token.timestamp * 1000 + 30 * 60 * 1000;
            expect(token.expiresAt).toBe(expectedExpiry);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Cached tokens SHALL be returned if still valid
     */
    it('should return cached tokens if still valid', () => {
      fc.assert(
        fc.property(
          channelIdArb,
          playerIdArb,
          (channelId, playerId) => {
            const generator = new TokenGenerator();
            
            // Generate first token
            const token1 = generator.generate('stream', { channelId, playerId });
            
            // Get cached token
            const cached = generator.getCached('stream', channelId, playerId);
            
            // Should return the same token
            expect(cached).not.toBeNull();
            expect(cached?.token).toBe(token1.token);
            expect(cached?.timestamp).toBe(token1.timestamp);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Header Building', () => {
    /**
     * Property: Required headers SHALL always be included
     */
    it('should always include required headers (User-Agent, Referer, Origin)', () => {
      fc.assert(
        fc.property(
          fc.webUrl(),
          fc.option(fc.webUrl(), { nil: undefined }),
          (targetUrl, referer) => {
            const builder = new HeaderBuilder();
            const headers = builder.build({
              toUrl: targetUrl,
              fromUrl: referer,
              navigationType: 'document',
            });
            
            // User-Agent must be present and non-empty
            expect(headers['User-Agent']).toBeDefined();
            expect(headers['User-Agent'].length).toBeGreaterThan(0);
            
            // Referer must be present
            expect(headers['Referer']).toBeDefined();
            
            // Origin must be present
            expect(headers['Origin']).toBeDefined();
            
            // Accept must be present
            expect(headers['Accept']).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Cookie header SHALL be included when cookies are present
     */
    it('should include Cookie header when cookies are present', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              name: cookieNameArb,
              value: cookieValueArb,
            }),
            { minLength: 1, maxLength: 5 }
          ),
          fc.webUrl(),
          (cookieData, targetUrl) => {
            const cookieJar = new CookieJar();
            for (const { name, value } of cookieData) {
              cookieJar.setCookie({ name, value });
            }
            
            const builder = new HeaderBuilder({ cookieJar });
            const headers = builder.build({
              toUrl: targetUrl,
              navigationType: 'document',
            });
            
            // Cookie header should be present
            expect(headers['Cookie']).toBeDefined();
            expect(headers['Cookie'].length).toBeGreaterThan(0);
            
            // All cookies should be in the header
            const expectedCookies = new Map<string, string>();
            for (const { name, value } of cookieData) {
              expectedCookies.set(name, value);
            }
            
            for (const [name, value] of expectedCookies) {
              expect(headers['Cookie']).toContain(`${name}=${value}`);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Sec-Fetch headers SHALL be appropriate for navigation type
     */
    it('should set appropriate Sec-Fetch headers for navigation type', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('document', 'embed', 'media', 'xhr', 'fetch') as fc.Arbitrary<'document' | 'embed' | 'media' | 'xhr' | 'fetch'>,
          fc.webUrl(),
          (navigationType, targetUrl) => {
            const builder = new HeaderBuilder();
            const headers = builder.build({
              toUrl: targetUrl,
              navigationType,
            });
            
            // Sec-Fetch-Dest should be present
            expect(headers['Sec-Fetch-Dest']).toBeDefined();
            
            // Sec-Fetch-Mode should be present
            expect(headers['Sec-Fetch-Mode']).toBeDefined();
            
            // Values should match navigation type
            if (navigationType === 'document') {
              expect(headers['Sec-Fetch-Dest']).toBe('document');
              expect(headers['Sec-Fetch-Mode']).toBe('navigate');
            } else if (navigationType === 'embed') {
              expect(headers['Sec-Fetch-Dest']).toBe('iframe');
            } else if (navigationType === 'media') {
              expect(headers['Sec-Fetch-Dest']).toBe('video');
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('AuthHandler Integration', () => {
    /**
     * Property: AuthContext SHALL contain all required components
     */
    it('should build complete AuthContext with all components', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              name: cookieNameArb,
              value: cookieValueArb,
            }),
            { minLength: 0, maxLength: 5 }
          ),
          async (cookieData) => {
            const handler = createDLHDAuthHandler();
            
            // Add some cookies
            for (const { name, value } of cookieData) {
              handler.addCookie({ name, value });
            }
            
            // Initialize session
            const context = await handler.initSession();
            
            // Context should have all required fields
            expect(context.cookies).toBeInstanceOf(Map);
            expect(context.tokens).toBeInstanceOf(Map);
            expect(context.headers).toBeDefined();
            expect(typeof context.timestamp).toBe('number');
            
            // Cookies should be preserved
            const expectedCookies = new Map<string, string>();
            for (const { name, value } of cookieData) {
              expectedCookies.set(name, value);
            }
            
            for (const [name, value] of expectedCookies) {
              expect(context.cookies.get(name)).toBe(value);
            }
            
            // Headers should include required fields
            expect(context.headers['User-Agent']).toBeDefined();
            expect(context.headers['Referer']).toBeDefined();
            expect(context.headers['Origin']).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Session state SHALL be properly maintained
     */
    it('should maintain session state correctly', async () => {
      const handler = createDLHDAuthHandler();
      
      // Initially not valid
      expect(handler.isSessionValid()).toBe(false);
      
      // After init, should be valid
      await handler.initSession();
      expect(handler.isSessionValid()).toBe(true);
      
      // Session state should be populated
      const state = handler.getSessionState();
      expect(state.initialized).toBe(true);
      expect(state.createdAt).toBeGreaterThan(0);
      expect(state.expiresAt).toBeGreaterThan(Date.now());
      
      // After clear, should not be valid
      handler.clearSession();
      expect(handler.isSessionValid()).toBe(false);
    });
  });
});
