/**
 * URL Encoding for Proxy Transport
 * 
 * Requirements: 5.2
 * - THE Stream_Proxy component SHALL rewrite ALL URLs in M3U8 playlists 
 *   to route through our Worker proxy
 * 
 * This module provides reversible encoding for upstream URLs and headers
 * to be transported via query parameters.
 */

/**
 * Parameters encoded in proxy URLs
 */
export interface ProxyUrlParams {
  /** Original upstream URL (base64 encoded) */
  url: string;
  /** Required headers (base64 JSON) */
  headers?: string;
  /** Referer header */
  referer?: string;
  /** Origin header */
  origin?: string;
}

/**
 * Decoded proxy parameters
 */
export interface DecodedProxyParams {
  url: string;
  headers: Record<string, string>;
  referer?: string;
  origin?: string;
}

/**
 * Encode a string to URL-safe base64
 */
export function encodeBase64Url(str: string): string {
  // Use btoa for base64 encoding, then make URL-safe
  const base64 = btoa(str);
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Decode URL-safe base64 to string
 */
export function decodeBase64Url(encoded: string): string {
  // Restore standard base64 characters
  let base64 = encoded
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  
  // Add padding if needed
  const padding = base64.length % 4;
  if (padding) {
    base64 += '='.repeat(4 - padding);
  }
  
  return atob(base64);
}

/**
 * Encode upstream URL and headers for proxy transport
 * 
 * @param upstreamUrl - The original upstream URL
 * @param headers - Required headers for upstream request
 * @param workerBaseUrl - Base URL of the worker (e.g., https://worker.example.com)
 * @param resourceType - Type of resource (m3u8, ts, key)
 * @param apiKey - Optional API key to include in URL for VLC/media player compatibility
 */
export function encodeProxyUrl(
  upstreamUrl: string,
  headers: Record<string, string>,
  workerBaseUrl: string,
  resourceType: 'playlist' | 'segment' | 'key' = 'playlist',
  apiKey?: string
): string {
  const params = new URLSearchParams();
  
  // Encode the upstream URL
  params.set('url', encodeBase64Url(upstreamUrl));
  
  // Encode headers if present
  if (Object.keys(headers).length > 0) {
    params.set('h', encodeBase64Url(JSON.stringify(headers)));
  }
  
  // Include API key for VLC/media player compatibility
  // These players can't send headers, so we pass auth via query param
  if (apiKey) {
    params.set('key', apiKey);
  }
  
  // Determine endpoint based on resource type
  let endpoint: string;
  switch (resourceType) {
    case 'segment':
      endpoint = '/live/ts';
      break;
    case 'key':
      endpoint = '/live/key';
      break;
    case 'playlist':
    default:
      endpoint = '/live/m3u8';
      break;
  }
  
  return `${workerBaseUrl}${endpoint}?${params.toString()}`;
}

/**
 * Decode proxy URL parameters back to original values
 * 
 * @param searchParams - URL search parameters from the request
 */
export function decodeProxyParams(searchParams: URLSearchParams): DecodedProxyParams {
  const encodedUrl = searchParams.get('url');
  if (!encodedUrl) {
    throw new Error('Missing required "url" parameter');
  }
  
  const url = decodeBase64Url(encodedUrl);
  
  // Decode headers if present
  let headers: Record<string, string> = {};
  const encodedHeaders = searchParams.get('h');
  if (encodedHeaders) {
    try {
      headers = JSON.parse(decodeBase64Url(encodedHeaders));
    } catch {
      // Invalid headers, use empty object
      headers = {};
    }
  }
  
  // Get referer and origin if present
  const referer = searchParams.get('r') ? decodeBase64Url(searchParams.get('r')!) : undefined;
  const origin = searchParams.get('o') ? decodeBase64Url(searchParams.get('o')!) : undefined;
  
  return { url, headers, referer, origin };
}

/**
 * Encode a simple URL for proxy transport (minimal encoding)
 * Used for segment URLs where we want to minimize URL length
 * 
 * @param upstreamUrl - The original upstream URL
 * @param workerBaseUrl - Base URL of the worker
 */
export function encodeSimpleProxyUrl(
  upstreamUrl: string,
  workerBaseUrl: string
): string {
  const params = new URLSearchParams();
  params.set('url', encodeBase64Url(upstreamUrl));
  return `${workerBaseUrl}/live/ts?${params.toString()}`;
}

/**
 * Check if a URL is already a proxy URL
 * 
 * @param url - URL to check
 * @param workerBaseUrl - Base URL of the worker
 */
export function isProxyUrl(url: string, workerBaseUrl: string): boolean {
  return url.startsWith(workerBaseUrl + '/live/');
}

/**
 * Extract the resource type from a URL
 */
export function getResourceType(url: string): 'playlist' | 'segment' | 'key' | 'unknown' {
  const lowerUrl = url.toLowerCase();
  
  if (lowerUrl.includes('.m3u8') || lowerUrl.includes('/playlist')) {
    return 'playlist';
  }
  
  if (lowerUrl.includes('.ts') || lowerUrl.includes('/segment')) {
    return 'segment';
  }
  
  if (lowerUrl.includes('.key') || lowerUrl.includes('/key') || lowerUrl.includes('aes')) {
    return 'key';
  }
  
  return 'unknown';
}

/**
 * Resolve a relative URL against a base URL
 */
export function resolveUrl(relativeUrl: string, baseUrl: string): string {
  // If already absolute, return as-is
  if (relativeUrl.startsWith('http://') || relativeUrl.startsWith('https://')) {
    return relativeUrl;
  }
  
  // Handle protocol-relative URLs
  if (relativeUrl.startsWith('//')) {
    const baseProtocol = new URL(baseUrl).protocol;
    return `${baseProtocol}${relativeUrl}`;
  }
  
  // Use URL constructor for proper resolution
  try {
    return new URL(relativeUrl, baseUrl).href;
  } catch {
    // Fallback: simple concatenation
    const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const relative = relativeUrl.startsWith('/') ? relativeUrl : '/' + relativeUrl;
    return base + relative;
  }
}
