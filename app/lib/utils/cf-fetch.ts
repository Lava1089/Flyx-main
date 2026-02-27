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

// Detect if we're running on Cloudflare Workers
function isCloudflareWorker(): boolean {
  try {
    // Multiple detection methods for Cloudflare Workers environment:
    // 1. caches.default only exists in Cloudflare Workers
    // 2. Check for CF-specific globals
    // 3. Check if we're NOT in Node.js (no process.versions.node in Workers)
    
    // @ts-ignore - caches.default only exists in Cloudflare Workers
    const hasCachesDefault = typeof caches !== 'undefined' && typeof caches.default !== 'undefined';
    
    // In Cloudflare Workers, process.versions.node is undefined
    // In Node.js, it's defined
    const isNotNode = typeof process === 'undefined' || 
                      typeof process.versions === 'undefined' || 
                      typeof process.versions.node === 'undefined';
    
    // Check for Cloudflare-specific environment
    // @ts-ignore
    const hasCfEnv = typeof globalThis.caches !== 'undefined';
    
    return hasCachesDefault || (isNotNode && hasCfEnv);
  } catch {
    return false;
  }
}

/**
 * Get RPI proxy configuration from environment
 * Works in both Node.js and Cloudflare Workers
 */
function getRpiConfig(): { url: string | undefined; key: string | undefined } {
  // Try process.env first (works in Node.js and build time)
  let url = process.env.RPI_PROXY_URL || process.env.NEXT_PUBLIC_RPI_PROXY_URL;
  let key = process.env.RPI_PROXY_KEY || process.env.NEXT_PUBLIC_RPI_PROXY_KEY;
  
  // If in Cloudflare Workers, try to get from CF context
  if (isCloudflareWorker() && (!url || !key)) {
    try {
      // Try OpenNext's getCloudflareContext
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getCloudflareContext } = require('@opennextjs/cloudflare');
      const ctx = getCloudflareContext({ async: false });
      if (ctx?.env) {
        url = url || ctx.env.RPI_PROXY_URL;
        key = key || ctx.env.RPI_PROXY_KEY;
      }
    } catch (e) {
      // getCloudflareContext not available
      console.debug('[cfFetch] getCloudflareContext failed:', e instanceof Error ? e.message : e);
    }
    
    // Try global CF env
    const globalEnv = (globalThis as unknown as { process?: { env?: Record<string, string> } })?.process?.env;
    if (globalEnv) {
      url = url || globalEnv.RPI_PROXY_URL;
      key = key || globalEnv.RPI_PROXY_KEY;
    }
    
    // Try __cf_env__
    const cfEnv = (globalThis as unknown as { __cf_env__?: Record<string, string> })?.__cf_env__;
    if (cfEnv) {
      url = url || cfEnv.RPI_PROXY_URL;
      key = key || cfEnv.RPI_PROXY_KEY;
    }
  }
  
  return { url, key };
}

/**
 * Fetch that automatically routes through RPI proxy when on Cloudflare
 */
export async function cfFetch(
  url: string,
  options: RequestInit = {},
  forceProxy: boolean = false
): Promise<Response> {
  const isCfWorker = isCloudflareWorker();
  const useProxy = forceProxy || isCfWorker;
  
  // Get RPI config dynamically (handles CF Workers env)
  const { url: RPI_PROXY_URL, key: RPI_PROXY_KEY } = getRpiConfig();
  
  console.log(`[cfFetch] isCfWorker=${isCfWorker}, useProxy=${useProxy}, RPI_URL=${RPI_PROXY_URL ? 'set' : 'unset'}, RPI_KEY=${RPI_PROXY_KEY ? 'set' : 'unset'}`);
  
  if (useProxy && RPI_PROXY_URL && RPI_PROXY_KEY) {
    // Route through RPI residential proxy
    // Format: GET /proxy?url=<encoded_url> with X-API-Key header
    const proxyUrl = `${RPI_PROXY_URL}/proxy?url=${encodeURIComponent(url)}`;
    
    const headers = new Headers(options.headers);
    headers.set('X-API-Key', RPI_PROXY_KEY);
    
    console.log(`[cfFetch] Routing through RPI: ${url.substring(0, 80)}...`);
    
    try {
      const response = await fetch(proxyUrl, {
        method: 'GET', // RPI /proxy endpoint only supports GET
        headers,
        signal: options.signal,
      });
      
      console.log(`[cfFetch] RPI response: ${response.status} ${response.statusText}`);
      
      // If RPI returns 429 (rate limited), log it
      if (response.status === 429) {
        console.warn(`[cfFetch] RPI proxy rate limited (429) for: ${url.substring(0, 60)}...`);
      }
      
      return response;
    } catch (error) {
      console.error(`[cfFetch] RPI proxy error:`, error instanceof Error ? error.message : error);
      // Fall back to direct fetch if RPI fails
      console.log(`[cfFetch] Falling back to direct fetch...`);
      return fetch(url, options);
    }
  }
  
  // Direct fetch (local dev, or RPI not configured)
  if (useProxy && (!RPI_PROXY_URL || !RPI_PROXY_KEY)) {
    console.warn(`[cfFetch] On CF Worker but RPI not configured! Direct fetch will likely fail.`);
  }
  console.log(`[cfFetch] Direct fetch: ${url.substring(0, 80)}...`);
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
