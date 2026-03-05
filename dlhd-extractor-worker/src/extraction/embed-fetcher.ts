/**
 * Embed Page Fetcher
 * Fetches player embed pages with proper authentication context
 * 
 * Requirements: 4.1
 * - WHEN a player embed page is loaded, THE Stream_Extractor component 
 *   SHALL parse the page to find the M3U8 URL
 * 
 * IMPORTANT: All fetches to DLHD domains MUST go through the RPI proxy
 * to bypass Cloudflare protection. Direct fetches will be blocked.
 */

import { AuthContext } from '../types';
import { getProxyConfig } from '../discovery/fetcher';

/**
 * Known player server domains
 */
export const PLAYER_DOMAINS: Record<number, string[]> = {
  1: ['dlhd.link', 'dlhd.sx'],
  2: ['dlhd.link', 'dlhd.sx'],
  3: ['dlhd.link', 'dlhd.sx'],
  4: ['dlhd.link', 'dlhd.sx'],
  5: ['dlhd.link', 'dlhd.sx'],
  6: ['dlhd.link', 'dlhd.sx'],
};

/**
 * Fetch options for embed pages
 */
export interface EmbedFetchOptions {
  /** Maximum number of retries */
  maxRetries?: number;
  /** Base delay for exponential backoff in ms */
  baseDelayMs?: number;
  /** Maximum delay between retries in ms */
  maxDelayMs?: number;
  /** Request timeout in ms */
  timeoutMs?: number;
}

const DEFAULT_OPTIONS: Required<EmbedFetchOptions> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  timeoutMs: 30000,
};

/**
 * Result of fetching an embed page
 */
export interface EmbedFetchResult {
  /** The HTML content of the embed page */
  html: string;
  /** HTTP status code */
  status: number;
  /** Number of retries performed */
  retryCount: number;
  /** Total duration in milliseconds */
  durationMs: number;
  /** Cookies received from the response */
  cookies: Map<string, string>;
  /** Final URL after any redirects */
  finalUrl: string;
  /** Response headers */
  responseHeaders: Record<string, string>;
}

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
 * Extract cookies from Set-Cookie headers
 */
function extractCookies(response: Response): Map<string, string> {
  const cookies = new Map<string, string>();
  
  // Try getAll first (Cloudflare Workers support this)
  const setCookieHeaders = response.headers.getAll?.('Set-Cookie') || [];
  
  // Fallback for environments that don't support getAll
  const singleCookie = response.headers.get('Set-Cookie');
  if (singleCookie && setCookieHeaders.length === 0) {
    setCookieHeaders.push(singleCookie);
  }
  
  for (const cookieHeader of setCookieHeaders) {
    const match = cookieHeader.match(/^([^=]+)=([^;]*)/);
    if (match) {
      cookies.set(match[1].trim(), match[2].trim());
    }
  }
  
  return cookies;
}

/**
 * Extract response headers as a plain object
 */
function extractResponseHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return headers;
}

/**
 * Build headers for embed page requests
 */
export function buildEmbedHeaders(
  embedUrl: string,
  referer: string,
  authContext?: AuthContext
): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': referer,
    'DNT': '1',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'iframe',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
  };

  // Determine origin from embed URL
  try {
    const url = new URL(embedUrl);
    headers['Origin'] = `${url.protocol}//${url.host}`;
  } catch {
    headers['Origin'] = 'https://dlhd.link';
  }

  // Add authentication cookies if provided
  if (authContext?.cookies && authContext.cookies.size > 0) {
    const cookieString = Array.from(authContext.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
    headers['Cookie'] = cookieString;
  }

  // Add any additional auth headers
  if (authContext?.headers) {
    Object.assign(headers, authContext.headers);
  }

  return headers;
}

/**
 * Fetch an embed page with retry logic and authentication support
 * 
 * IMPORTANT: Routes requests through RPI proxy to bypass Cloudflare protection.
 * Direct fetches to DLHD domains will be blocked.
 * 
 * @param embedUrl - The URL of the embed page to fetch
 * @param referer - The referer URL (typically the channel page)
 * @param authContext - Optional authentication context with cookies/tokens
 * @param options - Fetch options
 */
export async function fetchEmbedPage(
  embedUrl: string,
  referer: string,
  authContext?: AuthContext,
  options: EmbedFetchOptions = {}
): Promise<EmbedFetchResult> {
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
        
        // Pass referer to proxy so it can include it in the upstream request
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
        const headers = buildEmbedHeaders(embedUrl, referer, authContext);
        response = await fetch(embedUrl, { 
          headers,
          redirect: 'follow',
        });
      }
      
      // Collect cookies from response
      const responseCookies = extractCookies(response);
      responseCookies.forEach((value, key) => collectedCookies.set(key, value));

      if (!response.ok) {
        // Check if it's a retryable error
        if (response.status >= 500 || response.status === 429) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        // Non-retryable client errors
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();
      
      return {
        html,
        status: response.status,
        retryCount,
        durationMs: Date.now() - startTime,
        cookies: collectedCookies,
        finalUrl: response.url || embedUrl,
        responseHeaders: extractResponseHeaders(response),
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

  throw lastError || new Error('Embed page fetch failed after retries');
}

/**
 * Determine the player server domain from embed URL
 */
export function getPlayerDomain(embedUrl: string): string | null {
  try {
    const url = new URL(embedUrl);
    return url.hostname;
  } catch {
    return null;
  }
}

/**
 * Check if a domain is a known DLHD player domain
 */
export function isKnownPlayerDomain(domain: string): boolean {
  for (const domains of Object.values(PLAYER_DOMAINS)) {
    if (domains.includes(domain)) {
      return true;
    }
  }
  return false;
}
