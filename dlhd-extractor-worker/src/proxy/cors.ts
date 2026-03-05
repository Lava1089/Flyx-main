/**
 * CORS Headers for Proxy Responses
 * 
 * Requirements: 5.8
 * - THE Stream_Proxy component SHALL return proper CORS headers so any client 
 *   can play the stream directly
 */

/**
 * CORS headers for proxy responses
 * These headers allow any client to play streams directly
 */
export const PROXY_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Range, Accept, Accept-Encoding, X-API-Key',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Content-Type',
  'Access-Control-Max-Age': '86400',
};

/**
 * Required CORS headers that must be present
 */
export const REQUIRED_CORS_HEADERS = [
  'Access-Control-Allow-Origin',
  'Access-Control-Allow-Methods',
  'Access-Control-Allow-Headers',
];

/**
 * Add CORS headers to a proxy response
 * 
 * @param response - The response to add CORS headers to
 */
export function addProxyCorsHeaders(response: Response): Response {
  const newHeaders = new Headers(response.headers);
  
  for (const [key, value] of Object.entries(PROXY_CORS_HEADERS)) {
    newHeaders.set(key, value);
  }
  
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

/**
 * Handle CORS preflight request for proxy endpoints
 * 
 * @returns Response with CORS headers and 204 status
 */
export function handleProxyPreflightRequest(): Response {
  return new Response(null, {
    status: 204,
    headers: PROXY_CORS_HEADERS,
  });
}

/**
 * Check if a response has all required CORS headers
 * 
 * @param response - The response to check
 */
export function hasRequiredCorsHeaders(response: Response): boolean {
  for (const header of REQUIRED_CORS_HEADERS) {
    if (!response.headers.has(header)) {
      return false;
    }
  }
  return true;
}

/**
 * Get missing CORS headers from a response
 * 
 * @param response - The response to check
 */
export function getMissingCorsHeaders(response: Response): string[] {
  const missing: string[] = [];
  
  for (const header of REQUIRED_CORS_HEADERS) {
    if (!response.headers.has(header)) {
      missing.push(header);
    }
  }
  
  return missing;
}

/**
 * Check if Access-Control-Allow-Origin allows all origins
 * 
 * @param response - The response to check
 */
export function allowsAllOrigins(response: Response): boolean {
  const origin = response.headers.get('Access-Control-Allow-Origin');
  return origin === '*';
}

/**
 * Get all CORS headers from a response
 * 
 * @param response - The response to extract CORS headers from
 */
export function getCorsHeaders(response: Response): Record<string, string> {
  const corsHeaders: Record<string, string> = {};
  
  for (const [key, value] of response.headers.entries()) {
    if (key.toLowerCase().startsWith('access-control-')) {
      corsHeaders[key] = value;
    }
  }
  
  return corsHeaders;
}

/**
 * Create a CORS error response
 * 
 * @param message - Error message
 */
export function createCorsErrorResponse(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 403,
    headers: {
      'Content-Type': 'application/json',
      ...PROXY_CORS_HEADERS,
    },
  });
}
