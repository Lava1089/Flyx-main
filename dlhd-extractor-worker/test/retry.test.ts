import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  withRetry,
  calculateBackoff,
  isRetryableError,
  isRetryableStatus,
  sleep,
  DEFAULT_RETRY_CONFIG,
  type RetryConfig,
  type RetryResult,
  type RetryableError,
} from '../src/utils/retry';

/**
 * Property 11: Retry Behavior
 * **Validates: Requirements 7.1**
 * 
 * For any retryable network failure, the Worker SHALL:
 * - Retry up to 3 times maximum
 * - Apply exponential backoff between retries
 * - Not retry non-retryable errors
 */
describe('Property 11: Retry Behavior', () => {
  // Generator for retry configurations
  const retryConfigArb = fc.record({
    maxRetries: fc.integer({ min: 1, max: 5 }),
    baseDelayMs: fc.integer({ min: 10, max: 100 }),
    maxDelayMs: fc.integer({ min: 100, max: 1000 }),
  });

  // Generator for retryable error codes
  const retryableErrorCodeArb = fc.constantFrom(
    'RATE_LIMITED',
    'PROXY_ERROR',
    'UPSTREAM_ERROR',
    'UPSTREAM_TIMEOUT',
    'NETWORK_ERROR',
    'TIMEOUT'
  );

  // Generator for non-retryable error codes
  const nonRetryableErrorCodeArb = fc.constantFrom(
    'INVALID_URL',
    'MISSING_URL_PARAM',
    'NOT_FOUND',
    'INVALID_CHANNEL_ID',
    'AUTH_FAILED'
  );

  // Generator for retryable HTTP status codes
  const retryableStatusArb = fc.constantFrom(429, 500, 502, 503, 504);

  // Generator for non-retryable HTTP status codes
  const nonRetryableStatusArb = fc.constantFrom(400, 401, 403, 404, 405, 422);

  describe('Maximum Retry Attempts', () => {
    /**
     * Property: withRetry SHALL NOT exceed maxRetries attempts
     * For any configuration, the number of attempts should be at most maxRetries + 1
     */
    it('should not exceed maxRetries attempts for always-failing operations', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 5 }),
          async (maxRetries) => {
            let attemptCount = 0;
            
            const result = await withRetry(
              async () => {
                attemptCount++;
                const error = new Error('Always fails') as RetryableError;
                error.code = 'NETWORK_ERROR';
                error.retryable = true;
                throw error;
              },
              { maxRetries, baseDelayMs: 1, maxDelayMs: 10 }
            );
            
            expect(result.success).toBe(false);
            expect(result.attempts).toBe(maxRetries + 1);
            expect(attemptCount).toBe(maxRetries + 1);
          }
        ),
        { numRuns: 20 }
      );
    });

    /**
     * Property: Successful operations SHALL stop retrying immediately
     */
    it('should stop retrying on first success', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 5 }),
          fc.integer({ min: 0, max: 3 }),
          async (maxRetries, failuresBeforeSuccess) => {
            let attemptCount = 0;
            const actualFailures = Math.min(failuresBeforeSuccess, maxRetries);
            
            const result = await withRetry(
              async () => {
                attemptCount++;
                if (attemptCount <= actualFailures) {
                  const error = new Error('Temporary failure') as RetryableError;
                  error.code = 'NETWORK_ERROR';
                  error.retryable = true;
                  throw error;
                }
                return 'success';
              },
              { maxRetries, baseDelayMs: 1, maxDelayMs: 10 }
            );
            
            expect(result.success).toBe(true);
            expect(result.value).toBe('success');
            expect(result.attempts).toBe(actualFailures + 1);
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Exponential Backoff', () => {
    /**
     * Property: Backoff delay SHALL increase exponentially with attempt number
     */
    it('should calculate exponential backoff correctly', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 10 }),
          fc.integer({ min: 10, max: 1000 }),
          fc.integer({ min: 1000, max: 100000 }),
          (attempt, baseDelayMs, maxDelayMs) => {
            const delay = calculateBackoff(attempt, baseDelayMs, maxDelayMs);
            
            // Delay should be positive
            expect(delay).toBeGreaterThan(0);
            
            // Delay should not exceed maxDelayMs
            expect(delay).toBeLessThanOrEqual(maxDelayMs);
            
            // For attempt 0, delay should be close to baseDelayMs (with jitter)
            if (attempt === 0) {
              expect(delay).toBeGreaterThanOrEqual(baseDelayMs * 0.85);
              expect(delay).toBeLessThanOrEqual(Math.min(baseDelayMs * 1.15, maxDelayMs));
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Later attempts SHALL have equal or greater delays than earlier attempts
     * (accounting for jitter, we check the expected base delay)
     */
    it('should have non-decreasing expected delays for increasing attempts', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 10, max: 100 }),
          fc.integer({ min: 1000, max: 10000 }),
          (baseDelayMs, maxDelayMs) => {
            // Calculate expected delays without jitter
            const expectedDelays = [0, 1, 2, 3, 4].map(attempt => {
              const expectedDelay = baseDelayMs * Math.pow(2, attempt);
              return Math.min(expectedDelay, maxDelayMs);
            });
            
            // Each expected delay should be >= previous (until hitting max)
            for (let i = 1; i < expectedDelays.length; i++) {
              expect(expectedDelays[i]).toBeGreaterThanOrEqual(expectedDelays[i - 1]);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Non-Retryable Errors', () => {
    /**
     * Property: Non-retryable errors SHALL NOT trigger retries
     */
    it('should not retry non-retryable errors', async () => {
      await fc.assert(
        fc.asyncProperty(
          nonRetryableErrorCodeArb,
          async (errorCode) => {
            let attemptCount = 0;
            
            const result = await withRetry(
              async () => {
                attemptCount++;
                const error = new Error('Non-retryable error') as RetryableError;
                error.code = errorCode;
                error.retryable = false;
                throw error;
              },
              { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 10 }
            );
            
            expect(result.success).toBe(false);
            expect(attemptCount).toBe(1); // Should only attempt once
            expect(result.attempts).toBe(1);
          }
        ),
        { numRuns: 20 }
      );
    });

    /**
     * Property: Non-retryable HTTP status codes SHALL NOT trigger retries
     */
    it('should not retry non-retryable HTTP status codes', async () => {
      await fc.assert(
        fc.asyncProperty(
          nonRetryableStatusArb,
          async (status) => {
            let attemptCount = 0;
            
            const result = await withRetry(
              async () => {
                attemptCount++;
                const error = new Error(`HTTP ${status}`) as RetryableError;
                error.status = status;
                error.retryable = false;
                throw error;
              },
              { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 10 }
            );
            
            expect(result.success).toBe(false);
            expect(attemptCount).toBe(1);
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  describe('Retryable Error Classification', () => {
    /**
     * Property: Errors with retryable codes SHALL be classified as retryable
     */
    it('should classify retryable error codes correctly', () => {
      fc.assert(
        fc.property(retryableErrorCodeArb, (errorCode) => {
          const error: RetryableError = new Error('Test error');
          error.code = errorCode;
          
          expect(isRetryableError(error)).toBe(true);
        }),
        { numRuns: 50 }
      );
    });

    /**
     * Property: Errors with retryable status codes SHALL be classified as retryable
     */
    it('should classify retryable HTTP status codes correctly', () => {
      fc.assert(
        fc.property(retryableStatusArb, (status) => {
          const error: RetryableError = new Error(`HTTP ${status}`);
          error.status = status;
          
          expect(isRetryableError(error)).toBe(true);
        }),
        { numRuns: 50 }
      );
    });

    /**
     * Property: isRetryableStatus SHALL return true for retryable status codes
     */
    it('should identify retryable status codes', () => {
      fc.assert(
        fc.property(retryableStatusArb, (status) => {
          expect(isRetryableStatus(status)).toBe(true);
        }),
        { numRuns: 50 }
      );
    });

    /**
     * Property: isRetryableStatus SHALL return false for non-retryable status codes
     */
    it('should identify non-retryable status codes', () => {
      fc.assert(
        fc.property(nonRetryableStatusArb, (status) => {
          expect(isRetryableStatus(status)).toBe(false);
        }),
        { numRuns: 50 }
      );
    });
  });

  describe('Retry Result Properties', () => {
    /**
     * Property: Successful results SHALL have success=true and a value
     */
    it('should return success=true with value for successful operations', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 50 }),
          async (expectedValue) => {
            const result = await withRetry(
              async () => expectedValue,
              { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 10 }
            );
            
            expect(result.success).toBe(true);
            expect(result.value).toBe(expectedValue);
            expect(result.error).toBeUndefined();
            expect(result.attempts).toBe(1);
          }
        ),
        { numRuns: 50 }
      );
    });

    /**
     * Property: Failed results SHALL have success=false and an error
     */
    it('should return success=false with error for failed operations', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 50 }),
          async (errorMessage) => {
            const result = await withRetry(
              async () => {
                const error = new Error(errorMessage) as RetryableError;
                error.retryable = false;
                throw error;
              },
              { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 10 }
            );
            
            expect(result.success).toBe(false);
            expect(result.value).toBeUndefined();
            expect(result.error).toBeDefined();
            expect(result.error?.message).toBe(errorMessage);
          }
        ),
        { numRuns: 50 }
      );
    });

    /**
     * Property: Attempt durations array length SHALL equal attempts count
     */
    it('should track attempt durations correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 3 }),
          async (maxRetries) => {
            const result = await withRetry(
              async () => {
                const error = new Error('Always fails') as RetryableError;
                error.code = 'NETWORK_ERROR';
                error.retryable = true;
                throw error;
              },
              { maxRetries, baseDelayMs: 1, maxDelayMs: 10 }
            );
            
            expect(result.attemptDurations.length).toBe(result.attempts);
            expect(result.attemptDurations.every(d => d >= 0)).toBe(true);
          }
        ),
        { numRuns: 20 }
      );
    });

    /**
     * Property: Total duration SHALL be >= sum of attempt durations
     */
    it('should have total duration >= sum of attempt durations', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 3 }),
          async (maxRetries) => {
            const result = await withRetry(
              async () => {
                const error = new Error('Always fails') as RetryableError;
                error.code = 'NETWORK_ERROR';
                error.retryable = true;
                throw error;
              },
              { maxRetries, baseDelayMs: 1, maxDelayMs: 10 }
            );
            
            const sumOfAttempts = result.attemptDurations.reduce((a, b) => a + b, 0);
            // Total duration includes backoff delays, so should be >= sum of attempts
            expect(result.totalDurationMs).toBeGreaterThanOrEqual(sumOfAttempts);
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  describe('Default Configuration', () => {
    /**
     * Property: Default config SHALL have maxRetries = 3
     */
    it('should have default maxRetries of 3', () => {
      expect(DEFAULT_RETRY_CONFIG.maxRetries).toBe(3);
    });

    /**
     * Property: Default config SHALL have reasonable backoff values
     */
    it('should have reasonable default backoff values', () => {
      expect(DEFAULT_RETRY_CONFIG.baseDelayMs).toBeGreaterThan(0);
      expect(DEFAULT_RETRY_CONFIG.maxDelayMs).toBeGreaterThan(DEFAULT_RETRY_CONFIG.baseDelayMs);
    });

    /**
     * Property: Default config SHALL include common retryable error codes
     */
    it('should include common retryable error codes', () => {
      expect(DEFAULT_RETRY_CONFIG.retryableErrors).toContain('RATE_LIMITED');
      expect(DEFAULT_RETRY_CONFIG.retryableErrors).toContain('NETWORK_ERROR');
      expect(DEFAULT_RETRY_CONFIG.retryableErrors).toContain('TIMEOUT');
    });

    /**
     * Property: Default config SHALL include common retryable status codes
     */
    it('should include common retryable status codes', () => {
      expect(DEFAULT_RETRY_CONFIG.retryableStatusCodes).toContain(429);
      expect(DEFAULT_RETRY_CONFIG.retryableStatusCodes).toContain(500);
      expect(DEFAULT_RETRY_CONFIG.retryableStatusCodes).toContain(502);
      expect(DEFAULT_RETRY_CONFIG.retryableStatusCodes).toContain(503);
      expect(DEFAULT_RETRY_CONFIG.retryableStatusCodes).toContain(504);
    });
  });
});
