/**
 * Channel Page Fetcher
 * Fetches individual channel pages from DLHD with proper authentication handling
 * 
 * Requirements: 2.1, 3.1
 * 
 * IMPORTANT: All fetches to DLHD domains MUST go through the RPI proxy
 * to bypass Cloudflare protection. Direct fetches will be blocked.
 */

import { AuthContext } from '../types';
import { buildDLHDHeaders, FetchOptions, FetchResult, getProxyConfig } from '../discovery/fetcher';

const DLHD_BASE_URL = 'https://dlhd.link';

const DEFAULT_OPTIONS: Pick<Required<FetchOptions>, 'maxRetries' | 'baseDelayMs' | 'maxDelayMs'> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay
 */
function calculateBackoff(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const delay = baseDelayMs * Math.pow(2, attempt);
  return Math.min(delay, maxDelayMs);
}

/**
 * Build headers for channel page requests with optional auth context
 */
export function buildChannelPageHeaders(
  _channelId: string,
  authContext?: AuthContext
): Record<string, string> {
  const baseHeaders = buildDLHDHeaders(`${DLHD_BASE_URL}/24-7-channels.php`);
  
  // Add authentication cookies if provided
  if (authContext?.cookies && authContext.cookies.size > 0) {
    const cookieString = Array.from(authContext.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
    baseHeaders['Cookie'] = cookieString;
  }
  
  // Add any additional auth headers
  if (authContext?.headers) {
    Object.assign(baseHeaders, authContext.headers);
  }
  
  return baseHeaders;
}

/**
 * Extract cookies from Set-Cookie headers
 */
export function extractCookies(response: Response): Map<string, string> {
  const cookies = new Map<string, string>();
  const setCookieHeaders = response.headers.getAll?.('Set-Cookie') || [];
  
  // Fallback for environments that don't support getAll
  const singleCookie = response.headers.get('Set-Cookie');
  if (singleCookie && setCookieHeaders.length === 0) {
    setCookieHeaders.push(singleCookie);
  }
  
  for (const cookieHeader of setCookieHeaders) {
    // Parse cookie name=value from Set-Cookie header
    const match = cookieHeader.match(/^([^=]+)=([^;]*)/);
    if (match) {
      cookies.set(match[1].trim(), match[2].trim());
    }
  }
  
  return cookies;
}

/**
 * Extended fetch result with cookies
 */
export interface ChannelFetchResult {
  html: string;
  status: number;
  retryCount: number;
  durationMs: number;
  cookies: Map<string, string>;
}

/**
 * Fetch a channel page with retry logic and auth context support
 * 
 * IMPORTANT: Routes requests through RPI proxy to bypass Cloudflare protection.
 */
export async function fetchChannelPage(
  channelId: string,
  authContext?: AuthContext,
  options: FetchOptions = {}
): Promise<ChannelFetchResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const url = `${DLHD_BASE_URL}/watch.php?id=${channelId}`;
  const startTime = Date.now();
  const proxyConfig = getProxyConfig();
  
  let lastError: Error | null = null;
  let retryCount = 0;
  let collectedCookies = new Map<string, string>();

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      let response: Response;
      
      // Check if we should use the RPI proxy (required for DLHD domains)
      if (proxyConfig.url && proxyConfig.apiKey) {
        // Route through RPI proxy to bypass Cloudflare protection
        const proxyUrl = new URL('/proxy', proxyConfig.url);
        proxyUrl.searchParams.set('url', url);
        
        response = await fetch(proxyUrl.toString(), {
          headers: {
            'X-API-Key': proxyConfig.apiKey,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
        });
      } else {
        // Direct fetch (will likely fail due to Cloudflare protection)
        const headers = buildChannelPageHeaders(channelId, authContext);
        response = await fetch(url, { headers });
      }
      
      // Collect any cookies from the response
      const responseCookies = extractCookies(response);
      responseCookies.forEach((value, key) => collectedCookies.set(key, value));

      if (!response.ok) {
        // Check if it's a retryable error (5xx or rate limit)
        if (response.status >= 500 || response.status === 429) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        // Non-retryable error (4xx except 429)
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();
      return {
        html,
        status: response.status,
        retryCount,
        durationMs: Date.now() - startTime,
        cookies: collectedCookies,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      retryCount = attempt;

      // Don't retry on last attempt
      if (attempt < opts.maxRetries) {
        const delay = calculateBackoff(attempt, opts.baseDelayMs, opts.maxDelayMs);
        await sleep(delay);
      }
    }
  }

  throw lastError || new Error('Fetch failed after retries');
}

/**
 * Fetch a player embed page
 * 
 * IMPORTANT: Routes requests through RPI proxy to bypass Cloudflare protection.
 */
export async function fetchEmbedPage(
  embedUrl: string,
  referer: string,
  authContext?: AuthContext,
  options: FetchOptions = {}
): Promise<ChannelFetchResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const startTime = Date.now();
  const proxyConfig = getProxyConfig();
  
  let lastError: Error | null = null;
  let retryCount = 0;
  let collectedCookies = new Map<string, string>();

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      let response: Response;
      
      // Check if we should use the RPI proxy (required for DLHD domains)
      if (proxyConfig.url && proxyConfig.apiKey) {
        // Route through RPI proxy to bypass Cloudflare protection
        const proxyUrl = new URL('/proxy', proxyConfig.url);
        proxyUrl.searchParams.set('url', embedUrl);
        
        // Pass referer to proxy
        if (referer) {
          proxyUrl.searchParams.set('referer', referer);
        }
        
        response = await fetch(proxyUrl.toString(), {
          headers: {
            'X-API-Key': proxyConfig.apiKey,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
        });
      } else {
        // Direct fetch (will likely fail due to Cloudflare protection)
        const headers: Record<string, string> = {
          ...buildDLHDHeaders(referer),
        };
        
        // Add authentication cookies if provided
        if (authContext?.cookies && authContext.cookies.size > 0) {
          const cookieString = Array.from(authContext.cookies.entries())
            .map(([name, value]) => `${name}=${value}`)
            .join('; ');
          headers['Cookie'] = cookieString;
        }
        
        response = await fetch(embedUrl, { headers });
      }
      
      // Collect any cookies from the response
      const responseCookies = extractCookies(response);
      responseCookies.forEach((value, key) => collectedCookies.set(key, value));

      if (!response.ok) {
        if (response.status >= 500 || response.status === 429) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();
      return {
        html,
        status: response.status,
        retryCount,
        durationMs: Date.now() - startTime,
        cookies: collectedCookies,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      retryCount = attempt;

      if (attempt < opts.maxRetries) {
        const delay = calculateBackoff(attempt, opts.baseDelayMs, opts.maxDelayMs);
        await sleep(delay);
      }
    }
  }

  throw lastError || new Error('Fetch failed after retries');
}
