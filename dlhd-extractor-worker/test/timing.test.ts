import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  RequestTimer,
  createTimingInfo,
  measureAsync,
  measureSync,
  formatTiming,
  formatExtendedTiming,
  calculateTimingStats,
} from '../src/utils/timing';
import { TimingInfo, ExtendedTimingInfo } from '../src/types';

/**
 * Property 13: Timing Metadata
 * **Validates: Requirements 7.4**
 * 
 * For any successful response from extraction endpoints, the response 
 * SHALL include timing information indicating request duration.
 */
describe('Property 13: Timing Metadata', () => {
  // Generator for phase names
  const phaseNameArb = fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'.split('')),
    { minLength: 1, maxLength: 20 }
  );

  // Generator for delay durations (small for fast tests)
  const delayArb = fc.integer({ min: 1, max: 50 });

  // Generator for number of phases
  const phaseCountArb = fc.integer({ min: 1, max: 5 });

  // Generator for retry attempts
  const retryAttemptsArb = fc.integer({ min: 0, max: 5 });

  // Generator for retry duration
  const retryDurationArb = fc.integer({ min: 0, max: 1000 });

  describe('RequestTimer', () => {
    /**
     * Property: RequestTimer SHALL track duration from creation
     */
    it('should track duration from creation', async () => {
      await fc.assert(
        fc.asyncProperty(delayArb, async (delay) => {
          const timer = new RequestTimer();
          
          // Wait for the delay
          await new Promise(resolve => setTimeout(resolve, delay));
          
          const timing = timer.getTimingInfo();
          
          // Duration should be at least the delay
          expect(timing.durationMs).toBeGreaterThanOrEqual(delay);
          // But not too much more (allow 50ms tolerance)
          expect(timing.durationMs).toBeLessThan(delay + 50);
        }),
        { numRuns: 20 }
      );
    });

    /**
     * Property: RequestTimer SHALL include valid ISO 8601 startTime
     */
    it('should include valid ISO 8601 startTime', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const timer = new RequestTimer();
          const timing = timer.getTimingInfo();
          
          // Should be a valid ISO 8601 date string
          const parsed = new Date(timing.startTime);
          expect(parsed.toISOString()).toBe(timing.startTime);
          
          // Should be close to now
          const now = Date.now();
          const startMs = parsed.getTime();
          expect(Math.abs(now - startMs)).toBeLessThan(1000);
        }),
        { numRuns: 50 }
      );
    });

    /**
     * Property: RequestTimer SHALL include valid ISO 8601 endTime
     */
    it('should include valid ISO 8601 endTime', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const timer = new RequestTimer();
          const timing = timer.getTimingInfo();
          
          // Should be a valid ISO 8601 date string
          expect(timing.endTime).toBeDefined();
          const parsed = new Date(timing.endTime!);
          expect(parsed.toISOString()).toBe(timing.endTime);
        }),
        { numRuns: 50 }
      );
    });

    /**
     * Property: endTime SHALL be >= startTime
     */
    it('should have endTime >= startTime', async () => {
      await fc.assert(
        fc.asyncProperty(delayArb, async (delay) => {
          const timer = new RequestTimer();
          await new Promise(resolve => setTimeout(resolve, delay));
          const timing = timer.getTimingInfo();
          
          const startMs = new Date(timing.startTime).getTime();
          const endMs = new Date(timing.endTime!).getTime();
          
          expect(endMs).toBeGreaterThanOrEqual(startMs);
        }),
        { numRuns: 20 }
      );
    });

    /**
     * Property: durationMs SHALL equal endTime - startTime (approximately)
     */
    it('should have durationMs approximately equal to endTime - startTime', async () => {
      await fc.assert(
        fc.asyncProperty(delayArb, async (delay) => {
          const timer = new RequestTimer();
          await new Promise(resolve => setTimeout(resolve, delay));
          const timing = timer.getTimingInfo();
          
          const startMs = new Date(timing.startTime).getTime();
          const endMs = new Date(timing.endTime!).getTime();
          const calculatedDuration = endMs - startMs;
          
          // Should be within 5ms tolerance
          expect(Math.abs(timing.durationMs - calculatedDuration)).toBeLessThan(5);
        }),
        { numRuns: 20 }
      );
    });
  });

  describe('Phase Tracking', () => {
    /**
     * Property: Phases SHALL be recorded with correct names
     */
    it('should record phases with correct names', () => {
      fc.assert(
        fc.property(
          fc.array(phaseNameArb, { minLength: 1, maxLength: 5 }),
          (phaseNames) => {
            const timer = new RequestTimer();
            
            for (const name of phaseNames) {
              timer.startPhase(name);
              timer.endPhase();
            }
            
            const timing = timer.getExtendedTimingInfo();
            
            expect(timing.phases).toBeDefined();
            expect(timing.phases!.length).toBe(phaseNames.length);
            
            for (let i = 0; i < phaseNames.length; i++) {
              expect(timing.phases![i].name).toBe(phaseNames[i]);
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    /**
     * Property: Each phase SHALL have non-negative duration
     */
    it('should have non-negative duration for each phase', () => {
      fc.assert(
        fc.property(
          fc.array(phaseNameArb, { minLength: 1, maxLength: 5 }),
          (phaseNames) => {
            const timer = new RequestTimer();
            
            for (const name of phaseNames) {
              timer.startPhase(name);
              timer.endPhase();
            }
            
            const timing = timer.getExtendedTimingInfo();
            
            for (const phase of timing.phases || []) {
              expect(phase.durationMs).toBeGreaterThanOrEqual(0);
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    /**
     * Property: Starting a new phase SHALL end the previous phase
     */
    it('should end previous phase when starting new phase', () => {
      fc.assert(
        fc.property(
          fc.array(phaseNameArb, { minLength: 2, maxLength: 5 }),
          (phaseNames) => {
            const timer = new RequestTimer();
            
            // Start all phases without explicitly ending them
            for (const name of phaseNames) {
              timer.startPhase(name);
            }
            
            // Get timing (should auto-end last phase)
            const timing = timer.getExtendedTimingInfo();
            
            // All phases should be recorded
            expect(timing.phases).toBeDefined();
            expect(timing.phases!.length).toBe(phaseNames.length);
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Extended Timing Info', () => {
    /**
     * Property: Extended timing SHALL include retry information when provided
     */
    it('should include retry information when provided', () => {
      fc.assert(
        fc.property(retryAttemptsArb, retryDurationArb, (attempts, duration) => {
          const timer = new RequestTimer();
          const timing = timer.getExtendedTimingInfo(attempts, duration);
          
          expect(timing.retryAttempts).toBe(attempts);
          expect(timing.retryDurationMs).toBe(duration);
        }),
        { numRuns: 50 }
      );
    });

    /**
     * Property: Extended timing SHALL include all base timing fields
     */
    it('should include all base timing fields', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const timer = new RequestTimer();
          const timing = timer.getExtendedTimingInfo();
          
          expect(timing.durationMs).toBeDefined();
          expect(typeof timing.durationMs).toBe('number');
          expect(timing.startTime).toBeDefined();
          expect(typeof timing.startTime).toBe('string');
          expect(timing.endTime).toBeDefined();
          expect(typeof timing.endTime).toBe('string');
        }),
        { numRuns: 50 }
      );
    });
  });

  describe('createTimingInfo', () => {
    /**
     * Property: createTimingInfo SHALL calculate correct duration
     */
    it('should calculate correct duration', async () => {
      await fc.assert(
        fc.asyncProperty(delayArb, async (delay) => {
          const startTime = Date.now();
          await new Promise(resolve => setTimeout(resolve, delay));
          const timing = createTimingInfo(startTime);
          
          expect(timing.durationMs).toBeGreaterThanOrEqual(delay);
          expect(timing.durationMs).toBeLessThan(delay + 50);
        }),
        { numRuns: 20 }
      );
    });

    /**
     * Property: createTimingInfo SHALL include valid timestamps
     */
    it('should include valid timestamps', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const startTime = Date.now();
          const timing = createTimingInfo(startTime);
          
          // Both should be valid ISO 8601
          expect(new Date(timing.startTime).toISOString()).toBe(timing.startTime);
          expect(new Date(timing.endTime!).toISOString()).toBe(timing.endTime);
        }),
        { numRuns: 50 }
      );
    });
  });

  describe('measureAsync', () => {
    /**
     * Property: measureAsync SHALL return result and timing
     */
    it('should return result and timing', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 50 }),
          delayArb,
          async (expectedResult, delay) => {
            const { result, timing } = await measureAsync(async () => {
              await new Promise(resolve => setTimeout(resolve, delay));
              return expectedResult;
            });
            
            expect(result).toBe(expectedResult);
            expect(timing.durationMs).toBeGreaterThanOrEqual(delay);
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  describe('measureSync', () => {
    /**
     * Property: measureSync SHALL return result and timing
     */
    it('should return result and timing', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          (expectedResult) => {
            const { result, timing } = measureSync(() => expectedResult);
            
            expect(result).toBe(expectedResult);
            expect(timing.durationMs).toBeGreaterThanOrEqual(0);
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('formatTiming', () => {
    /**
     * Property: formatTiming SHALL include duration in output
     */
    it('should include duration in output', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 10000 }),
          (durationMs) => {
            const timing: TimingInfo = {
              durationMs,
              startTime: new Date().toISOString(),
            };
            
            const formatted = formatTiming(timing);
            expect(formatted).toContain(`${durationMs}ms`);
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('formatExtendedTiming', () => {
    /**
     * Property: formatExtendedTiming SHALL include total duration
     */
    it('should include total duration', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 10000 }),
          (durationMs) => {
            const timing: ExtendedTimingInfo = {
              durationMs,
              startTime: new Date().toISOString(),
            };
            
            const formatted = formatExtendedTiming(timing);
            expect(formatted).toContain(`${durationMs}ms`);
          }
        ),
        { numRuns: 50 }
      );
    });

    /**
     * Property: formatExtendedTiming SHALL include retry info when present
     */
    it('should include retry info when present', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 5 }),
          fc.integer({ min: 100, max: 5000 }),
          (retryAttempts, retryDurationMs) => {
            const timing: ExtendedTimingInfo = {
              durationMs: 1000,
              startTime: new Date().toISOString(),
              retryAttempts,
              retryDurationMs,
            };
            
            const formatted = formatExtendedTiming(timing);
            expect(formatted).toContain(`${retryAttempts} retries`);
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('calculateTimingStats', () => {
    /**
     * Property: calculateTimingStats SHALL calculate correct count
     */
    it('should calculate correct count', () => {
      fc.assert(
        fc.property(
          fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 0, maxLength: 10 }),
          (durations) => {
            const timings: TimingInfo[] = durations.map(d => ({
              durationMs: d,
              startTime: new Date().toISOString(),
            }));
            
            const stats = calculateTimingStats(timings);
            expect(stats.count).toBe(durations.length);
          }
        ),
        { numRuns: 50 }
      );
    });

    /**
     * Property: calculateTimingStats SHALL calculate correct total
     */
    it('should calculate correct total', () => {
      fc.assert(
        fc.property(
          fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 1, maxLength: 10 }),
          (durations) => {
            const timings: TimingInfo[] = durations.map(d => ({
              durationMs: d,
              startTime: new Date().toISOString(),
            }));
            
            const stats = calculateTimingStats(timings);
            const expectedTotal = durations.reduce((sum, d) => sum + d, 0);
            expect(stats.totalMs).toBe(expectedTotal);
          }
        ),
        { numRuns: 50 }
      );
    });

    /**
     * Property: calculateTimingStats SHALL calculate correct average
     */
    it('should calculate correct average', () => {
      fc.assert(
        fc.property(
          fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 1, maxLength: 10 }),
          (durations) => {
            const timings: TimingInfo[] = durations.map(d => ({
              durationMs: d,
              startTime: new Date().toISOString(),
            }));
            
            const stats = calculateTimingStats(timings);
            const expectedAverage = durations.reduce((sum, d) => sum + d, 0) / durations.length;
            expect(stats.averageMs).toBeCloseTo(expectedAverage, 5);
          }
        ),
        { numRuns: 50 }
      );
    });

    /**
     * Property: calculateTimingStats SHALL find correct min and max
     */
    it('should find correct min and max', () => {
      fc.assert(
        fc.property(
          fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 1, maxLength: 10 }),
          (durations) => {
            const timings: TimingInfo[] = durations.map(d => ({
              durationMs: d,
              startTime: new Date().toISOString(),
            }));
            
            const stats = calculateTimingStats(timings);
            expect(stats.minMs).toBe(Math.min(...durations));
            expect(stats.maxMs).toBe(Math.max(...durations));
          }
        ),
        { numRuns: 50 }
      );
    });

    /**
     * Property: calculateTimingStats SHALL handle empty array
     */
    it('should handle empty array', () => {
      const stats = calculateTimingStats([]);
      
      expect(stats.count).toBe(0);
      expect(stats.totalMs).toBe(0);
      expect(stats.averageMs).toBe(0);
      expect(stats.minMs).toBe(0);
      expect(stats.maxMs).toBe(0);
    });
  });
});
