/**
 * Hexa/Flixer Health Check Orchestrator
 *
 * Runs via Cron Trigger every 15 minutes. Performs domain, fingerprint,
 * route, and WASM checks against hexa.su, updates KV config when changes
 * are detected, and sends webhook alerts.
 *
 * Requirements: REQ-DOMAIN-1.1, REQ-DOMAIN-1.3, REQ-FP-1.1, REQ-ROUTE-1.1,
 *               REQ-WASM-1.1, REQ-HEALTH-1.1, REQ-HEALTH-1.2,
 *               REQ-CONFIG-2.1, REQ-CONFIG-2.3
 */

import type { Env } from './env';
import type { ApiRoutes } from './hexa-config';
import { getHexaConfig, refreshHexaConfig, DEFAULTS } from './hexa-config';
import {
  fetchHexaFrontend,
  extractJsBundleUrl,
  extractApiDomain,
  extractFingerprint,
  extractWasmUrl,
  extractApiRoutes,
  computeHash,
} from './hexa-scraper';
import { checkWasmCompatibility } from './hexa-wasm-compat';
import { sendAlert, type Alert } from './hexa-alerter';
import { refreshCapToken } from './hexa-cap-solver';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CheckResult {
  status: 'ok' | 'changed' | 'error';
  oldValue?: string;
  newValue?: string;
  error?: string;
  durationMs: number;
}

export interface MonitorResult {
  timestamp: number;
  checks: {
    domain: CheckResult;
    fingerprint: CheckResult;
    routes: CheckResult;
    wasm: CheckResult | null;
  };
  alerts: Alert[];
}

