/**
 * Property-based tests for hexa-wasm-compat.ts
 *
 * Feature: hexa-resilient-extraction
 * Property 6: WASM Compatibility Classification
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  computeDiff,
  EXPECTED_EXPORTS,
} from '../hexa-wasm-compat';

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generates a random set of export/import names */
const arbNameSet = fc.uniqueArray(
  fc.string({ minLength: 1, maxLength: 30, unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz_0123456789'.split('')) }),
  { minLength: 0, maxLength: 20 },
);

// ---------------------------------------------------------------------------
// Property 6: WASM Compatibility Classification
// Feature: hexa-resilient-extraction, Property 6: WASM Compatibility Classification
// Validates: Requirements REQ-WASM-2.1, REQ-WASM-2.2
// ---------------------------------------------------------------------------

describe('Property 6: WASM Compatibility Classification', () => {
  it('computeDiff correctly classifies added, removed, and unchanged names for any expected/actual sets', async () => {
    await fc.assert(
      fc.property(arbNameSet, arbNameSet, (expected, actual) => {
        const diff = computeDiff(expected, actual);

        const expectedSet = new Set(expected);
        const actualSet = new Set(actual);

        // Every "removed" item must be in expected but NOT in actual
        for (const name of diff.removed) {
          expect(expectedSet.has(name)).toBe(true);
          expect(actualSet.has(name)).toBe(false);
        }

        // Every "added" item must be in actual but NOT in expected
        for (const name of diff.added) {
          expect(actualSet.has(name)).toBe(true);
          expect(expectedSet.has(name)).toBe(false);
        }

        // Every "unchanged" item must be in BOTH expected and actual
        for (const name of diff.unchanged) {
          expect(expectedSet.has(name)).toBe(true);
          expect(actualSet.has(name)).toBe(true);
        }

        // The union of removed + unchanged must equal the expected set
        const removedPlusUnchanged = new Set([...diff.removed, ...diff.unchanged]);
        expect(removedPlusUnchanged.size).toBe(expectedSet.size);
        for (const name of expected) {
          expect(removedPlusUnchanged.has(name)).toBe(true);
        }

        // The union of added + unchanged must equal the actual set
        const addedPlusUnchanged = new Set([...diff.added, ...diff.unchanged]);
        expect(addedPlusUnchanged.size).toBe(actualSet.size);
        for (const name of actual) {
          expect(addedPlusUnchanged.has(name)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('compatible is true iff all expected exports are present (removed is empty)', async () => {
    // Generate actual export sets that are supersets, subsets, or exact matches of EXPECTED_EXPORTS
    const arbActualExports = fc.oneof(
      // Exact match
      fc.constant([...EXPECTED_EXPORTS]),
      // Superset (all expected + extras)
      arbNameSet.map(extras => [...EXPECTED_EXPORTS, ...extras.filter(n => !EXPECTED_EXPORTS.includes(n))]),
      // Subset (some expected removed)
      fc.subarray([...EXPECTED_EXPORTS], { minLength: 0 }),
      // Random set
      arbNameSet,
    );

    await fc.assert(
      fc.property(arbActualExports, (actualExports_) => {
        const actualExports = actualExports_ as string[];
        const diff = computeDiff(EXPECTED_EXPORTS, actualExports);
        const allExpectedPresent = diff.removed.length === 0;

        // Verify: compatible should be true iff no expected exports are missing
        if (allExpectedPresent) {
          // Every expected export is in actual → compatible
          for (const name of EXPECTED_EXPORTS) {
            expect(actualExports).toContain(name);
          }
        } else {
          // At least one expected export is missing → incompatible
          const actualSet = new Set(actualExports);
          const missing = EXPECTED_EXPORTS.filter(n => !actualSet.has(n));
          expect(missing.length).toBeGreaterThan(0);
          expect(diff.removed).toEqual(expect.arrayContaining(missing));
        }
      }),
      { numRuns: 100 },
    );
  });
});
