/**
 * Property-based tests for hexa-monitor.ts
 *
 * Feature: hexa-resilient-extraction
 * Properties 8, 11
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import {
  computeStatus,
  shouldRunWasmCheckPure,
  _setNow,
} from '../hexa-monitor';

// ---------------------------------------------------------------------------
// Constants (mirrored from implementation for clarity)
// ---------------------------------------------------------------------------

const ONE_HOUR_MS = 1 * 60 * 60 * 1000;
const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  _setNow(() => Date.now());
});

// ---------------------------------------------------------------------------
// Property 8: Monitor Status Transitions
// Feature: hexa-resilient-extraction, Property 8: Monitor Status Transitions
// Validates: Requirements REQ-CONFIG-2.1, REQ-CONFIG-2.3
// ---------------------------------------------------------------------------

describe('Property 8: Monitor Status Transitions', () => {
  it('status is healthy when current check succeeds, regardless of history', () => {
    fc.assert(
      fc.property(
        fc.option(fc.integer({ min: 0, max: 10_000_000_000 }), { nil: null }),
        fc.option(fc.integer({ min: 0, max: 10_000_000_000 }), { nil: null }),
        fc.integer({ min: 1_000_000_000, max: 10_000_000_000 }),
        (lastSuccess, lastFailure, now) => {
          const status = computeStatus(lastSuccess, lastFailure, true, now);
          expect(status).toBe('healthy');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('status transitions healthy → degraded → offline based on failure duration', () => {
    fc.assert(
      fc.property(
        // Base timestamp for last success
        fc.integer({ min: 1_000_000_000, max: 5_000_000_000 }),
        // Time elapsed since last success (0 to 6 hours)
        fc.integer({ min: 0, max: SIX_HOURS_MS }),
        (lastSuccessTs, elapsed) => {
          const now = lastSuccessTs + elapsed;
          const status = computeStatus(lastSuccessTs, null, false, now);

          if (elapsed >= FOUR_HOURS_MS) {
            expect(status).toBe('offline');
          } else if (elapsed >= ONE_HOUR_MS) {
            expect(status).toBe('degraded');
          } else {
            expect(status).toBe('healthy');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('status never jumps from healthy directly to offline — must pass through degraded', () => {
    fc.assert(
      fc.property(
        // Simulate a sequence of check results with increasing time gaps
        fc.integer({ min: 1_000_000_000, max: 5_000_000_000 }),
        fc.array(
          fc.record({
            succeeded: fc.boolean(),
            elapsedMs: fc.integer({ min: 1_000, max: 30 * 60 * 1000 }), // 1s to 30min per step
          }),
          { minLength: 2, maxLength: 20 },
        ),
        (startTime, steps) => {
          let lastSuccessTs: number | null = startTime;
          let lastFailureTs: number | null = null;
          let currentTime = startTime;
          let prevStatus: 'healthy' | 'degraded' | 'offline' = 'healthy';

          for (const step of steps) {
            currentTime += step.elapsedMs;

            if (step.succeeded) {
              lastSuccessTs = currentTime;
            } else {
              if (lastFailureTs === null) lastFailureTs = currentTime;
            }

            const status = computeStatus(
              lastSuccessTs,
              lastFailureTs,
              step.succeeded,
              currentTime,
            );

            // The key invariant: no jump from healthy → offline
            if (prevStatus === 'healthy') {
              expect(status).not.toBe('offline');
            }

            // Reset failure tracking on success
            if (step.succeeded) {
              lastFailureTs = null;
            }

            prevStatus = status;
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 11: WASM Check Frequency Gating
// Feature: hexa-resilient-extraction, Property 11: WASM Check Frequency Gating
// Validates: Requirements REQ-HEALTH-1.2
// ---------------------------------------------------------------------------

describe('Property 11: WASM Check Frequency Gating', () => {
  it('WASM check runs only when 6+ hours have elapsed since last check', () => {
    fc.assert(
      fc.property(
        // Last WASM check timestamp
        fc.option(fc.integer({ min: 1_000_000_000, max: 5_000_000_000 }), { nil: null }),
        // Current time offset from last check (0 to 12 hours)
        fc.integer({ min: 0, max: 12 * 60 * 60 * 1000 }),
        (lastCheckTs, offset) => {
          if (lastCheckTs === null) {
            // Never checked — should always run
            const shouldRun = shouldRunWasmCheckPure(null, 1_000_000_000 + offset);
            expect(shouldRun).toBe(true);
          } else {
            const now = lastCheckTs + offset;
            const shouldRun = shouldRunWasmCheckPure(lastCheckTs, now);

            if (offset >= SIX_HOURS_MS) {
              expect(shouldRun).toBe(true);
            } else {
              expect(shouldRun).toBe(false);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