export interface MonitorState {
  status: 'healthy' | 'degraded' | 'offline';
  lastSuccessfulCheck: string | null;
  lastFailedCheck: string | null;
  consecutiveFailures: number;
  currentConfig: {
    apiDomain: string;
    fingerprintLite: string;
    wasmHash: string | null;
    apiRoutes: ApiRoutes;
  };
  pendingAlerts: Alert[];
  lastCheckResult: MonitorResult | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WASM_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const DEGRADED_THRESHOLD_MS = 1 * 60 * 60 * 1000;  // 1 hour
const OFFLINE_THRESHOLD_MS = 4 * 60 * 60 * 1000;   // 4 hours
const CHECK_TIMEOUT_MS = 10_000;                     // 10 seconds per check
const KV_TTL_SECONDS = 86400;                        // 24 hours

// ---------------------------------------------------------------------------
// Testable "now" hook (same pattern as hexa-config)
// ---------------------------------------------------------------------------

export let _now: () => number = () => Date.now();
export function _setNow(fn: () => number): void { _now = fn; }

// ---------------------------------------------------------------------------
// Status transition logic
// ---------------------------------------------------------------------------

/**
 * Compute the monitor status based on consecutive failure duration.
 *
 * - healthy:  last check succeeded
 * - degraded: all checks failed for >= 1 hour
 * - offline:  all checks failed for >= 4 hours
 *
 * The status never jumps from healthy → offline; it must pass through degraded.
 */
export function computeStatus(
  lastSuccessTimestamp: number | null,
  lastFailureTimestamp: number | null,
  currentCheckSucceeded: boolean,
  now: number,
): 'healthy' | 'degraded' | 'offline' {
  if (currentCheckSucceeded) return 'healthy';

  // No success ever recorded — use failure duration from first failure
  if (lastSuccessTimestamp === null) {
    if (lastFailureTimestamp === null) return 'healthy'; // no data yet
    const failureDuration = now - lastFailureTimestamp;
    if (failureDuration >= OFFLINE_THRESHOLD_MS) return 'offline';
    if (failureDuration >= DEGRADED_THRESHOLD_MS) return 'degraded';
    return 'healthy';
  }

  // We have a last success — measure how long since then
  const timeSinceSuccess = now - lastSuccessTimestamp;
  if (timeSinceSuccess >= OFFLINE_THRESHOLD_MS) return 'offline';
  if (timeSinceSuccess >= DEGRADED_THRESHOLD_MS) return 'degraded';
  return 'healthy';
}

// ---------------------------------------------------------------------------
// WASM check frequency gating
// ---------------------------------------------------------------------------

/**
 * Returns true if a WASM check should run (>= 6 hours since last check).
 */
export async function shouldRunWasmCheck(kv: KVNamespace): Promise<boolean> {
  try {
    const lastCheck = await kv.get('last_wasm_check_timestamp');
    if (!lastCheck) return true; // never checked
    const lastMs = Date.parse(lastCheck);
    if (isNaN(lastMs)) return true;
    return (_now() - lastMs) >= WASM_CHECK_INTERVAL_MS;
  } catch {
    return true; // on error, run the check
  }
}

/**
 * Pure version for testing — takes timestamps directly instead of reading KV.
 */
export function shouldRunWasmCheckPure(
  lastCheckTimestamp: number | null,
  now: number,
): boolean {
  if (lastCheckTimestamp === null) return true;
  return (now - lastCheckTimestamp) >= WASM_CHECK_INTERVAL_MS;
}

// ---------------------------------------------------------------------------
// Individual check functions
// ---------------------------------------------------------------------------

/**
 * Shared scrape context — avoids fetching hexa.su HTML + JS bundle multiple
 * times across domain/fingerprint/route checks within the same run.
 */
interface ScrapeContext {
  html: string;
  finalUrl: string;
  jsContent: string | null;
  jsBundleUrl: string | null;
}

async function buildScrapeContext(): Promise<ScrapeContext> {
  const { finalUrl, html } = await fetchHexaFrontend();
  const jsBundleUrl = extractJsBundleUrl(html, finalUrl);

  let jsContent: string | null = null;
  if (jsBundleUrl) {
    const jsResp = await fetch(jsBundleUrl, {
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (jsResp.ok) {
      jsContent = await jsResp.text();
    }
  }

  return { html, finalUrl, jsContent, jsBundleUrl };
}

/**
 * Check domain: fetch hexa.su, extract API domain, compare with KV.
 */
export async function checkDomain(
  kv: KVNamespace,
  scrapeCtx: ScrapeContext,
): Promise<{ result: CheckResult; alert?: Alert }> {
  const start = _now();
  try {
    const discovered = scrapeCtx.jsContent
      ? extractApiDomain(scrapeCtx.jsContent)
      : null;

    if (!discovered) {
      return {
        result: {
          status: 'error',
          error: 'Could not extract API domain from JS bundle',
          durationMs: _now() - start,
        },
      };
    }

    // Validate with /api/time
    try {
      const timeResp = await fetch(`${discovered}/api/time`, {
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
      if (!timeResp.ok) {
        // New domain doesn't respond — keep old
        return {
          result: {
            status: 'error',
            error: `Discovered domain ${discovered} returned HTTP ${timeResp.status}`,
            durationMs: _now() - start,
          },
        };
      }
    } catch (err) {
      return {
        result: {
          status: 'error',
          error: `Discovered domain ${discovered} unreachable: ${(err as Error).message}`,
          durationMs: _now() - start,
        },
      };
    }

    const stored = await kv.get('api_domain');
    if (stored === discovered) {
      return {
        result: { status: 'ok', durationMs: _now() - start },
      };
    }

    // Domain changed — update KV
    await kv.put('api_domain', discovered, { expirationTtl: KV_TTL_SECONDS });

    const alert: Alert = {
      type: 'domain_change',
      message: `API domain changed: ${stored || DEFAULTS.apiDomain} → ${discovered}`,
      oldValue: stored || DEFAULTS.apiDomain,
      newValue: discovered,
      autoFixed: true,
    };

    return {
      result: {
        status: 'changed',
        oldValue: stored || DEFAULTS.apiDomain,
        newValue: discovered,
        durationMs: _now() - start,
      },
      alert,
    };
  } catch (err) {
    return {
      result: {
        status: 'error',
        error: (err as Error).message,
        durationMs: _now() - start,
      },
    };
  }
}

/**
 * Check fingerprint: extract from JS bundle, compare with KV.
 */
export async function checkFingerprint(
  kv: KVNamespace,
  scrapeCtx: ScrapeContext,
): Promise<{ result: CheckResult; alert?: Alert }> {
  const start = _now();
  try {
    if (!scrapeCtx.jsContent) {
      return {
        result: {
          status: 'error',
          error: 'No JS bundle content available',
          durationMs: _now() - start,
        },
      };
    }

    const discovered = extractFingerprint(scrapeCtx.jsContent);
    if (!discovered) {
      return {
        result: {
          status: 'error',
          error: 'Could not extract fingerprint from JS bundle',
          durationMs: _now() - start,
        },
      };
    }

    const stored = await kv.get('fingerprint_lite');
    if (stored === discovered) {
      return {
        result: { status: 'ok', durationMs: _now() - start },
      };
    }

    await kv.put('fingerprint_lite', discovered, { expirationTtl: KV_TTL_SECONDS });

    const alert: Alert = {
      type: 'fingerprint_change',
      message: `Fingerprint changed: ${stored || DEFAULTS.fingerprintLite} → ${discovered}`,
      oldValue: stored || DEFAULTS.fingerprintLite,
      newValue: discovered,
      autoFixed: true,
    };

    return {
      result: {
        status: 'changed',
        oldValue: stored || DEFAULTS.fingerprintLite,
        newValue: discovered,
        durationMs: _now() - start,
      },
      alert,
    };
  } catch (err) {
    return {
      result: {
        status: 'error',
        error: (err as Error).message,
        durationMs: _now() - start,
      },
    };
  }
}

/**
 * Check routes: test /api/time and /api/tmdb/movie/550/images.
 * If either returns 404, scrape JS bundle for updated route patterns.
 */
export async function checkRoutes(
  kv: KVNamespace,
  apiDomain: string,
  scrapeCtx: ScrapeContext,
): Promise<{ result: CheckResult; alert?: Alert }> {
  const start = _now();
  try {
    const config = await getHexaConfig(kv);
    const timeUrl = `${apiDomain}${config.apiRoutes.time}`;

    let routesBroken = false;
    try {
      const timeResp = await fetch(timeUrl, {
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
      if (timeResp.status === 404) routesBroken = true;
    } catch {
      // Network error — don't assume routes are broken, could be domain issue
    }

    if (!routesBroken) {
      return {
        result: { status: 'ok', durationMs: _now() - start },
      };
    }

    // Routes seem broken — try to extract new ones from JS bundle
    if (!scrapeCtx.jsContent) {
      return {
        result: {
          status: 'error',
          error: 'Routes returned 404 but no JS bundle available to extract new routes',
          durationMs: _now() - start,
        },
      };
    }

    const newRoutes = extractApiRoutes(scrapeCtx.jsContent);
    if (!newRoutes) {
      return {
        result: {
          status: 'error',
          error: 'Routes returned 404 and could not extract new routes from JS bundle',
          durationMs: _now() - start,
        },
      };
    }

    const oldRoutes = JSON.stringify(config.apiRoutes);
    const merged: ApiRoutes = {
      time: newRoutes.time || config.apiRoutes.time,
      movieImages: newRoutes.movieImages || config.apiRoutes.movieImages,
      tvImages: newRoutes.tvImages || config.apiRoutes.tvImages,
    };

    await kv.put('api_routes', JSON.stringify(merged), { expirationTtl: KV_TTL_SECONDS });

    const alert: Alert = {
      type: 'route_change',
      message: `API routes changed`,
      oldValue: oldRoutes,
      newValue: JSON.stringify(merged),
      autoFixed: true,
    };

    return {
      result: {
        status: 'changed',
        oldValue: oldRoutes,
        newValue: JSON.stringify(merged),
        durationMs: _now() - start,
      },
      alert,
    };
  } catch (err) {
    return {
      result: {
        status: 'error',
        error: (err as Error).message,
        durationMs: _now() - start,
      },
    };
  }
}

/**
 * Check WASM: download binary, hash it, compare with stored hash.
 * If changed, run compatibility check.
 */
export async function checkWasm(
  kv: KVNamespace,
  scrapeCtx: ScrapeContext,
  env: Env,
): Promise<{ result: CheckResult; alert?: Alert }> {
  const start = _now();
  try {
    if (!scrapeCtx.jsContent) {
      return {
        result: {
          status: 'error',
          error: 'No JS bundle content available for WASM URL extraction',
          durationMs: _now() - start,
        },
      };
    }

    const wasmUrl = extractWasmUrl(scrapeCtx.jsContent, scrapeCtx.finalUrl);
    if (!wasmUrl) {
      return {
        result: {
          status: 'error',
          error: 'Could not extract WASM URL from JS bundle',
          durationMs: _now() - start,
        },
      };
    }

    const wasmResp = await fetch(wasmUrl, {
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (!wasmResp.ok) {
      return {
        result: {
          status: 'error',
          error: `WASM download failed: HTTP ${wasmResp.status}`,
          durationMs: _now() - start,
        },
      };
    }

    const wasmBytes = await wasmResp.arrayBuffer();
    const newHash = await computeHash(wasmBytes);
    const storedHash = await kv.get('wasm_hash');

    if (storedHash === newHash) {
      // Update last check timestamp
      await kv.put('last_wasm_check_timestamp', new Date(_now()).toISOString());
      return {
        result: { status: 'ok', durationMs: _now() - start },
      };
    }

    // WASM changed — run compatibility check
    const compatReport = await checkWasmCompatibility(wasmBytes);
    await kv.put('wasm_hash', newHash);
    await kv.put('wasm_compat_report', JSON.stringify(compatReport));
    await kv.put('last_wasm_check_timestamp', new Date(_now()).toISOString());

    const alertType = compatReport.compatible ? 'wasm_change' : 'wasm_breaking_change';
    const alert: Alert = {
      type: alertType,
      message: compatReport.compatible
        ? `WASM binary updated (compatible). Hash: ${newHash.slice(0, 16)}...`
        : `WASM binary updated with BREAKING CHANGES. Manual review required. Hash: ${newHash.slice(0, 16)}...`,
      oldValue: storedHash || '(none)',
      newValue: newHash,
      autoFixed: false,
    };

    return {
      result: {
        status: 'changed',
        oldValue: storedHash || '(none)',
        newValue: newHash,
        durationMs: _now() - start,
      },
      alert,
    };
  } catch (err) {
    return {
      result: {
        status: 'error',
        error: (err as Error).message,
        durationMs: _now() - start,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/**
 * Run the full health check suite. Called by the Cron Trigger handler.
 *
 * 1. Build scrape context (fetch hexa.su HTML + JS bundle once)
 * 2. Run domain, fingerprint, route checks in parallel
 * 3. Conditionally run WASM check (every 6 hours)
 * 4. Compute status transition
 * 5. Update monitor state in KV
 * 6. Send alerts for any changes
 */
export async function runHealthChecks(
  env: Env,
  ctx: ExecutionContext,
): Promise<MonitorResult> {
  const kv = env.HEXA_CONFIG;
  if (!kv) {
    // No KV bound — return a no-op result
    return {
      timestamp: _now(),
      checks: {
        domain: { status: 'error', error: 'HEXA_CONFIG KV not bound', durationMs: 0 },
        fingerprint: { status: 'error', error: 'HEXA_CONFIG KV not bound', durationMs: 0 },
        routes: { status: 'error', error: 'HEXA_CONFIG KV not bound', durationMs: 0 },
        wasm: null,
      },
      alerts: [],
    };
  }

  const alerts: Alert[] = [];
  let scrapeCtx: ScrapeContext;

  try {
    scrapeCtx = await buildScrapeContext();
  } catch (err) {
    // hexa.su completely unreachable
    const errorMsg = (err as Error).message;
    const unreachableAlert: Alert = {
      type: 'unreachable',
      message: `hexa.su unreachable: ${errorMsg}`,
      autoFixed: false,
    };
    alerts.push(unreachableAlert);

    // Update failure state
    await updateMonitorState(kv, false, alerts, {
      timestamp: _now(),
      checks: {
        domain: { status: 'error', error: errorMsg, durationMs: 0 },
        fingerprint: { status: 'error', error: errorMsg, durationMs: 0 },
        routes: { status: 'error', error: errorMsg, durationMs: 0 },
        wasm: null,
      },
      alerts,
    });

    // Send alerts
    if (env.HEXA_ALERT_WEBHOOK_URL) {
      for (const alert of alerts) {
        ctx.waitUntil(sendAlert(env.HEXA_ALERT_WEBHOOK_URL, alert, kv));
      }
    }

    return {
      timestamp: _now(),
      checks: {
        domain: { status: 'error', error: errorMsg, durationMs: 0 },
        fingerprint: { status: 'error', error: errorMsg, durationMs: 0 },
        routes: { status: 'error', error: errorMsg, durationMs: 0 },
        wasm: null,
      },
      alerts,
    };
  }

  // Run domain, fingerprint checks
  const [domainOut, fpOut] = await Promise.all([
    checkDomain(kv, scrapeCtx),
    checkFingerprint(kv, scrapeCtx),
  ]);

  if (domainOut.alert) alerts.push(domainOut.alert);
  if (fpOut.alert) alerts.push(fpOut.alert);

  // Determine current API domain for route check
  const currentConfig = await getHexaConfig(kv);
  const apiDomain = domainOut.result.status === 'changed' && domainOut.result.newValue
    ? domainOut.result.newValue
    : currentConfig.apiDomain;

  // Route check
  const routeOut = await checkRoutes(kv, apiDomain, scrapeCtx);
  if (routeOut.alert) alerts.push(routeOut.alert);

  // WASM check (only every 6 hours)
  let wasmResult: CheckResult | null = null;
  const runWasm = await shouldRunWasmCheck(kv);
  if (runWasm) {
    const wasmOut = await checkWasm(kv, scrapeCtx, env);
    wasmResult = wasmOut.result;
    if (wasmOut.alert) alerts.push(wasmOut.alert);
  }

  // Determine if this run was successful (at least domain check ok)
  const anyCheckOk = domainOut.result.status !== 'error'
    || fpOut.result.status !== 'error'
    || routeOut.result.status !== 'error';

  const result: MonitorResult = {
    timestamp: _now(),
    checks: {
      domain: domainOut.result,
      fingerprint: fpOut.result,
      routes: routeOut.result,
      wasm: wasmResult,
    },
    alerts,
  };

  // Update monitor state in KV
  await updateMonitorState(kv, anyCheckOk, alerts, result);

  // Update last check timestamp
  await kv.put('last_check_timestamp', new Date(_now()).toISOString());

  // Refresh in-memory config cache after updates
  await refreshHexaConfig(kv);

  // Refresh Cap.js PoW token if expired or missing (runs every 15 min via cron).
  // The PoW solving is CPU-intensive (~60-80s) but well within CF Worker limits
  // for cron triggers (which have 30s CPU time on paid plan).
  // waitUntil ensures it completes even if the response is already sent.
  ctx.waitUntil(
    refreshCapToken(kv).catch(err => {
      console.error(`[Cap] Token refresh failed: ${err instanceof Error ? err.message : String(err)}`);
    })
  );

  // Send alerts
  if (env.HEXA_ALERT_WEBHOOK_URL) {
    for (const alert of alerts) {
      ctx.waitUntil(sendAlert(env.HEXA_ALERT_WEBHOOK_URL, alert, kv));
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Monitor state persistence
// ---------------------------------------------------------------------------

async function updateMonitorState(
  kv: KVNamespace,
  checkSucceeded: boolean,
  alerts: Alert[],
  result: MonitorResult,
): Promise<void> {
  try {
    const existingRaw = await kv.get('monitor_state');
    let existing: MonitorState | null = null;
    if (existingRaw) {
      try { existing = JSON.parse(existingRaw); } catch { /* ignore */ }
    }

    const now = _now();
    const lastSuccessfulCheck = checkSucceeded
      ? new Date(now).toISOString()
      : (existing?.lastSuccessfulCheck ?? null);
    const lastFailedCheck = !checkSucceeded
      ? new Date(now).toISOString()
      : (existing?.lastFailedCheck ?? null);
    const consecutiveFailures = checkSucceeded
      ? 0
      : (existing?.consecutiveFailures ?? 0) + 1;

    const lastSuccessMs = lastSuccessfulCheck ? Date.parse(lastSuccessfulCheck) : null;
    const firstFailureMs = existing?.lastFailedCheck && !checkSucceeded
      ? Date.parse(existing.lastFailedCheck)
      : (!checkSucceeded ? now : null);

    const status = computeStatus(lastSuccessMs, firstFailureMs, checkSucceeded, now);

    const config = await getHexaConfig(kv);
    const state: MonitorState = {
      status,
      lastSuccessfulCheck,
      lastFailedCheck,
      consecutiveFailures,
      currentConfig: {
        apiDomain: config.apiDomain,
        fingerprintLite: config.fingerprintLite,
        wasmHash: config.wasmHash,
        apiRoutes: config.apiRoutes,
      },
      pendingAlerts: alerts,
      lastCheckResult: result,
    };

    await kv.put('monitor_state', JSON.stringify(state));
  } catch {
    // Best-effort — don't fail the check if state persistence fails
  }
}
