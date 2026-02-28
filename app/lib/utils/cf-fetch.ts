/**
 * Cloudflare-aware fetch utility
 * 
 * When running on Cloudflare Workers, many sites block datacenter IPs.
 * This utility detects if we're on Cloudflare and routes requests through
 * the RPI residential proxy to bypass these blocks.
 * 
 * Usage:
 *   import { cfFetch } from '@/app/lib/utils/cf-fetch';
 *   const response = await cfFetch(url, options);
 */

// Cache the CF detection result — it won't change during a request lifecycle
let _isCfWorkerCached: boolean | null = null;

// Cache the RPI config — avoids repeated getCloudflareContext calls
let _rpiConfigCached: { url: string | undefined; key: string | undefined } | null = null;
let _rpiConfigCacheTime = 0;
const RPI_CONFIG_CACHE_TTL = 30_000; // 30 seconds

// Detect if we're running on Cloudflare Workers/Pages (via OpenNext)
function isCloudflareWorker(): boolean {
  if (_isCfWorkerCached !== null) return _isCfWorkerCached;
  
  try {
    // Method 1: caches.default only exists in Cloudflare Workers
    // @ts-ignore - caches.default only exists in Cloudflare Workers
    if (typeof caches !== 'undefined' && typeof caches.default !== 'undefined') {
      _isCfWorkerCached = true;
      return true;
    }
    
    // Method 2: Production environment is always CF Workers for this app
    // (deployed via @opennextjs/cloudflare — there is no Node.js production server)
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') {
      _isCfWorkerCached = true;
      return true;
    }
    
    _isCfWorkerCached = false;
    return false;
  } catch {
    _isCfWorkerCached = false;
    return false;
  }
}

/**
 * Get RPI proxy configuration from environment.
 * Works in both Node.js (dev) and Cloudflare Workers (production).
 * 
 * On CF Workers, secrets like RPI_PROXY_URL are NOT in process.env.
 * They're only accessible via getCloudflareContext() from @opennextjs/cloudflare.
 */
function getRpiConfig(): { url: string | undefined; key: string | undefined } {
  // Return cached config if still fresh
  if (_rpiConfigCached && (Date.now() - _rpiConfigCacheTime) < RPI_CONFIG_CACHE_TTL) {
    return _rpiConfigCached;
  }
  
  // Try process.env first (works in Node.js dev and for NEXT_PUBLIC_ vars baked at build time)
  let url = process.env.RPI_PROXY_URL || process.env.NEXT_PUBLIC_RPI_PROXY_URL;
  let key = process.env.RPI_PROXY_KEY || process.env.NEXT_PUBLIC_RPI_PROXY_KEY;
  
  // If we already have both from process.env, cache and return
  if (url && key) {
    _rpiConfigCached = { url, key };
    _rpiConfigCacheTime = Date.now();
    return _rpiConfigCached;
  }
  
  // On Cloudflare Workers, secrets are in the CF context, not process.env.
  // Try multiple methods to access them.
  if (isCloudflareWorker()) {
    // Method 1: OpenNext's getCloudflareContext (primary method for @opennextjs/cloudflare)
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getCloudflareContext } = require('@opennextjs/cloudflare');
      // Use synchronous version — works in request context
      const ctx = getCloudflareContext({ async: false });
      if (ctx?.env) {
        url = url || ctx.env.RPI_PROXY_URL;
        key = key || ctx.env.RPI_PROXY_KEY;
        if (url && key) {
          console.log('[cfFetch] Got RPI config from getCloudflareContext');
          _rpiConfigCached = { url, key };
          _rpiConfigCacheTime = Date.now();
          return _rpiConfigCached;
        }
      }
    } catch (e) {
      console.debug('[cfFetch] getCloudflareContext sync failed:', e instanceof Error ? e.message : e);
    }
    
    // Method 2: Check globalThis.__env__ (some OpenNext versions expose env here)
    try {
      const gEnv = (globalThis as any).__env__;
      if (gEnv) {
        url = url || gEnv.RPI_PROXY_URL;
        key = key || gEnv.RPI_PROXY_KEY;
      }
    } catch { /* ignore */ }
    
    // Method 3: Check globalThis.process.env (nodejs_compat shim)
    try {
      const pEnv = (globalThis as any).process?.env;
      if (pEnv) {
        url = url || pEnv.RPI_PROXY_URL;
        key = key || pEnv.RPI_PROXY_KEY;
      }
    } catch { /* ignore */ }
    
    if (!url || !key) {
      console.warn('[cfFetch] RPI config NOT found on CF Worker. Ensure RPI_PROXY_URL and RPI_PROXY_KEY are set via `wrangler secret put`');
    }
  }
  
  _rpiConfigCached = { url, key };
  _rpiConfigCacheTime = Date.now();
  return _rpiConfigCached;
}

/**
 * Fetch that automatically routes through RPI proxy when on Cloudflare.
 * 
 * Decision logic:
 * 1. forceProxy=true → always proxy through RPI
 * 2. Target is a CF Worker URL (*.workers.dev) AND we're on CF Workers → proxy
 *    CF Workers on the same account cannot directly fetch each other (404/hang).
 * 3. isCloudflareWorker() AND target is external → proxy (datacenter IP blocking)
 * 4. Otherwise → direct fetch
 */
export async function cfFetch(
  url: string,
  options: RequestInit = {},
  forceProxy: boolean = false
): Promise<Response> {
  const isCfWorker = isCloudflareWorker();
  
  const { url: RPI_PROXY_URL, key: RPI_PROXY_KEY } = getRpiConfig();
  const rpiConfigured = !!(RPI_PROXY_URL && RPI_PROXY_KEY);
  
  const isCfWorkerUrl = url.includes('.workers.dev');
  
  // On CF Workers: proxy everything (datacenter IP blocking + same-account fetch issue)
  // For CF Worker URLs in production: always proxy (same-account can't fetch each other)
  const useProxy = forceProxy || 
    (isCfWorker && rpiConfigured) ||
    (isCfWorkerUrl && isCfWorker);
  
  if (useProxy && RPI_PROXY_URL && RPI_PROXY_KEY) {
    const proxyUrl = `${RPI_PROXY_URL}/proxy?url=${encodeURIComponent(url)}`;
    
    const headers = new Headers(options.headers);
    headers.set('X-API-Key', RPI_PROXY_KEY);
    
    try {
      const response = await fetch(proxyUrl, {
        method: options.method || 'GET',
        headers,
        signal: options.signal,
        body: options.body,
      });
      
      if (response.status === 429) {
        console.warn(`[cfFetch] RPI proxy rate limited (429) for: ${url.substring(0, 60)}...`);
      }
      
      return response;
    } catch (error) {
      console.error(`[cfFetch] RPI proxy error for ${url.substring(0, 60)}:`, error instanceof Error ? error.message : error);
      // Fallback to direct fetch — may fail but worth trying
      return fetch(url, options);
    }
  }
  
  // Not on CF Workers or RPI not configured — log a warning in production
  if (isCfWorker && !rpiConfigured) {
    console.warn(`[cfFetch] On CF Worker but RPI not configured! Direct fetch to: ${url.substring(0, 80)}`);
  }
  
  return fetch(url, options);
}

/**
 * Check if RPI proxy is available
 */
export function isRpiProxyConfigured(): boolean {
  const { url, key } = getRpiConfig();
  return !!(url && key);
}

/**
 * Check if we're on Cloudflare and need proxying
 */
export function needsProxying(): boolean {
  return isCloudflareWorker();
}
