/**
 * Hexa/Flixer HTML & JS Bundle Scraping Utilities
 *
 * Pure extraction functions for detecting changes to hexa.su's infrastructure:
 * domain, fingerprint, WASM binary URL, and API routes.
 *
 * Requirements: REQ-DOMAIN-1.1, REQ-FP-1.1, REQ-WASM-1.1, REQ-ROUTE-1.1
 */

import type { ApiRoutes } from './hexa-config';

/**
 * Fetch hexa.su frontend, follow redirects, return final URL + HTML body.
 * Used to detect domain rotation (e.g. hexa.su → hexa2.su).
 */
export async function fetchHexaFrontend(): Promise<{ finalUrl: string; html: string }> {
  const response = await fetch('https://hexa.su', {
    redirect: 'follow',
    signal: AbortSignal.timeout(10_000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch hexa.su: HTTP ${response.status}`);
  }

  const html = await response.text();
  return { finalUrl: response.url, html };
}

/**
 * Extract the main JS bundle URL from hexa.su HTML.
 * Pattern: /assets/index-[hash].js or /assets/js/index-[hash].js (Vite-style hashed bundle)
 */
export function extractJsBundleUrl(html: string, baseUrl: string): string | null {
  // Match script src referencing the index bundle (with or without /js/ subdirectory)
  const match = html.match(/["']([^"']*\/assets\/(?:js\/)?index-[a-zA-Z0-9]+\.js)["']/);
  if (!match) return null;

  const path = match[1];
  // If already absolute, return as-is
  if (path.startsWith('http://') || path.startsWith('https://')) return path;

  // Resolve relative to baseUrl
  try {
    return new URL(path, baseUrl).href;
  } catch {
    return null;
  }
}

/**
 * Extract the API domain from the JS bundle content.
 * Pattern: https://[a-z]*moviedb[a-z]*\.\w+\.\w+
 */
export function extractApiDomain(jsContent: string): string | null {
  const match = jsContent.match(/https:\/\/[a-z]*moviedb[a-z]*\.[a-z]+\.[a-z]+/);
  return match ? match[0] : null;
}

/**
 * Extract the x-fingerprint-lite header value from the JS bundle.
 * The hexa.su frontend monkey-patches window.fetch to inject this header.
 */
export function extractFingerprint(jsContent: string): string | null {
  // Try several patterns the fingerprint value might appear in:
  // 1. "x-fingerprint-lite": "value"  or  'x-fingerprint-lite': 'value'
  // 2. "x-fingerprint-lite", "value"  (as function args)
  // 3. x-fingerprint-lite = "value"
  const patterns = [
    /x-fingerprint-lite["']?\s*[:=,]\s*["']([a-zA-Z0-9]+)["']/,
    /["']x-fingerprint-lite["']\s*,\s*["']([a-zA-Z0-9]+)["']/,
  ];

  for (const pattern of patterns) {
    const match = jsContent.match(pattern);
    if (match) return match[1];
  }

  return null;
}

/**
 * Extract the WASM loader URL from the JS bundle.
 * Pattern: img_data_bg.wasm or similar .wasm path
 */
export function extractWasmUrl(jsContent: string, baseUrl: string): string | null {
  // Match common WASM file patterns in JS bundles
  const match = jsContent.match(/["']([^"']*(?:img_data_bg|flixer|wasm)[^"']*\.wasm)["']/);
  if (!match) return null;

  const path = match[1];
  if (path.startsWith('http://') || path.startsWith('https://')) return path;

  try {
    return new URL(path, baseUrl).href;
  } catch {
    return null;
  }
}

/**
 * Extract API route patterns from the JS bundle.
 * Looks for /api/tmdb/ or /api/v\d+/tmdb/ style paths.
 */
export function extractApiRoutes(jsContent: string): Partial<ApiRoutes> | null {
  const routes: Partial<ApiRoutes> = {};
  let found = false;

  // Time endpoint: /api/time or /api/v2/time etc.
  const timeMatch = jsContent.match(/["'](\/api(?:\/v\d+)?\/time)["']/);
  if (timeMatch) {
    routes.time = timeMatch[1];
    found = true;
  }

  // Movie images: /api/tmdb/movie/{id}/images or versioned variant
  const movieMatch = jsContent.match(/["'](\/api(?:\/v\d+)?\/tmdb\/movie\/)[^"']*/);
  if (movieMatch) {
    // Reconstruct the template with placeholder
    const prefix = movieMatch[1];
    routes.movieImages = `${prefix}{tmdbId}/images`;
    found = true;
  }

  // TV images: /api/tmdb/tv/{id}/season/{s}/episode/{e}/images or versioned
  const tvMatch = jsContent.match(/["'](\/api(?:\/v\d+)?\/tmdb\/tv\/)[^"']*/);
  if (tvMatch) {
    const prefix = tvMatch[1];
    routes.tvImages = `${prefix}{tmdbId}/season/{season}/episode/{episode}/images`;
    found = true;
  }

  return found ? routes : null;
}

/**
 * Compute SHA-256 hash of binary data using Web Crypto API.
 * Returns lowercase hex string.
 */
export async function computeHash(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
}
