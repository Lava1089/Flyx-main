/**
 * Property-based tests for hexa-alerter.ts
 *
 * Feature: hexa-resilient-extraction
 * Properties 9, 10
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  formatAlertPayload,
  buildDiscordEmbed,
  isRateLimited,
  sendAlert,
  type Alert,
  type AlertPayload,
} from '../hexa-alerter';

// ---------------------------------------------------------------------------
// Mock KV helper
// ---------------------------------------------------------------------------

function createMockKV(store: Record<string, string | null> = {}): KVNamespace {
  return {
    get: async (key: string) => store[key] ?? null,
    put: async (key: string, value: string) => { store[key] = value; },
    delete: async () => {},
    list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
    getWithMetadata: async (key: string) => ({ value: store[key] ?? null, metadata: null, cacheStatus: null }),
  } as unknown as KVNamespace;
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const arbAlertType = fc.constantFrom(
  'domain_change' as const,
  'fingerprint_change' as const,
  'route_change' as const,
  'wasm_change' as const,
  'wasm_breaking_change' as const,
  'unreachable' as const,
);

const arbAlert: fc.Arbitrary<Alert> = fc.record({
  type: arbAlertType,
  message: fc.string({ minLength: 1, maxLength: 200 }),
  oldValue: fc.option(fc.string({ minLength: 0, maxLength: 100 }), { nil: undefined }),
  newValue: fc.option(fc.string({ minLength: 0, maxLength: 100 }), { nil: undefined }),
  autoFixed: fc.boolean(),
});

// ---------------------------------------------------------------------------
// Property 9: Alert Payload Completeness
// Feature: hexa-resilient-extraction, Property 9: Alert Payload Completeness
// Validates: Requirements REQ-HEALTH-3.2
// ---------------------------------------------------------------------------

describe('Property 9: Alert Payload Completeness', () => {
  it('formatted payload always contains all required fields, and optional fields when present in alert', () => {
    fc.assert(
      fc.property(arbAlert, (alert) => {
        const payload = formatAlertPayload(alert);

        // Required fields must always be present
        expect(payload.type).toBe(alert.type);
        expect(payload.message).toBe(alert.message);
        expect(typeof payload.timestamp).toBe('string');
        expect(payload.timestamp.length).toBeGreaterThan(0);
        expect(typeof payload.autoFixed).toBe('boolean');
        expect(payload.autoFixed).toBe(alert.autoFixed);

        // Optional fields: present in payload iff present in alert
        if (alert.oldValue !== undefined) {
          expect(payload.oldValue).toBe(alert.oldValue);
        } else {
          expect(payload).not.toHaveProperty('oldValue');
        }

        if (alert.newValue !== undefined) {
          expect(payload.newValue).toBe(alert.newValue);
        } else {
          expect(payload).not.toHaveProperty('newValue');
        }

        // Discord embed should also contain all fields
        const embed = buildDiscordEmbed(payload) as any;
        expect(embed.embeds).toHaveLength(1);
        const e = embed.embeds[0];
        expect(e.description).toBe(alert.message);
        expect(e.timestamp).toBe(payload.timestamp);

        const fieldNames = e.fields.map((f: any) => f.name);
        expect(fieldNames).toContain('Type');
        expect(fieldNames).toContain('Auto-Fixed');

        if (alert.oldValue !== undefined) {
          expect(fieldNames).toContain('Old Value');
        }
        if (alert.newValue !== undefined) {
          expect(fieldNames).toContain('New Value');
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 10: Alert Rate Limiting
// Feature: hexa-resilient-extraction, Property 10: Alert Rate Limiting
// Validates: Requirements REQ-HEALTH-3.3
// ---------------------------------------------------------------------------

describe('Property 10: Alert Rate Limiting', () => {
  it('only the first alert of a given type dispatches within a 1h window; different types are independent', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate 2-5 alerts, all same type
        fc.integer({ min: 2, max: 5 }),
        arbAlertType,
        // A second independent type
        arbAlertType,
        async (count, alertType, otherType) => {
          const store: Record<string, string | null> = {};
          const kv = createMockKV(store);

          // Simulate sendAlert by testing isRateLimited + manual store writes
          // (avoids needing a real webhook endpoint)

          // First alert of alertType should NOT be rate limited
          const firstLimited = await isRateLimited(alertType, kv);
          expect(firstLimited).toBe(false);

          // Simulate setting the rate limit (as sendAlert would after successful dispatch)
          store[`alert_ratelimit:${alertType}`] = '1';

          // Subsequent alerts of same type should be rate limited
          for (let i = 1; i < count; i++) {
            const limited = await isRateLimited(alertType, kv);
            expect(limited).toBe(true);
          }

          // A different type should NOT be rate limited (independent)
          if (otherType !== alertType) {
            const otherLimited = await isRateLimited(otherType, kv);
            expect(otherLimited).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
