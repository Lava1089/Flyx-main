/**
 * PPV.to Stream Proxy
 * 
 * Routes:
 *   GET /ppv/stream?url=<encoded_url> - Proxy m3u8/ts with proper headers
 *   GET /ppv/health - Health check
 *   GET /ppv/test - Test upstream connectivity
 * 
 * PPV streams from pooembed.top require proper Referer header.
 * This proxy adds the required headers and rewrites playlist URLs.
 * 
 * Stream domains: *.poocloud.in (e.g., gg.poocloud.in)
 */

import { createLogger, type LogLevel } from './logger';

export interface Env {
  LOG_LEVEL?: string;
  // Hetzner VPS proxy (primary for PPV - not IP banned)
  HETZNER_PROXY_URL?: string;
  HETZNER_PROXY_KEY?: string;
  // RPI proxy as fallback
  RPI_PROXY_URL?: string;
  RPI_PROXY_KEY?: string;
}

const REFERER = 'https://modistreams.org/';
const ORIGIN = 'https://modistreams.org';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Valid domains for PPV streams
// poocloud.in = m3u8 playlists (needs RPI proxy due to IPv6 blocking)
// vidsaver.io = actual video segments (can be fetched directly!)
const VALID_DOMAINS = ['poocloud.in', 'modistreams.org', 'pooembed.eu', 'pooembed.top', 'dzine.ai', 'vidsaver.io', 'r2.cloudflarestorage.com'];

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Content-Type',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
  };
}

function jsonResponse(data: object, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
    },
  });
}

function isValidDomain(url: string): boolean {
  try {
    const parsed = new URL(url);
    return VALID_DOMAINS.some(domain => parsed.hostname.endsWith(domain));
  } catch {
    return false;
  }
}

async function fetchWithRetry(
  url: string, 
  headers: Record<string, string>,
  logger: ReturnType<typeof createLogger>,
  env: Env
): Promise<Response> {
  const parsedUrl = new URL(url);
  const isPoocloud = parsedUrl.hostname.endsWith('poocloud.in');
  const isModistreams = parsedUrl.hostname.endsWith('modistreams.org');
  
  // poocloud.in and modistreams.org need proxy (IPv6 blocked + IP bans)
  // vidsaver.io segments can be fetched directly
  const needsProxy = isPoocloud || isModistreams;
  
  if (needsProxy) {
    // Try Hetzner first (primary - not IP banned)
    if (env.HETZNER_PROXY_URL && env.HETZNER_PROXY_KEY) {
      const hetznerUrl = `${env.HETZNER_PROXY_URL}/ppv?url=${encodeURIComponent(url)}&key=${env.HETZNER_PROXY_KEY}`;
      logger.info('Attempting Hetzner proxy', { 
        hetznerUrl: hetznerUrl.substring(0, 100),
        baseUrl: env.HETZNER_PROXY_URL,
      });
      
      try {
        const hetznerResponse = await fetch(hetznerUrl, {
          signal: AbortSignal.timeout(15000),
        });
        
        logger.info('Hetzner response received', { 
          status: hetznerResponse.status,
          ok: hetznerResponse.ok,
        });
        
        if (hetznerResponse.ok) {
          logger.info('Hetzner proxy succeeded', { status: hetznerResponse.status });
          return hetznerResponse;
        }
        
        const errorText = await hetznerResponse.text();
        logger.warn('Hetzner proxy failed', { 
          status: hetznerResponse.status,
          error: errorText.substring(0, 200),
        });
      } catch (error) {
        logger.error('Hetzner proxy error', { 
          error: error instanceof Error ? error.message : String(error),
          hetznerUrl: hetznerUrl.substring(0, 100),
        });
      }
    } else {
      logger.warn('Hetzner not configured', {
        hasUrl: !!env.HETZNER_PROXY_URL,
        hasKey: !!env.HETZNER_PROXY_KEY,
      });
    }
    
    // Fallback to RPI proxy
    if (env.RPI_PROXY_URL && env.RPI_PROXY_KEY) {
      logger.info('Falling back to RPI proxy', { url: url.substring(0, 80) });
      
      try {
        // Strip trailing slash to avoid double-slash in URL path
        const rpiBaseUrl = env.RPI_PROXY_URL.replace(/\/+$/, '');
        const rpiUrl = `${rpiBaseUrl}/ppv?url=${encodeURIComponent(url)}`;
        const rpiResponse = await fetch(rpiUrl, {
          headers: { 'X-API-Key': env.RPI_PROXY_KEY },
          signal: AbortSignal.timeout(15000),
        });
        
        if (rpiResponse.ok) {
          logger.info('RPI proxy succeeded', { status: rpiResponse.status });
          return rpiResponse;
        }
        
        logger.warn('RPI proxy failed', { status: rpiResponse.status });
      } catch (error) {
        logger.error('RPI proxy error', error as Error);
      }
    }
  }
  
  // Direct fetch - works for vidsaver.io segments
  logger.info('Direct fetch', { url: url.substring(0, 80), needsProxy });
  
  const directResponse = await fetch(url, { headers });
  
  if (directResponse.ok) {
    logger.info('Direct fetch succeeded', { status: directResponse.status });
  } else {
    logger.warn('Direct fetch failed', { 
      status: directResponse.status,
      url: url.substring(0, 80)
    });
  }
  
  return directResponse;
}

