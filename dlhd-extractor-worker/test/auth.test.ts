import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validateApiKey, parseApiKeys, AuthResult } from '../src/middleware/auth';
import { Env } from '../src/types';

/**
 * Property 14: API Key Validation
 * **Validates: Requirements 8.1, 8.2**
 * 
 * - Requests without an API key SHALL be rejected with 401
 * - Requests with an invalid API key SHALL be rejected with 403
 * - Only requests with valid API keys SHALL proceed
 */
describe('Property 14: API Key Validation', () => {
  // Helper to create mock request with optional API key
  function createMockRequest(apiKey?: string): Request {
    const headers = new Headers();
    if (apiKey !== undefined) {
      headers.set('X-API-Key', apiKey);
    }
    return new Request('https://example.com/test', { headers });
  }

  // Helper to create mock env with API keys
  function createMockEnv(apiKeys: string[]): Env {
    return {
      API_KEYS: apiKeys.join(','),
      RATE_LIMIT_KV: {} as KVNamespace,
    };
  }

  // Generator for valid API keys (alphanumeric, no leading/trailing whitespace)
  const validApiKeyArb = fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'),
    { minLength: 8, maxLength: 32 }
  );

  it('should reject requests without API key with 401', () => {
    fc.assert(
      fc.property(
        // Generate random valid API keys for the environment
        fc.array(validApiKeyArb, { minLength: 1, maxLength: 5 }),
        (validKeys) => {
          const env = createMockEnv(validKeys);
          const request = createMockRequest(); // No API key
          
          const result = validateApiKey(request, env);
          
          expect(result.valid).toBe(false);
          expect(result.statusCode).toBe(401);
          expect(result.error).toBe('Missing API key');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should reject requests with invalid API key with 403', () => {
    fc.assert(
      fc.property(
        // Generate valid keys and an invalid key that's not in the list
        fc.array(validApiKeyArb, { minLength: 1, maxLength: 5 }),
        validApiKeyArb,
        (validKeys, invalidKey) => {
          // Ensure invalidKey is not in validKeys
          const filteredValidKeys = validKeys.filter(k => k !== invalidKey);
          if (filteredValidKeys.length === 0) {
            filteredValidKeys.push('default-valid-key-12345');
          }
          
          const env = createMockEnv(filteredValidKeys);
          const request = createMockRequest(invalidKey);
          
          // Only test if invalidKey is truly not in the valid keys
          if (!filteredValidKeys.includes(invalidKey)) {
            const result = validateApiKey(request, env);
            
            expect(result.valid).toBe(false);
            expect(result.statusCode).toBe(403);
            expect(result.error).toBe('Invalid API key');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should accept requests with valid API key', () => {
    fc.assert(
      fc.property(
        // Generate valid keys and pick one to use
        fc.array(validApiKeyArb, { minLength: 1, maxLength: 5 }),
        fc.nat(),
        (validKeys, indexSeed) => {
          if (validKeys.length === 0) return;
          
          const env = createMockEnv(validKeys);
          const selectedKey = validKeys[indexSeed % validKeys.length];
          const request = createMockRequest(selectedKey);
          
          const result = validateApiKey(request, env);
          
          expect(result.valid).toBe(true);
          expect(result.apiKey).toBe(selectedKey);
          expect(result.statusCode).toBeUndefined();
          expect(result.error).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should allow all requests when no API keys are configured (dev mode)', () => {
    fc.assert(
      fc.property(
        // Generate non-whitespace keys
        validApiKeyArb,
        (anyKey) => {
          const env = createMockEnv([]); // No keys configured
          const request = createMockRequest(anyKey);
          
          const result = validateApiKey(request, env);
          
          expect(result.valid).toBe(true);
          expect(result.apiKey).toBe(anyKey);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should reject whitespace-only API keys with 401 (treated as missing)', () => {
    // Note: The Headers API normalizes whitespace-only values to empty strings,
    // which are then treated as "missing" (401) rather than "invalid" (403)
    fc.assert(
      fc.property(
        // Generate whitespace-only strings
        fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 1, maxLength: 10 }),
        // Generate at least one valid key so we're not in dev mode
        fc.array(validApiKeyArb, { minLength: 1, maxLength: 5 }),
        (whitespaceKey, validKeys) => {
          const env = createMockEnv(validKeys);
          const request = createMockRequest(whitespaceKey);
          
          const result = validateApiKey(request, env);
          
          // Whitespace-only keys are normalized to empty by Headers API,
          // so they're treated as missing (401)
          expect(result.valid).toBe(false);
          expect(result.statusCode).toBe(401);
          expect(result.error).toBe('Missing API key');
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('parseApiKeys', () => {
  // Generator for valid API keys
  const validApiKeyArb = fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'),
    { minLength: 1, maxLength: 32 }
  );

  it('should parse comma-separated API keys correctly', () => {
    fc.assert(
      fc.property(
        fc.array(validApiKeyArb, { minLength: 1, maxLength: 10 }),
        (keys) => {
          const env: Env = {
            API_KEYS: keys.join(','),
            RATE_LIMIT_KV: {} as KVNamespace,
          };
          
          const parsed = parseApiKeys(env);
          
          // All non-empty trimmed keys should be in the set
          const expectedKeys = keys.map(k => k.trim()).filter(k => k.length > 0);
          for (const key of expectedKeys) {
            expect(parsed.has(key)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return empty set for empty or undefined API_KEYS', () => {
    const envEmpty: Env = { API_KEYS: '', RATE_LIMIT_KV: {} as KVNamespace };
    const envUndefined: Env = { RATE_LIMIT_KV: {} as KVNamespace };
    
    expect(parseApiKeys(envEmpty).size).toBe(0);
    expect(parseApiKeys(envUndefined).size).toBe(0);
  });
});
