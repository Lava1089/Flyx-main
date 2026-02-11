/**
 * VidSrc Proxy Handler
 * Proxies requests to v1.2embed.stream API for VidSrc extraction.
 */

import { createLogger, type LogLevel } from './logger';

export interface Env {
  LOG_LEVEL?: string;
  RPI_PROXY_URL?: string;
  RPI_PROXY_KEY?: string;
}

const EMBED_API_BASE = 'https://v1.2embed.stream';

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonResponse(data: object, status: number): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

async function fetchWithHeaders(url: string, referer?: string): Promise<Response> {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json, text/html, */*',
    'Accept-Language': 'en-US,en;q=0.9',
  };
  if (referer) headers['Referer'] = referer;
  return fetch(url, { headers });
}

async function extractFromApi(
  tmdbId: string,
  type: 'movie' | 'tv',
  season?: string,
  episode?: string
): Promise<{ success: boolean; m3u8_url?: string; source?: string; error?: string }> {
  const apiPath = type === 'tv' && season && episode
    ? `/api/m3u8/tv/${tmdbId}/${season}/${episode}`
    : `/api/m3u8/movie/${tmdbId}`;
  
  const apiUrl = `${EMBED_API_BASE}${apiPath}`;
  console.log('[VidSrc] Fetching API:', apiUrl);
  
  const response = await fetchWithHeaders(apiUrl, EMBED_API_BASE + '/');
  
  if (!response.ok) {
    return { success: false, error: `API returned ${response.status}: ${response.statusText}` };
  }
  
  const data = await response.json() as {
    success?: boolean;
    m3u8_url?: string;
    source?: string;
    error?: string;
  };
  
  if (!data.success || !data.m3u8_url) {
    return { success: false, error: data.error || 'No m3u8_url in response' };
  }
  
  return { success: true, m3u8_url: data.m3u8_url, source: data.source };
}

async function proxyStream(url: string): Promise<Response> {
  console.log('[VidSrc] Proxying stream:', url.substring(0, 80) + '...');
  
  const response = await fetchWithHeaders(url, EMBED_API_BASE + '/');
  
  if (!response.ok) {
    return new Response(`Upstream error: ${response.status}`, { 
      status: response.status, 
      headers: corsHeaders() 
    });
  }
  
  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  const body = await response.arrayBuffer();
  
  if (contentType.includes('mpegurl') || url.includes('.m3u8')) {
    let manifest = new TextDecoder().decode(body);
    
    // Rewrite absolute URLs from 2embed.stream
    manifest = manifest.replace(
      /https:\/\/v1\.2embed\.stream\/[^\s\n]+/g,
      (match) => `/vidsrc/stream?url=${encodeURIComponent(match)}`
    );
    
    // Rewrite #EXT-X-KEY URI values (encryption keys need proxying too)
    manifest = manifest.replace(
      /URI="(https?:\/\/[^"]+)"/g,
      (_match, keyUrl) => `URI="/vidsrc/stream?url=${encodeURIComponent(keyUrl)}"`
    );
    
    // Rewrite relative URLs (lines that don't start with # and aren't already proxied)
    const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
    const lines = manifest.split('\n');
    manifest = lines.map(line => {
      const trimmed = line.trim();
      // Skip empty lines, comments, and already-proxied URLs
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('/vidsrc/')) return line;
      // Skip absolute URLs that aren't from known domains
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        // Proxy any absolute URL that's a segment or key
        if (trimmed.includes('.ts') || trimmed.includes('.m3u8') || trimmed.includes('/key') || trimmed.includes('.key')) {
          return `/vidsrc/stream?url=${encodeURIComponent(trimmed)}`;
        }
        return line;
      }
      // Relative URL - resolve against base URL and proxy
      const absoluteUrl = new URL(trimmed, baseUrl).toString();
      return `/vidsrc/stream?url=${encodeURIComponent(absoluteUrl)}`;
    }).join('\n');
    
    return new Response(manifest, {
      status: 200,
      headers: { 'Content-Type': 'application/vnd.apple.mpegurl', ...corsHeaders() }
    });
  }
  
  return new Response(body, { 
    status: 200, 
    headers: { 'Content-Type': contentType, ...corsHeaders() } 
  });
}

export async function handleVidSrcRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const logLevel = (env.LOG_LEVEL || 'info') as LogLevel;
  const logger = createLogger(request, logLevel);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (path === '/vidsrc/health' || path.endsWith('/health')) {
    let apiReachable = false;
    let apiError = '';
    try {
      const testResp = await fetchWithHeaders(
        `${EMBED_API_BASE}/api/m3u8/movie/550`, 
        EMBED_API_BASE + '/'
      );
      apiReachable = testResp.ok;
      if (!testResp.ok) apiError = `${testResp.status} ${testResp.statusText}`;
    } catch (e) {
      apiError = e instanceof Error ? e.message : String(e);
    }
    return jsonResponse({ 
      status: apiReachable ? 'ok' : 'degraded', 
      apiBase: EMBED_API_BASE, 
      apiReachable, 
      apiError: apiError || undefined, 
      timestamp: new Date().toISOString() 
    }, 200);
  }

  if (path === '/vidsrc/extract' || path === '/vidsrc') {
    const tmdbId = url.searchParams.get('tmdbId');
    const type = (url.searchParams.get('type') || 'movie') as 'movie' | 'tv';
    const season = url.searchParams.get('season') || undefined;
    const episode = url.searchParams.get('episode') || undefined;

    if (!tmdbId) {
      return jsonResponse({ error: 'Missing tmdbId parameter' }, 400);
    }
    if (type === 'tv' && (!season || !episode)) {
      return jsonResponse({ error: 'Season and episode required for TV shows' }, 400);
    }

    logger.info('VidSrc extract request', { tmdbId, type, season, episode });

    try {
      const startTime = Date.now();
      const result = await extractFromApi(tmdbId, type, season, episode);
      const duration = Date.now() - startTime;

      if (result.success && result.m3u8_url) {
        const proxiedUrl = `/vidsrc/stream?url=${encodeURIComponent(result.m3u8_url)}`;
        return jsonResponse({ 
          success: true, 
          m3u8_url: result.m3u8_url, 
          proxied_url: proxiedUrl, 
          source: result.source, 
          duration_ms: duration, 
          timestamp: new Date().toISOString() 
        }, 200);
      }
      return jsonResponse({ 
        success: false, 
        error: result.error, 
        duration_ms: duration, 
        timestamp: new Date().toISOString() 
      }, 404);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('VidSrc extraction error', error as Error);
      return jsonResponse({ 
        success: false, 
        error: errorMsg, 
        timestamp: new Date().toISOString() 
      }, 500);
    }
  }

  if (path === '/vidsrc/stream') {
    const streamUrl = url.searchParams.get('url');
    if (!streamUrl) {
      return jsonResponse({ error: 'Missing url parameter' }, 400);
    }
    logger.info('VidSrc stream proxy', { url: streamUrl.substring(0, 60) + '...' });
    try {
      return await proxyStream(streamUrl);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('VidSrc stream proxy error', error as Error);
      return jsonResponse({ error: errorMsg, timestamp: new Date().toISOString() }, 500);
    }
  }

  return jsonResponse({ 
    error: 'Unknown VidSrc route', 
    availableRoutes: ['/vidsrc/extract', '/vidsrc/stream', '/vidsrc/health'] 
  }, 404);
}
