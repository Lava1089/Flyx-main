import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import {
  checkRateLimit,
  getRateLimitConfig,
  createRateLimitErrorResponse,
  RateLimitResult,
} from '../src/middleware/rate-limit';
import { Env, RateLimitData } from '../src/types';

/**
 * Property 15: Rate Limiting Enforcement
 * **Validates: Requirements 8.3**
 * 
 * For any API key, requests exceeding the configured rate limit 
 * SHALL be rejected with 429 status and appropriate retry-after information.
 */
describe('Property 15: Rate Limiting Enforcement', () => {
  // Mock KV store for testing
  class MockKVNamespace {
    private store: Map<string, string> = new Map();

    async get(key: string, type?: 'json' | 'text'): Promise<unknown> {
      const value = this.store.get(key);
      if (!value) return null;
      if (type === 'json') return JSON.parse(value);
      return value;
    }

    async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
      this.store.set(key, value);
    }

    async delete(key: string): Promise<void> {
      this.store.delete(key);
    }

    clear(): void {
      this.store.clear();
    }

    // Helper to set rate limit data directly for testing
    setRateLimitData(apiKey: string, data: RateLimitData): void {
      this.store.set(`ratelimit:${apiKey}`, JSON.stringify(data));
    }
  }

  let mockKV: MockKVNamespace;

  beforeEach(() => {
    mockKV = new MockKVNamespace();
  });

  function createMockEnv(windowMs: number = 60000, maxRequests: number = 100): Env {
    return {
      RATE_LIMIT_KV: mockKV as unknown as KVNamespace,
      RATE_LIMIT_WINDOW_MS: windowMs.toString(),
      RATE_LIMIT_MAX_REQUESTS: maxRequests.toString(),
    };
  }

  // Generator for valid API keys
  const validApiKeyArb = fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'),
    { minLength: 8, maxLength: 32 }
  );

  it('should allow requests within rate limit', async () => {
    await fc.assert(
      fc.asyncProperty(
        validApiKeyArb,
        fc.integer({ min: 2, max: 50 }), // maxRequests
        fc.integer({ min: 1, max: 49 }), // requestCount (less than max)
        async (apiKey, maxRequests, requestCount) => {
          mockKV.clear(); // Clear KV between test runs
          // Ensure requestCount is less than maxRequests
          const actualRequestCount = Math.min(requestCount, maxRequests - 1);
          const env = createMockEnv(60000, maxRequests);

          // Make multiple requests
          let lastResult: RateLimitResult | null = null;
          for (let i = 0; i < actualRequestCount; i++) {
            lastResult = await checkRateLimit(apiKey, env);
            expect(lastResult.allowed).toBe(true);
          }

          // Verify remaining count is correct
          if (lastResult) {
            expect(lastResult.remaining).toBe(maxRequests - actualRequestCount);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should reject requests exceeding rate limit with 429', async () => {
    await fc.assert(
      fc.asyncProperty(
        validApiKeyArb,
        fc.integer({ min: 2, max: 20 }), // maxRequests (min 2 for clearer test)
        async (apiKey, maxRequests) => {
          mockKV.clear(); // Clear KV between test runs
          const env = createMockEnv(60000, maxRequests);

          // Make requests up to the limit
          for (let i = 0; i < maxRequests; i++) {
            const result = await checkRateLimit(apiKey, env);
            expect(result.allowed).toBe(true);
          }

          // Next request should be rejected
          const rejectedResult = await checkRateLimit(apiKey, env);
          expect(rejectedResult.allowed).toBe(false);
          expect(rejectedResult.remaining).toBe(0);
          expect(rejectedResult.error).toBe('Rate limit exceeded');
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should include retry-after information in rate limit error response', async () => {
    await fc.assert(
      fc.asyncProperty(
        validApiKeyArb,
        fc.integer({ min: 1, max: 10 }), // maxRequests
        async (apiKey, maxRequests) => {
          mockKV.clear(); // Clear KV between test runs
          const windowMs = 60000;
          const env = createMockEnv(windowMs, maxRequests);

          // Exhaust rate limit
          for (let i = 0; i < maxRequests; i++) {
            await checkRateLimit(apiKey, env);
          }

          // Get rejected result
          const rejectedResult = await checkRateLimit(apiKey, env);
          expect(rejectedResult.allowed).toBe(false);

          // Create error response
          const response = createRateLimitErrorResponse(rejectedResult);
          
          expect(response.status).toBe(429);
          expect(response.headers.get('Retry-After')).toBeTruthy();
          expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');
          expect(response.headers.get('X-RateLimit-Reset')).toBeTruthy();

          // Parse response body
          const body = await response.json() as { success: boolean; code: string; details?: { retryAfter: number } };
          expect(body.success).toBe(false);
          expect(body.code).toBe('RATE_LIMITED');
          expect(body.details?.retryAfter).toBeGreaterThan(0);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should reset rate limit after window expires', async () => {
    await fc.assert(
      fc.asyncProperty(
        validApiKeyArb,
        fc.integer({ min: 1, max: 10 }), // maxRequests
        async (apiKey, maxRequests) => {
          mockKV.clear(); // Clear KV between test runs
          const windowMs = 1000; // 1 second window for testing
          const env = createMockEnv(windowMs, maxRequests);

          // Exhaust rate limit
          for (let i = 0; i < maxRequests; i++) {
            await checkRateLimit(apiKey, env);
          }

          // Verify rate limit is exhausted
          const exhaustedResult = await checkRateLimit(apiKey, env);
          expect(exhaustedResult.allowed).toBe(false);

          // Simulate window expiration by setting old windowStart
          const oldData: RateLimitData = {
            windowMs,
            maxRequests,
            currentCount: maxRequests,
            windowStart: Date.now() - windowMs - 1000, // Expired
          };
          mockKV.setRateLimitData(apiKey, oldData);

          // Next request should be allowed (new window)
          const newWindowResult = await checkRateLimit(apiKey, env);
          expect(newWindowResult.allowed).toBe(true);
          expect(newWindowResult.remaining).toBe(maxRequests - 1);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should track rate limits independently per API key', async () => {
    await fc.assert(
      fc.asyncProperty(
        validApiKeyArb,
        validApiKeyArb,
        fc.integer({ min: 1, max: 10 }), // maxRequests
        async (apiKey1, apiKey2, maxRequests) => {
          // Skip if keys are the same
          if (apiKey1 === apiKey2) return;

          mockKV.clear(); // Clear KV between test runs
          const env = createMockEnv(60000, maxRequests);

          // Exhaust rate limit for apiKey1
          for (let i = 0; i < maxRequests; i++) {
            await checkRateLimit(apiKey1, env);
          }

          // apiKey1 should be rate limited
          const key1Result = await checkRateLimit(apiKey1, env);
          expect(key1Result.allowed).toBe(false);

          // apiKey2 should still be allowed
          const key2Result = await checkRateLimit(apiKey2, env);
          expect(key2Result.allowed).toBe(true);
          expect(key2Result.remaining).toBe(maxRequests - 1);
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe('getRateLimitConfig', () => {
  it('should return default values when env vars are not set', () => {
    const env: Env = {
      RATE_LIMIT_KV: {} as KVNamespace,
    };

    const config = getRateLimitConfig(env);
    expect(config.windowMs).toBe(60000);
    expect(config.maxRequests).toBe(100);
  });

  it('should parse env vars correctly', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1000, max: 3600000 }), // windowMs
        fc.integer({ min: 1, max: 10000 }), // maxRequests
        (windowMs, maxRequests) => {
          const env: Env = {
            RATE_LIMIT_KV: {} as KVNamespace,
            RATE_LIMIT_WINDOW_MS: windowMs.toString(),
            RATE_LIMIT_MAX_REQUESTS: maxRequests.toString(),
          };

          const config = getRateLimitConfig(env);
          expect(config.windowMs).toBe(windowMs);
          expect(config.maxRequests).toBe(maxRequests);
        }
      ),
      { numRuns: 100 }
    );
  });
});
