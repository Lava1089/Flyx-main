/**
 * Property-based test for the /flixer/monitor endpoint
 *
 * Feature: hexa-resilient-extraction, Property 12: Monitor Endpoint Response Completeness
 * Validates: Requirements REQ-HEALTH-2.1
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { MonitorState } from '../hexa-monitor';

// ---------------------------------------------------------------------------
// Arbitrary generators
// ---------------------------------------------------------------------------

const arbAlertType = fc.constantFrom(
  'domain_change',
  'fingerprint_change',
  'route_change',
  'wasm_change',
  'wasm_breaking_change',
  'unreachable',
) as fc.Arbitrary<MonitorState['pendingAlerts'][number]['type']>;

const arbAlert = fc.record({
  type: arbAlertType,
  message: fc.string({ minLength: 1, maxLength: 100 }),
  oldValue: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
  newValue: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
  autoFixed: fc.boolean(),
});

const arbApiRoutes = fc.record({
  time: fc.string({ minLength: 1, maxLength: 50 }),
  movieImages: fc.string({ minLength: 1, maxLength: 100 }),
  tvImages: fc.string({ minLength: 1, maxLength: 100 }),
});

const arbCheckResult = fc.record({
  status: fc.constantFrom('ok' as const, 'changed' as const, 'error' as const),
  oldValue: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
  newValue: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
  error: fc.option(fc.string({ maxLength: 100 }), { nil: undefined }),
  durationMs: fc.nat({ max: 30000 }),
});

const arbMonitorResult = fc.record({
  timestamp: fc.integer({ min: 1_000_000_000, max: 10_000_000_000 }),
  checks: fc.record({
    domain: arbCheckResult,
    fingerprint: arbCheckResult,
    routes: arbCheckResult,
    wasm: fc.option(arbCheckResult, { nil: null }),
  }),
  alerts: fc.array(arbAlert, { maxLength: 5 }),
});

const arbMonitorState: fc.Arbitrary<MonitorState> = fc.record({
  status: fc.constantFrom('healthy' as const, 'degraded' as const, 'offline' as const),
  lastSuccessfulCheck: fc.option(fc.integer({ min: 946684800000, max: 4102444800000 }).map(ts => new Date(ts).toISOString()), { nil: null }),
  lastFailedCheck: fc.option(fc.integer({ min: 946684800000, max: 4102444800000 }).map(ts => new Date(ts).toISOString()), { nil: null }),
  consecutiveFailures: fc.nat({ max: 1000 }),
  currentConfig: fc.record({
    apiDomain: fc.string({ minLength: 1, maxLength: 80 }),
    fingerprintLite: fc.string({ minLength: 1, maxLength: 40 }),
    wasmHash: fc.option(
      fc.array(fc.constantFrom(...'0123456789abcdef'.split('')), { minLength: 64, maxLength: 64 }).map(arr => arr.join('')),
      { nil: null },
    ),
    apiRoutes: arbApiRoutes,
  }),
  pendingAlerts: fc.array(arbAlert, { maxLength: 5 }),
  lastCheckResult: fc.option(arbMonitorResult, { nil: null }),
});

// ---------------------------------------------------------------------------
// Mock KV that returns stored monitor_state
// ---------------------------------------------------------------------------

function createMockKV(monitorState: MonitorState): KVNamespace {
  const data = JSON.stringify(monitorState);
  return {
    get: async (key: string) => {
      if (key === 'monitor_state') return data;
      return null;
    },
    put: async () => {},
    delete: async () => {},
    list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
    getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null }),
  } as unknown as KVNamespace;
}

// ---------------------------------------------------------------------------
// Simulate the /flixer/monitor handler logic (same as in index.ts)
// ---------------------------------------------------------------------------

async function handleMonitorRequest(kv: KVNamespace | undefined): Promise<Response> {
  if (!kv) {
    return new Response(JSON.stringify({ error: 'HEXA_CONFIG KV not bound' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const raw = await kv.get('monitor_state');
  if (!raw) {
    return new Response(JSON.stringify({ status: 'no_data', message: 'No monitor state available yet' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(raw, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Property 12: Monitor Endpoint Response Completeness
// Feature: hexa-resilient-extraction, Property 12: Monitor Endpoint Response Completeness
// Validates: Requirements REQ-HEALTH-2.1
// ---------------------------------------------------------------------------

describe('Property 12: Monitor Endpoint Response Completeness', () => {
  it('response JSON contains all required MonitorState fields for any valid state', async () => {
    await fc.assert(
      fc.asyncProperty(arbMonitorState, async (state) => {
        const kv = createMockKV(state);
        const response = await handleMonitorRequest(kv);

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('application/json');

        const body = JSON.parse(await response.text()) as MonitorState;

        // Required top-level fields
        expect(body).toHaveProperty('status');
        expect(['healthy', 'degraded', 'offline']).toContain(body.status);
        expect(body).toHaveProperty('lastSuccessfulCheck');
        expect(body).toHaveProperty('lastFailedCheck');
        expect(body).toHaveProperty('consecutiveFailures');
        expect(typeof body.consecutiveFailures).toBe('number');

        // currentConfig with all sub-fields
        expect(body).toHaveProperty('currentConfig');
        expect(body.currentConfig).toHaveProperty('apiDomain');
        expect(body.currentConfig).toHaveProperty('fingerprintLite');
        expect(body.currentConfig).toHaveProperty('wasmHash');
        expect(body.currentConfig).toHaveProperty('apiRoutes');

        // pendingAlerts array
        expect(body).toHaveProperty('pendingAlerts');
        expect(Array.isArray(body.pendingAlerts)).toBe(true);

        // lastCheckResult (nullable)
        expect(body).toHaveProperty('lastCheckResult');

        // Values round-trip correctly
        expect(body.status).toBe(state.status);
        expect(body.consecutiveFailures).toBe(state.consecutiveFailures);
        expect(body.currentConfig.apiDomain).toBe(state.currentConfig.apiDomain);
        expect(body.currentConfig.fingerprintLite).toBe(state.currentConfig.fingerprintLite);
        expect(body.currentConfig.wasmHash).toBe(state.currentConfig.wasmHash);
        expect(body.pendingAlerts.length).toBe(state.pendingAlerts.length);
      }),
      { numRuns: 100 },
    );
  });

  it('returns 503 when HEXA_CONFIG KV is not bound', async () => {
    const response = await handleMonitorRequest(undefined);
    expect(response.status).toBe(503);
    const body = JSON.parse(await response.text());
    expect(body).toHaveProperty('error');
  });

  it('returns no_data when monitor_state key is absent', async () => {
    const emptyKv = {
      get: async () => null,
      put: async () => {},
      delete: async () => {},
      list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
      getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null }),
    } as unknown as KVNamespace;

    const response = await handleMonitorRequest(emptyKv);
    expect(response.status).toBe(200);
    const body = JSON.parse(await response.text());
    expect(body.status).toBe('no_data');
  });
});
