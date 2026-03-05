import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  aggregateErrors,
  buildErrorMessage,
  type PlayerExtractionAttempt,
  type ExtractionErrorCode,
  type AggregatedError,
} from '../src/extraction/orchestrator';

/**
 * Property 12: Error Aggregation
 * **Validates: Requirements 7.2**
 * 
 * For any extraction attempt where all 6 players fail, the error response 
 * SHALL contain failure details for each player that was attempted.
 */
describe('Property 12: Error Aggregation', () => {
  // Generator for extraction error codes
  const errorCodeArb = fc.constantFrom<ExtractionErrorCode>(
    'EMBED_FETCH_FAILED',
    'NO_M3U8_FOUND',
    'DECODE_FAILED',
    'ALL_PLAYERS_FAILED',
    'INVALID_PLAYER',
    'AUTH_REQUIRED'
  );

  // Generator for player IDs (1-6)
  const playerIdArb = fc.integer({ min: 1, max: 6 });

  // Generator for duration in milliseconds
  const durationArb = fc.integer({ min: 10, max: 30000 });

  // Generator for error messages
  const errorMessageArb = fc.string({ minLength: 5, maxLength: 100 });

  // Generator for player names
  const playerNameArb = fc.option(
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 '.split('')), 
    { minLength: 3, maxLength: 20 }),
    { nil: undefined }
  );

  // Generator for a failed player extraction attempt with unique ID
  const failedAttemptWithIdArb = (playerId: number) => fc.record({
    playerId: fc.constant(playerId),
    playerName: playerNameArb,
    success: fc.constant(false),
    error: errorMessageArb,
    errorCode: errorCodeArb,
    durationMs: durationArb,
    errorDetails: fc.option(fc.dictionary(fc.string(), fc.string()), { nil: undefined }),
    startedAt: fc.option(fc.date().map(d => d.toISOString()), { nil: undefined }),
    endedAt: fc.option(fc.date().map(d => d.toISOString()), { nil: undefined }),
  }) as fc.Arbitrary<PlayerExtractionAttempt>;

  // Generator for a failed player extraction attempt (may have duplicate IDs)
  const failedAttemptArb = fc.record({
    playerId: playerIdArb,
    playerName: playerNameArb,
    success: fc.constant(false),
    error: errorMessageArb,
    errorCode: errorCodeArb,
    durationMs: durationArb,
    errorDetails: fc.option(fc.dictionary(fc.string(), fc.string()), { nil: undefined }),
    startedAt: fc.option(fc.date().map(d => d.toISOString()), { nil: undefined }),
    endedAt: fc.option(fc.date().map(d => d.toISOString()), { nil: undefined }),
  }) as fc.Arbitrary<PlayerExtractionAttempt>;

  // Generator for a successful player extraction attempt
  const successfulAttemptArb = fc.record({
    playerId: playerIdArb,
    playerName: playerNameArb,
    success: fc.constant(true),
    durationMs: durationArb,
    startedAt: fc.option(fc.date().map(d => d.toISOString()), { nil: undefined }),
    endedAt: fc.option(fc.date().map(d => d.toISOString()), { nil: undefined }),
  }) as fc.Arbitrary<PlayerExtractionAttempt>;

  // Generator for an array of failed attempts with unique player IDs (1-6 players)
  const uniqueFailedAttemptsArb = fc.integer({ min: 1, max: 6 }).chain(count => {
    const playerIds = Array.from({ length: count }, (_, i) => i + 1);
    return fc.tuple(...playerIds.map(id => failedAttemptWithIdArb(id)));
  });

  // Generator for an array of failed attempts (may have duplicate IDs)
  const failedAttemptsArb = fc.array(failedAttemptArb, { minLength: 1, maxLength: 6 });

  // Generator for mixed attempts (some success, some failure)
  const mixedAttemptsArb = fc.array(
    fc.oneof(failedAttemptArb, successfulAttemptArb),
    { minLength: 1, maxLength: 6 }
  );

  describe('Aggregated Error Contains All Player Failures', () => {
    /**
     * Property: For all failed attempts with unique player IDs, aggregateErrors SHALL include 
     * failure details for each player
     */
    it('should include failure details for every failed player', () => {
      fc.assert(
        fc.property(uniqueFailedAttemptsArb, (attempts) => {
          const result = aggregateErrors(attempts);
          
          // Should have same number of player errors as failed attempts
          expect(result.playerErrors.length).toBe(attempts.length);
          
          // Each failed attempt should have a corresponding player error
          for (const attempt of attempts) {
            const playerError = result.playerErrors.find(e => e.playerId === attempt.playerId);
            expect(playerError).toBeDefined();
            expect(playerError?.errorMessage).toBe(attempt.error);
            expect(playerError?.errorCode).toBe(attempt.errorCode);
          }
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: failedAttempts count SHALL equal number of failed attempts
     */
    it('should correctly count failed attempts', () => {
      fc.assert(
        fc.property(mixedAttemptsArb, (attempts) => {
          const result = aggregateErrors(attempts);
          const actualFailed = attempts.filter(a => !a.success).length;
          
          expect(result.failedAttempts).toBe(actualFailed);
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: totalAttempts SHALL equal total number of attempts
     */
    it('should correctly count total attempts', () => {
      fc.assert(
        fc.property(mixedAttemptsArb, (attempts) => {
          const result = aggregateErrors(attempts);
          
          expect(result.totalAttempts).toBe(attempts.length);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Error Code Counting', () => {
    /**
     * Property: errorCodeCounts SHALL accurately count each error code
     */
    it('should accurately count error codes', () => {
      fc.assert(
        fc.property(failedAttemptsArb, (attempts) => {
          const result = aggregateErrors(attempts);
          
          // Manually count error codes
          const expectedCounts: Record<string, number> = {};
          for (const attempt of attempts) {
            if (attempt.errorCode) {
              expectedCounts[attempt.errorCode] = (expectedCounts[attempt.errorCode] || 0) + 1;
            }
          }
          
          // Verify counts match
          expect(result.errorCodeCounts).toEqual(expectedCounts);
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: mostCommonError SHALL be the error code with highest count
     */
    it('should identify the most common error code', () => {
      fc.assert(
        fc.property(failedAttemptsArb, (attempts) => {
          const result = aggregateErrors(attempts);
          
          if (result.mostCommonError) {
            // Find the maximum count
            const maxCount = Math.max(...Object.values(result.errorCodeCounts));
            
            // The most common error should have the max count
            expect(result.errorCodeCounts[result.mostCommonError]).toBe(maxCount);
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Duration Calculations', () => {
    /**
     * Property: totalDurationMs SHALL equal sum of all attempt durations
     */
    it('should calculate total duration correctly', () => {
      fc.assert(
        fc.property(mixedAttemptsArb, (attempts) => {
          const result = aggregateErrors(attempts);
          const expectedTotal = attempts.reduce((sum, a) => sum + a.durationMs, 0);
          
          expect(result.totalDurationMs).toBe(expectedTotal);
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: averageDurationMs SHALL equal totalDurationMs / totalAttempts
     */
    it('should calculate average duration correctly', () => {
      fc.assert(
        fc.property(mixedAttemptsArb, (attempts) => {
          const result = aggregateErrors(attempts);
          
          if (attempts.length > 0) {
            const expectedAverage = result.totalDurationMs / attempts.length;
            expect(result.averageDurationMs).toBeCloseTo(expectedAverage, 5);
          } else {
            expect(result.averageDurationMs).toBe(0);
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Summary Message', () => {
    /**
     * Property: summary SHALL mention the number of failed players
     */
    it('should include failed player count in summary', () => {
      fc.assert(
        fc.property(failedAttemptsArb, (attempts) => {
          const result = aggregateErrors(attempts);
          
          // Summary should mention the count
          expect(result.summary).toContain(String(attempts.length));
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: summary SHALL be non-empty for any failed attempts
     */
    it('should produce non-empty summary for failed attempts', () => {
      fc.assert(
        fc.property(failedAttemptsArb, (attempts) => {
          const result = aggregateErrors(attempts);
          
          expect(result.summary.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('buildErrorMessage Function', () => {
    /**
     * Property: buildErrorMessage SHALL include all player IDs in the message
     */
    it('should include all player IDs in error message', () => {
      fc.assert(
        fc.property(failedAttemptsArb, (attempts) => {
          const message = buildErrorMessage(attempts);
          
          // Each player ID should appear in the message
          for (const attempt of attempts) {
            expect(message).toContain(String(attempt.playerId));
          }
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: buildErrorMessage SHALL include error messages for each player
     */
    it('should include error messages for each player', () => {
      fc.assert(
        fc.property(failedAttemptsArb, (attempts) => {
          const message = buildErrorMessage(attempts);
          
          // Each error message should appear
          for (const attempt of attempts) {
            if (attempt.error) {
              expect(message).toContain(attempt.error);
            }
          }
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: buildErrorMessage SHALL return appropriate message for empty attempts
     */
    it('should handle empty attempts array', () => {
      const message = buildErrorMessage([]);
      expect(message).toBe('No players were attempted');
    });

    /**
     * Property: buildErrorMessage SHALL indicate success when all attempts succeed
     */
    it('should indicate success when all attempts succeed', () => {
      fc.assert(
        fc.property(
          fc.array(successfulAttemptArb, { minLength: 1, maxLength: 6 }),
          (attempts) => {
            const message = buildErrorMessage(attempts);
            expect(message).toBe('All attempts succeeded');
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Player Error Details', () => {
    /**
     * Property: Each playerError SHALL contain playerId, errorMessage, and durationMs
     */
    it('should include required fields in player errors', () => {
      fc.assert(
        fc.property(failedAttemptsArb, (attempts) => {
          const result = aggregateErrors(attempts);
          
          for (const playerError of result.playerErrors) {
            expect(playerError.playerId).toBeDefined();
            expect(typeof playerError.playerId).toBe('number');
            expect(playerError.errorMessage).toBeDefined();
            expect(typeof playerError.errorMessage).toBe('string');
            expect(playerError.durationMs).toBeDefined();
            expect(typeof playerError.durationMs).toBe('number');
          }
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: playerError.errorCode SHALL match the original attempt's errorCode
     * (using unique player IDs to ensure correct matching)
     */
    it('should preserve error codes in player errors', () => {
      fc.assert(
        fc.property(uniqueFailedAttemptsArb, (attempts) => {
          const result = aggregateErrors(attempts);
          
          for (const attempt of attempts) {
            const playerError = result.playerErrors.find(e => e.playerId === attempt.playerId);
            expect(playerError?.errorCode).toBe(attempt.errorCode);
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Edge Cases', () => {
    /**
     * Property: Single failed attempt SHALL produce valid aggregation
     */
    it('should handle single failed attempt', () => {
      fc.assert(
        fc.property(failedAttemptArb, (attempt) => {
          const result = aggregateErrors([attempt]);
          
          expect(result.totalAttempts).toBe(1);
          expect(result.failedAttempts).toBe(1);
          expect(result.playerErrors.length).toBe(1);
          expect(result.playerErrors[0].playerId).toBe(attempt.playerId);
        }),
        { numRuns: 50 }
      );
    });

    /**
     * Property: All 6 players failing SHALL produce complete aggregation
     */
    it('should handle all 6 players failing', () => {
      fc.assert(
        fc.property(
          fc.array(failedAttemptArb, { minLength: 6, maxLength: 6 }),
          (attempts) => {
            const result = aggregateErrors(attempts);
            
            expect(result.totalAttempts).toBe(6);
            expect(result.failedAttempts).toBe(6);
            expect(result.playerErrors.length).toBe(6);
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});