export async function handlePPVRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/ppv/, '');
  const logLevel = (env.LOG_LEVEL || 'info') as LogLevel;
  const logger = createLogger(request, logLevel);

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  // Health check
  if (path === '/health' || path === '') {
    return jsonResponse({
      status: 'ok',
      service: 'ppv-proxy',
      timestamp: new Date().toISOString(),
      config: {
        validDomains: VALID_DOMAINS,
        hetznerProxyConfigured: !!(env.HETZNER_PROXY_URL && env.HETZNER_PROXY_KEY),
        rpiProxyConfigured: !!(env.RPI_PROXY_URL && env.RPI_PROXY_KEY),
      },
    });
  }

  // Test endpoint - verify upstream connectivity
  if (path === '/test') {
    const testUrl = 'https://gg.poocloud.in/southpark/index.m3u8';
    
    // Debug: show what we're configured with
    const debugInfo: any = {
      hetznerUrl: env.HETZNER_PROXY_URL ? env.HETZNER_PROXY_URL.substring(0, 50) + '...' : 'NOT SET',
      hetznerKeySet: !!env.HETZNER_PROXY_KEY,
      rpiUrl: env.RPI_PROXY_URL ? env.RPI_PROXY_URL.substring(0, 50) + '...' : 'NOT SET',
      rpiKeySet: !!env.RPI_PROXY_KEY,
    };
    
    // Try Hetzner
    if (env.HETZNER_PROXY_URL && env.HETZNER_PROXY_KEY) {
      const hetznerTestUrl = `${env.HETZNER_PROXY_URL}/ppv?url=${encodeURIComponent(testUrl)}&key=${env.HETZNER_PROXY_KEY}`;
      debugInfo.hetznerTestUrl = hetznerTestUrl.substring(0, 120) + '...';
      
      try {
        const hetznerRes = await fetch(hetznerTestUrl, { signal: AbortSignal.timeout(10000) });
        debugInfo.hetznerStatus = hetznerRes.status;
        debugInfo.hetznerOk = hetznerRes.ok;
        if (hetznerRes.ok) {
          const text = await hetznerRes.text();
          debugInfo.hetznerPreview = text.substring(0, 200);
        } else {
          debugInfo.hetznerError = await hetznerRes.text();
        }
      } catch (e) {
        debugInfo.hetznerError = e instanceof Error ? e.message : String(e);
      }
    }
    
    return jsonResponse(debugInfo);
  }

  // Stream proxy
  if (path === '/stream') {
    const streamUrl = url.searchParams.get('url');
    
    if (!streamUrl) {
      return jsonResponse({ error: 'URL parameter required' }, 400);
    }

    try {
      const decodedUrl = decodeURIComponent(streamUrl);
      
      // Validate domain
      if (!isValidDomain(decodedUrl)) {
        logger.warn('Invalid domain', { url: decodedUrl.substring(0, 80) });
        return jsonResponse({ 
          error: 'Invalid URL domain',
          validDomains: VALID_DOMAINS,
        }, 400);
      }
      
      logger.info('Proxying PPV stream', { url: decodedUrl.substring(0, 80) });

      const headers = {
        'User-Agent': USER_AGENT,
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': REFERER,
        'Origin': ORIGIN,
      };

      const response = await fetchWithRetry(decodedUrl, headers, logger, env);

      if (!response.ok) {
        logger.error('Upstream error', { status: response.status, url: decodedUrl.substring(0, 80) });
        
        // Try to get error details
        let errorDetails = '';
        try {
          errorDetails = await response.text();
          errorDetails = errorDetails.substring(0, 500);
        } catch {}
        
        return jsonResponse(
          { 
            error: `Upstream error: ${response.status}`,
            url: decodedUrl.substring(0, 80),
            details: errorDetails,
          },
          response.status
        );
      }

      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      
      // For m3u8 playlists, rewrite URLs to go through our proxy
      if (contentType.includes('mpegurl') || decodedUrl.endsWith('.m3u8') || decodedUrl.includes('.m3u8?')) {
        const text = await response.text();
        
        // Get base URL for relative paths
        const baseUrl = decodedUrl.substring(0, decodedUrl.lastIndexOf('/') + 1);
        
        // Rewrite URLs in the playlist
        const rewritten = text.split('\n').map((line: string) => {
          const trimmed = line.trim();
          
          // Skip empty lines
          if (trimmed === '') return line;
          
          // Handle EXT-X-KEY URI
          if (trimmed.includes('URI="')) {
            return trimmed.replace(/URI="([^"]+)"/, (_: string, uri: string) => {
              const fullUrl = uri.startsWith('http') ? uri : baseUrl + uri;
              return `URI="/ppv/stream?url=${encodeURIComponent(fullUrl)}"`;
            });
          }
          
          // Skip other comments
          if (trimmed.startsWith('#')) return line;
          
          // Rewrite segment URLs (any file extension - they use obfuscation)
          if (trimmed.startsWith('http')) {
            return `/ppv/stream?url=${encodeURIComponent(trimmed)}`;
          } else if (trimmed.length > 0 && !trimmed.startsWith('#')) {
            // Any non-comment, non-empty line is a segment URL
            const fullUrl = baseUrl + trimmed;
            return `/ppv/stream?url=${encodeURIComponent(fullUrl)}`;
          }
          
          return line;
        }).join('\n');

        return new Response(rewritten, {
          headers: {
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Cache-Control': 'no-cache',
            ...corsHeaders(),
          },
        });
      }

      // For binary content (ts segments), stream directly
      const data = await response.arrayBuffer();
      
      return new Response(data, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'no-cache',
          ...corsHeaders(),
        },
      });
    } catch (error) {
      logger.error('PPV proxy error', error as Error);
      return jsonResponse(
        { error: 'Proxy failed', details: String(error) },
        500
      );
    }
  }

  return jsonResponse({ error: 'Not found', path }, 404);
}
