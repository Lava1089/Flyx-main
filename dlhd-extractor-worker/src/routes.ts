import { Router } from './router';
import { Env, ChannelListResponse, ChannelDetails, ErrorResponse, TimingInfo, StreamResponse } from './types';
import { discoverChannels, buildChannelListResponse, ParseError } from './discovery';
import { fetchChannelPage, detectPlayers, PlayerDetectionError } from './players';
import { 
  extractFromPlayerId, 
  extractBestStream, 
  buildErrorMessage,
  aggregateErrors,
  StreamExtractionError 
} from './extraction';
import { 
  encodeProxyUrl, 
  handleProxyRequest, 
  ProxyError,
  addProxyCorsHeaders,
  decodeBase64Url
} from './proxy';
import { extractFast, getServerForChannel, getServersForChannel, extractWithFallback, getCacheStats, generateJWT, getAllServers, getAllDomains, channelExists, lookupServer, getServersForChannelDynamic, getLookupCacheStats } from './direct/fast-extractor';
import { getProxyConfig, setProxyConfig } from './discovery/fetcher';
import { fetchKeyWithAuth, extractChannelFromKeyUrl } from './direct/key-fetcher';
import { DLHDAuthDataV5 } from './direct/dlhd-auth-v5';
import { hasMoveonjoyChannel, fetchMoveonjoyPlaylist } from './direct/moveonjoy';
import { hasPlayer6Channel, fetchPlayer6Playlist } from './direct/player6';
import { fetchKeyViaSocks5, getProxyStats } from './direct/socks5-proxy';
import { 
  validateOrigin, 
  validateApiKey, 
  validateChannelId,
  validateProxyUrl,
  checkRateLimit,
  createSecurityErrorResponse 
} from './middleware/security';

// In-memory cache for decryption keys (faster than KV, no binding needed)
// Keys expire after 5 minutes
const keyCache = new Map<string, { data: Uint8Array; expires: number }>();

// In-memory cache for auth data (avoids re-fetching from www.ksohls.ru on every key request)
// Auth tokens are valid for ~24 hours, we cache for 5 minutes
const AUTH_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const authCache = new Map<string, { authToken: string; channelSalt: string; expires: number }>();

function getCachedAuth(channel: string): { authToken: string; channelSalt: string } | null {
  const cached = authCache.get(channel);
  if (cached && cached.expires > Date.now()) {
    return { authToken: cached.authToken, channelSalt: cached.channelSalt };
  }
  if (cached) authCache.delete(channel);
  return null;
}

function setCachedAuth(channel: string, authToken: string, channelSalt: string): void {
  authCache.set(channel, { authToken, channelSalt, expires: Date.now() + AUTH_CACHE_TTL_MS });
  // Evict old entries if cache grows too large
  if (authCache.size > 200) {
    const now = Date.now();
    for (const [key, value] of authCache.entries()) {
      if (value.expires < now) authCache.delete(key);
    }
  }
}

// Helper to clean expired keys (called on-demand, not with setInterval)
function cleanExpiredKeys() {
  const now = Date.now();
  for (const [key, value] of keyCache.entries()) {
    if (value.expires < now) {
      keyCache.delete(key);
    }
  }
}

/**
 * Rewrite M3U8 content for the /play endpoint
 * 
 * UPDATED February 2026: Everything fetched directly from CF (no RPI proxy!)
 * - Keys fetched with V5 EPlayerAuth
 * - M3U8 and segments fetched directly
 * - Just proxy URLs through the worker for CORS
 */
async function rewriteM3u8ForPlayEndpoint(
  m3u8Content: string,
  baseUrl: string,
  workerBaseUrl: string,
  jwtToken: string,
  channelSalt?: string
): Promise<string> {
  const lines = m3u8Content.split('\n');
  const rewrittenLines: string[] = [];
  
  // Extract base path from M3U8 URL (e.g., https://chevy.adsfadfds.cfd/proxy/zeko/premium51/)
  const basePath = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);
  
  // NOTE: We no longer extract IV from segment headers - the M3U8's IV is correct
  // The old 32-byte header format is no longer used by the new CDN
  
  // Rewrite URLs - proxy key and segments through worker
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Rewrite EXT-X-KEY line - proxy the key URL but keep the original IV
    if (trimmed.startsWith('#EXT-X-KEY') && trimmed.includes('URI="')) {
      // Extract key URL
      const uriMatch = trimmed.match(/URI="([^"]+)"/);
      if (uriMatch) {
        const uri = uriMatch[1];
        const keyUrl = uri.startsWith('http') ? uri : basePath + uri;
        
        // Build proxied key URL through CF Worker's /dlhdprivate
        const proxiedKeyUrl = new URL('/dlhdprivate', workerBaseUrl);
        proxiedKeyUrl.searchParams.set('url', keyUrl);
        proxiedKeyUrl.searchParams.set('jwt', jwtToken);
        // CRITICAL: Pass channelSalt to avoid re-fetching auth for every key request
        if (channelSalt) {
          proxiedKeyUrl.searchParams.set('salt', channelSalt);
        }
        
        // Replace only the URI, keep the original IV from the M3U8
        const newLine = trimmed.replace(/URI="[^"]+"/, `URI="${proxiedKeyUrl.toString()}"`);
        console.log(`[rewriteM3u8] Proxied key URL, keeping original IV from M3U8`);
        
        rewrittenLines.push(newLine);
        continue;
      }
    }
    
    // Skip empty lines
    if (trimmed === '') {
      rewrittenLines.push(line);
      continue;
    }
    
    // Keep other comments as-is
    if (trimmed.startsWith('#')) {
      rewrittenLines.push(line);
      continue;
    }
    
    // This is a segment URL - rewrite it
    let segmentUrl = trimmed;
    
    // Make absolute if relative
    if (!segmentUrl.startsWith('http')) {
      segmentUrl = basePath + segmentUrl;
    }
    
    // Build proxied URL through CF Worker's /dlhdprivate
    // NOTE: No longer stripping 32-byte header - segments are standard AES-128 now
    const proxiedUrl = new URL('/dlhdprivate', workerBaseUrl);
    proxiedUrl.searchParams.set('url', segmentUrl);
    proxiedUrl.searchParams.set('jwt', jwtToken);
    // Don't add strip=1 - segments don't have headers anymore
    
    rewrittenLines.push(proxiedUrl.toString());
  }
  
  return rewrittenLines.join('\n');
}

/**
 * Create all routes for the Worker
 */
export function createRoutes(router: Router): void {
  // Health check endpoint (public)
  router.get('/health', async (request, env, params) => {
    return new Response(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  // Backend listing endpoint - returns available backends for a channel
  // Tests each backend to see which are actually working before returning
  // 
  // SECURITY: Requires API key OR valid origin to prevent infrastructure enumeration
  // 
  // Query params:
  //   ?test=true - Actually test each backend (slower but accurate)
  //   ?test=false or omitted - Return all backends without testing (fast)
  router.get('/backends/:channelId', async (request, env, params) => {
    const channelId = params.channelId;
    const chNum = parseInt(channelId, 10);
    const url = new URL(request.url);
    const shouldTest = url.searchParams.get('test') !== 'false'; // Default to testing
    
    // SECURITY: Validate origin OR API key to prevent infrastructure enumeration
    const origin = request.headers.get('origin');
    const referer = request.headers.get('referer');
    
    // Check API key first (allows VLC/media players)
    const apiKeyResult = validateApiKey(request, env);
    
    // If no valid API key, check origin
    if (!apiKeyResult.valid) {
      const validatedOrigin = validateOrigin(request, env);
      if (!validatedOrigin) {
        return createSecurityErrorResponse(
          'Authentication required - provide API key or access from allowed origin',
          'UNAUTHORIZED',
          401,
          '*'
        );
      }
    }
    
    // Determine CORS origin for response
    const corsOrigin = apiKeyResult.valid ? '*' : (validateOrigin(request, env) || '*');
    
    if (isNaN(chNum) || chNum < 1 || chNum > 1000) {
      return new Response(JSON.stringify({ 
        error: 'Invalid channel ID',
        hint: 'Channel ID must be between 1 and 1000'
      }), { 
        status: 400, 
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': corsOrigin } 
      });
    }
    
    // Get RPI proxy config for testing
    const rpiProxyUrl = env.RPI_PROXY_URL;
    const rpiApiKey = env.RPI_PROXY_API_KEY;
    
    // Get the primary server for this channel (dynamic lookup)
    const primaryServer = await lookupServer(chNum) || getServerForChannel(chNum);
    const servers = await getServersForChannelDynamic(chNum);
    const channelKey = `premium${channelId}`;
    
    // Only test adsfadfds.cfd domain (new proxy domain as of Feb 25, 2026)
    const domain = 'adsfadfds.cfd';
    
    // SECURITY: Generate obfuscated backend IDs to prevent infrastructure enumeration
    // The actual server.domain is only used internally - clients get opaque IDs
    const obfuscateBackendId = (server: string, domain: string, index: number): string => {
      // Use a simple index-based ID that doesn't reveal server names
      // Format: "backend-{index}" - the /play endpoint will decode this
      return `backend-${index}`;
    };
    
    // Build list of backends to test
    const backendsToTest: Array<{
      id: string;
      internalId: string; // Actual server.domain for internal use only
      server: string;
      domain: string;
      isPrimary: boolean;
      index: number;
    }> = [];
    
    let backendIndex = 0;
    
    // Add primary server first
    if (primaryServer) {
      backendsToTest.push({
        id: obfuscateBackendId(primaryServer, domain, backendIndex),
        internalId: `${primaryServer}.${domain}`,
        server: primaryServer,
        domain,
        isPrimary: true,
        index: backendIndex++,
      });
    }
    
    // Add fallback servers
    for (const server of servers) {
      if (server !== primaryServer) {
        backendsToTest.push({
          id: obfuscateBackendId(server, domain, backendIndex),
          internalId: `${server}.${domain}`,
          server,
          domain,
          isPrimary: false,
          index: backendIndex++,
        });
      }
    }
    
    // If not testing, return all backends immediately
    if (!shouldTest || !rpiProxyUrl || !rpiApiKey) {
      const backends = backendsToTest.map((b, idx) => ({
        id: b.id,
        server: b.server,
        domain: b.domain,
        isPrimary: b.isPrimary,
        label: `${b.server.toUpperCase()} (${b.domain})${b.isPrimary ? ' - Primary' : ''}`,
        status: 'unknown' as const,
      }));
      
      return new Response(JSON.stringify({
        success: true,
        channelId,
        primaryServer,
        backends,
        tested: false,
        note: 'Backends not tested. Add ?test=true to test availability.',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': corsOrigin },
      });
    }
    
    // Test each backend in parallel with a timeout
    const testBackend = async (backend: typeof backendsToTest[0]): Promise<{
      id: string;
      server: string;
      domain: string;
      isPrimary: boolean;
      label: string;
      status: 'online' | 'offline' | 'timeout';
      responseTime?: number;
    }> => {
      const m3u8Url = `https://chevy.${backend.domain}/proxy/${backend.server}/${channelKey}/mono.css`;
      const startTime = Date.now();
      
      try {
        // Test via RPI proxy with 5s timeout
        const rpiUrl = new URL('/dlhdprivate', rpiProxyUrl);
        rpiUrl.searchParams.set('url', m3u8Url);
        rpiUrl.searchParams.set('headers', JSON.stringify({
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': '*/*',
          'Referer': 'https://www.ksohls.ru/',
          'Origin': 'https://www.ksohls.ru',
        }));
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const response = await fetch(rpiUrl.toString(), {
          headers: { 'X-API-Key': rpiApiKey },
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        const responseTime = Date.now() - startTime;
        
        if (response.ok) {
          const text = await response.text();
          const isValid = text.includes('#EXTM3U') || text.includes('#EXT-X-');
          
          return {
            id: backend.id,
            server: backend.server,
            domain: backend.domain,
            isPrimary: backend.isPrimary,
            label: `${backend.server.toUpperCase()} (${responseTime}ms)${backend.isPrimary ? ' - Primary' : ''}`,
            status: isValid ? 'online' : 'offline',
            responseTime,
          };
        }
        
        return {
          id: backend.id,
          server: backend.server,
          domain: backend.domain,
          isPrimary: backend.isPrimary,
          label: `${backend.server.toUpperCase()} - Offline`,
          status: 'offline',
          responseTime: Date.now() - startTime,
        };
      } catch (e) {
        return {
          id: backend.id,
          server: backend.server,
          domain: backend.domain,
          isPrimary: backend.isPrimary,
          label: `${backend.server.toUpperCase()} - Timeout`,
          status: 'timeout',
          responseTime: Date.now() - startTime,
        };
      }
    };
    
    // Test all backends in parallel
    const results = await Promise.all(backendsToTest.map(testBackend));
    
    // Filter to only online backends, keep primary first
    const onlineBackends = results
      .filter(b => b.status === 'online')
      .sort((a, b) => {
        // Primary first, then by response time
        if (a.isPrimary && !b.isPrimary) return -1;
        if (!a.isPrimary && b.isPrimary) return 1;
        return (a.responseTime || 9999) - (b.responseTime || 9999);
      });
    
    // If no backends are online, return all with their status
    const backends = onlineBackends.length > 0 ? onlineBackends : results;
    
    return new Response(JSON.stringify({
      success: true,
      channelId,
      primaryServer,
      backends,
      tested: true,
      onlineCount: onlineBackends.length,
      totalCount: results.length,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': corsOrigin },
    });
  });

  // Debug endpoint to check proxy config (protected)
  router.get('/debug/proxy', async (request, env, params) => {
    const proxyConfig = getProxyConfig();
    
    // Also test shouldUseRpiProxy
    const testUrl = 'https://chevy.soyspace.cyou/test';
    const RPI_PROXY_DOMAINS = [
      'dlhd.link', 'dlhd.sx', 'daddylive.mp', 'soyspace.cyou', 'adsfadfds.cfd',
      'topembed.pw', 'www.ksohls.ru', 'dvalna.ru',
    ];
    const hostname = new URL(testUrl).hostname;
    const shouldProxy = RPI_PROXY_DOMAINS.some(domain => 
      hostname === domain || hostname.endsWith('.' + domain)
    );
    
    return new Response(JSON.stringify({
      proxyUrl: proxyConfig.url || 'NOT SET',
      proxyApiKey: proxyConfig.apiKey ? 'SET (hidden)' : 'NOT SET',
      envProxyUrl: env.RPI_PROXY_URL || 'NOT SET',
      envProxyApiKey: env.RPI_PROXY_API_KEY ? 'SET (hidden)' : 'NOT SET',
      testUrl,
      testHostname: hostname,
      shouldUseProxy: shouldProxy,
      useProxy: !!(proxyConfig.url && proxyConfig.apiKey && shouldProxy),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  // Debug endpoint: SOCKS5 proxy health stats
  // Usage: /debug/proxies?key=vynx
  router.get('/debug/proxies', async (request, env, params) => {
    const apiKeyResult = validateApiKey(request, env);
    if (!apiKeyResult.valid) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify(getProxyStats(), null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  });

  // Debug endpoint: test SOCKS5 proxy key fetch directly
  // Usage: /debug/socks5test?key=vynx
  router.get('/debug/socks5test', async (request, env, params) => {
    const apiKeyResult = validateApiKey(request, env);
    if (!apiKeyResult.valid) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    const results: Record<string, unknown> = { timestamp: new Date().toISOString(), tests: [] as unknown[] };

    // Get auth data
    const { fetchAuthData, generateKeyHeaders: genHeaders } = await import('./direct/dlhd-auth-v5');
    const authData = await fetchAuthData('44');
    if (!authData) {
      results.error = 'Failed to get auth data';
      return new Response(JSON.stringify(results, null, 2), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }
    results.auth = { salt: authData.channelSalt.substring(0, 16) + '...' };

    // Generate key headers
    const resource = 'premium44';
    const keyNumber = '5901637';
    const keyHeaders = await genHeaders(resource, keyNumber, {
      authToken: authData.authToken,
      channelKey: resource,
      country: 'US',
      timestamp: Math.floor(Date.now() / 1000),
      channelSalt: authData.channelSalt,
      source: 'socks5-test',
    });

    const keyUrl = `https://chevy.soyspace.cyou/key/${resource}/${keyNumber}`;
    results.keyUrl = keyUrl;

    // Test 1: Direct fetch (should get fake key)
    try {
      const directResp = await fetch(keyUrl, { headers: keyHeaders });
      const directBody = await directResp.arrayBuffer();
      const directHex = directBody.byteLength === 16 
        ? Array.from(new Uint8Array(directBody)).map(b => b.toString(16).padStart(2, '0')).join('')
        : `${directBody.byteLength}b`;
      (results.tests as unknown[]).push({ method: 'cf-direct', status: directResp.status, key: directHex });
    } catch (e) {
      (results.tests as unknown[]).push({ method: 'cf-direct', error: String(e) });
    }

    // Test 2: SOCKS5 proxy fetch (with error capture)
    // First try raw fetchViaSocks5 to see the actual error
    const { fetchViaSocks5 } = await import('./direct/socks5-proxy');
    try {
      const rawResult = await fetchViaSocks5(keyUrl, keyHeaders);
      const hex = rawResult.body.length === 16
        ? Array.from(rawResult.body).map(b => b.toString(16).padStart(2, '0')).join('')
        : `${rawResult.body.length}b`;
      (results.tests as unknown[]).push({ method: 'socks5-raw', status: rawResult.status, key: hex, proxy: rawResult.proxy });
    } catch (e) {
      (results.tests as unknown[]).push({ method: 'socks5-raw', error: String(e), stack: (e as Error).stack?.substring(0, 300) });
    }

    // Then try fetchKeyViaSocks5 (with validation)
    try {
      const socks5Result = await fetchKeyViaSocks5(keyUrl, keyHeaders, 1);
      if (socks5Result) {
        const hex = socks5Result.body.length === 16
          ? Array.from(socks5Result.body).map(b => b.toString(16).padStart(2, '0')).join('')
          : `${socks5Result.body.length}b`;
        (results.tests as unknown[]).push({ method: 'socks5-validated', status: socks5Result.status, key: hex, proxy: socks5Result.proxy });
      } else {
        (results.tests as unknown[]).push({ method: 'socks5-validated', result: 'null (all retries failed)' });
      }
    } catch (e) {
      (results.tests as unknown[]).push({ method: 'socks5-validated', error: String(e) });
    }

    results.proxyStats = getProxyStats();

    return new Response(JSON.stringify(results, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  });

  // Debug endpoint: test key fetching directly from CF Worker
  // Shows exactly what happens when CF tries to fetch a DLHD key
  // Usage: /debug/keytest?ch=44&key=vynx
  router.get('/debug/keytest', async (request, env, params) => {
    const url = new URL(request.url);
    const apiKeyResult = validateApiKey(request, env);
    if (!apiKeyResult.valid) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    const channel = url.searchParams.get('ch') || '44';
    const results: Record<string, unknown> = { channel, timestamp: new Date().toISOString(), tests: [] as unknown[] };

    // Step 1: Fetch auth data from www.ksohls.ru
    const { fetchAuthData, generateKeyHeaders: genHeaders } = await import('./direct/dlhd-auth-v5');
    const authData = await fetchAuthData(channel);
    if (!authData) {
      results.authError = 'Failed to fetch auth data from player page';
      return new Response(JSON.stringify(results, null, 2), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }
    results.auth = { token: authData.authToken.substring(0, 40) + '...', salt: authData.channelSalt.substring(0, 16) + '...' };

    // Step 2: Generate JWT and fetch M3U8 to get a REAL key URL
    const { generateJWT } = await import('./direct/fast-extractor');
    const { token: jwtToken, channelKey } = await generateJWT(channel);
    
    const servers = ['zeko', 'chevy', 'nfs', 'ddy6'];
    const domain = 'adsfadfds.cfd';
    let realKeyUrl: string | null = null;
    let workingServer: string | null = null;
    
    for (const server of servers) {
      const m3u8Url = `https://chevy.${domain}/proxy/${server}/${channelKey}/mono.css`;
      try {
        const m3u8Resp = await fetch(m3u8Url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://www.ksohls.ru/',
            'Origin': 'https://www.ksohls.ru',
            'Authorization': `Bearer ${jwtToken}`,
          },
        });
        if (m3u8Resp.ok) {
          const text = await m3u8Resp.text();
          if (text.includes('#EXTM3U')) {
            // Extract key URL from M3U8
            const keyMatch = text.match(/URI="([^"]+)"/);
            if (keyMatch) {
              const keyUri = keyMatch[1];
              const basePath = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);
              realKeyUrl = keyUri.startsWith('http') ? keyUri : basePath + keyUri;
              workingServer = server;
              results.m3u8 = { server, url: m3u8Url, keyUrl: realKeyUrl };
              break;
            }
          }
        }
      } catch (e) { /* skip */ }
    }
    
    if (!realKeyUrl) {
      results.error = 'Could not fetch M3U8 from any server to get real key URL';
      return new Response(JSON.stringify(results, null, 2), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }

    // Step 3: Parse the real key URL
    const keyParsed = realKeyUrl.match(/\/key\/([^/]+)\/(\d+)/);
    if (!keyParsed) {
      results.error = `Could not parse key URL: ${realKeyUrl}`;
      return new Response(JSON.stringify(results, null, 2), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }
    const resource = keyParsed[1];
    const keyNumber = keyParsed[2];
    results.keyInfo = { resource, keyNumber, fullUrl: realKeyUrl };

    // Step 4: Try fetching the key directly from CF
    // Also try the key URL on different servers to test IPv4 vs IPv6 behavior
    const keyServers = [workingServer!, ...servers.filter(s => s !== workingServer)];
    
    for (const server of keyServers) {
      // Build key URL for this server (key URLs now come from chevy.soyspace.cyou)
      const serverKeyUrl = realKeyUrl!.replace(/https:\/\/[^/]+/, `https://chevy.soyspace.cyou`);
      // Also try the original key URL hostname
      const origHostKeyUrl = realKeyUrl!.replace(/https:\/\/[^/]+/, `https://chevy.${domain}`);
      
      for (const testUrl of [serverKeyUrl, origHostKeyUrl]) {
        const testResult: Record<string, unknown> = { keyUrl: testUrl };

        try {
          const headers = await genHeaders(resource, keyNumber, {
            authToken: authData.authToken,
            channelKey: resource,
            country: 'US',
            timestamp: Math.floor(Date.now() / 1000),
            channelSalt: authData.channelSalt,
            source: 'debug-keytest',
          });

          const start = Date.now();
          const resp = await fetch(testUrl, { headers });
          testResult.elapsed = Date.now() - start;
          testResult.status = resp.status;
          testResult.cfRay = resp.headers.get('cf-ray');

          const body = await resp.arrayBuffer();
          testResult.bodySize = body.byteLength;

          if (body.byteLength === 16) {
            const hex = Array.from(new Uint8Array(body)).map(b => b.toString(16).padStart(2, '0')).join('');
            testResult.keyHex = hex;
            testResult.isFake = hex.startsWith('455806f8') || hex.startsWith('45c6497');
            testResult.isError = hex.startsWith('6572726f72');
            testResult.valid = !testResult.isFake && !testResult.isError;
          } else if (body.byteLength > 0 && body.byteLength < 1000) {
            testResult.bodyText = new TextDecoder().decode(body).substring(0, 200);
          } else {
            testResult.note = `Response body: ${body.byteLength} bytes`;
          }
        } catch (e) {
          testResult.error = String(e);
        }

        (results.tests as unknown[]).push(testResult);
        
        // If we got a valid key, no need to test more URLs
        if ((testResult as any).valid) break;
      }
      if ((results.tests as unknown[]).some((t: any) => t.valid)) break;
    }

    return new Response(JSON.stringify(results, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  });

  // VLC-compatible play endpoint - generates JWT locally and fetches M3U8 via RPI
  // CF Worker handles ALL smart logic: JWT generation, server mapping, URL rewriting
  // RPI just acts as a dumb passthrough from residential IP
  // Usage: vlc "https://dlhd.vynx.workers.dev/play/51?key=vynx"
  // 
  // CRITICAL FIX: This endpoint now properly handles playlist refresh requests.
  // HLS players refetch the M3U8 every few seconds to get updated segments.
  // We MUST fetch the latest playlist from upstream on each request.
  router.get('/play/:channelId', async (request, env, params) => {
    const startTime = Date.now();
    const channelId = params.channelId;
    const url = new URL(request.url);
    
    // SECURITY: Validate origin - simplified for performance
    // For /play endpoint, we prioritize speed over strict origin checking
    // API key validation is the primary security mechanism
    const allowedOrigin = '*'; // Allow all origins for VLC/media player compatibility
    
    // SECURITY: Validate API key
    const apiKeyStart = Date.now();
    const apiKeyResult = validateApiKey(request, env);
    console.log(`[/play] API key validation: ${Date.now() - apiKeyStart}ms`);
    if (!apiKeyResult.valid) {
      return createSecurityErrorResponse(
        apiKeyResult.error!,
        'UNAUTHORIZED',
        401,
        allowedOrigin
      );
    }
    
    // SECURITY: Validate channel ID format
    const channelValidation = validateChannelId(channelId);
    if (!channelValidation.valid) {
      return createSecurityErrorResponse(
        channelValidation.error!,
        'INVALID_INPUT',
        400,
        allowedOrigin
      );
    }
    
    // SECURITY: Rate limiting - DISABLED for /play endpoint to improve performance
    // The /play endpoint is called every few seconds for playlist refresh
    // KV-based rate limiting adds 200-1000ms latency which kills live streaming
    // Instead, rely on API key validation and origin checks
    // TODO: Implement in-memory rate limiting if abuse becomes an issue
    
    try {
      // Step 1: Check for forced backend from query param
      const forcedBackend = url.searchParams.get('backend');
      let servers: string[];
      let domains: readonly string[];
      
      if (forcedBackend) {
        // Parse backend format: "server.domain" (e.g., "ddy6.adsfadfds.cfd")
        // Split only on the first dot to handle domains like "adsfadfds.cfd"
        const dotIndex = forcedBackend.indexOf('.');
        if (dotIndex === -1) {
          return new Response(JSON.stringify({ 
            error: 'Invalid backend format',
            hint: 'Use format: server.domain (e.g., ddy6.adsfadfds.cfd)',
            example: '/play/51?backend=zeko.adsfadfds.cfd'
          }), { 
            status: 400, 
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } 
          });
        }
        const server = forcedBackend.substring(0, dotIndex);
        const domain = forcedBackend.substring(dotIndex + 1);
        if (!server || !domain) {
          return new Response(JSON.stringify({ 
            error: 'Invalid backend format',
            hint: 'Use format: server.domain (e.g., ddy6.adsfadfds.cfd)',
            example: '/play/51?backend=zeko.adsfadfds.cfd'
          }), { 
            status: 400, 
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } 
          });
        }
        // Only try the forced backend
        servers = [server];
        domains = [domain] as readonly string[];
        console.log(`[/play] Forced backend: ${server}.${domain}`);
      } else {
        // Get server list for channel (dynamic lookup + fallbacks)
        const chNum = parseInt(channelId, 10);
        servers = await getServersForChannelDynamic(chNum);
        domains = getAllDomains();
      }
      
      if (servers.length === 0) {
        return new Response(JSON.stringify({ 
          error: `Channel ${channelId} not found in server map`,
          hint: 'Channel may not be supported'
        }), { 
          status: 404, 
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } 
        });
      }
      
      // Step 2: Generate JWT locally (instant - ~1ms)
      // CRITICAL: Generate a fresh JWT on EVERY request to ensure it's always valid
      const jwtStart = Date.now();
      const { token, channelKey, channelSalt } = await generateJWT(channelId);
      console.log(`[/play] JWT generation: ${Date.now() - jwtStart}ms`);
      console.log(`[/play] Generated JWT for channel ${channelId}: ${token.substring(0, 50)}...`);
      if (channelSalt) {
        console.log(`[/play] Got channelSalt: ${channelSalt.substring(0, 16)}...`);
        // Cache auth data so /dlhdprivate key requests can reuse it
        setCachedAuth(channelId, token, channelSalt);
      }
      
      // Compute workerBaseUrl once for proxy URL rewriting
      const workerBaseUrl = `${url.protocol}//${url.host}`;
      
      // Step 3: Try new proxy M3U8 FIRST (primary backend since Feb 25, 2026)
      // Priority order: chevy.adsfadfds.cfd/proxy → lovecdn (Player 6) → moveonjoy (easiest)
      let m3u8Content: string | null = null;
      let workingServer: string | null = null;
      let workingDomain: string | null = null;
      let lastError: string | null = null;
      
      // Build headers for M3U8 request
      const m3u8Headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Referer': 'https://www.ksohls.ru/',
        'Origin': 'https://www.ksohls.ru',
        'Authorization': `Bearer ${token}`,
      };
      
      // Try each server/domain combination - fetch M3U8 DIRECTLY (no RPI needed!)
      for (const server of servers) {
        if (m3u8Content) break; // Found a working server
        
        for (const domain of domains) {
          // NEW URL pattern: https://chevy.{domain}/proxy/{server}/premium{ch}/mono.css
          const m3u8Url = `https://chevy.${domain}/proxy/${server}/${channelKey}/mono.css`;
          console.log(`[/play] Trying server ${server}.${domain}: ${m3u8Url}`);
          
          try {
            // Fetch M3U8 directly - no RPI proxy needed!
            const response = await fetch(m3u8Url, {
              headers: m3u8Headers,
            });
            
            if (response.ok) {
              const content = await response.text();
              // Verify it's a valid M3U8
              if (content.includes('#EXTM3U') || content.includes('#EXT-X-')) {
                m3u8Content = content;
                workingServer = server;
                workingDomain = domain;
                console.log(`[/play] SUCCESS: Server ${server}.${domain} works for channel ${channelId}`);
                break;
              } else {
                lastError = `Server ${server}.${domain} returned invalid M3U8`;
                console.log(`[/play] ${lastError}`);
              }
            } else {
              lastError = `Server ${server}.${domain} returned ${response.status}`;
              console.log(`[/play] ${lastError}`);
            }
          } catch (e) {
            lastError = `Server ${server}.${domain} error: ${e}`;
            console.log(`[/play] ${lastError}`);
          }
        }
      }
      
      // If no server worked, return error
      // SECURITY: Don't expose server/domain counts in error response
      // If no proxy M3U8 server worked, try lovecdn (Player 6) then moveonjoy as fallbacks
      if (!m3u8Content || !workingServer || !workingDomain) {
        console.log(`[/play] All proxy M3U8 servers failed, trying fallback backends...`);
        
        // Fallback 1: Try Player 6 / lovecdn (second priority — no encryption, 142 channels)
        if (!forcedBackend && hasPlayer6Channel(channelId)) {
          console.log(`[/play] Trying player 6 (lovecdn) fallback for ch${channelId}...`);
          try {
            const p6Result = await fetchPlayer6Playlist(channelId, workerBaseUrl, token);
            if (p6Result) {
              const totalTime = Date.now() - startTime;
              console.log(`[/play] ✅ Player 6 fallback SUCCESS for ch${channelId} (${p6Result.streamName}) in ${totalTime}ms`);
              return new Response(p6Result.content, {
                status: 200,
                headers: {
                  'Content-Type': 'application/vnd.apple.mpegurl',
                  'Access-Control-Allow-Origin': '*',
                  'Cache-Control': 'no-cache, no-store, must-revalidate',
                  'Pragma': 'no-cache',
                  'Expires': '0',
                  'X-DLHD-Channel': channelId,
                  'X-DLHD-Server': 'player6-lovecdn',
                  'X-DLHD-Backend': 'player6-fallback',
                },
              });
            }
            console.log(`[/play] Player 6 offline for ch${channelId}, trying moveonjoy...`);
          } catch (e) {
            console.log(`[/play] Player 6 fallback error: ${e}, trying moveonjoy...`);
          }
        }
        
        // Fallback 2: Try moveonjoy (third priority — easiest security, ~50 US channels)
        if (!forcedBackend && hasMoveonjoyChannel(channelId)) {
          console.log(`[/play] Trying moveonjoy fallback for ch${channelId}...`);
          try {
            const movResult = await fetchMoveonjoyPlaylist(channelId, workerBaseUrl, token);
            if (movResult) {
              const totalTime = Date.now() - startTime;
              console.log(`[/play] ✅ Moveonjoy fallback SUCCESS for ch${channelId} (${movResult.channelName}) in ${totalTime}ms`);
              return new Response(movResult.content, {
                status: 200,
                headers: {
                  'Content-Type': 'application/vnd.apple.mpegurl',
                  'Access-Control-Allow-Origin': '*',
                  'Cache-Control': 'no-cache, no-store, must-revalidate',
                  'Pragma': 'no-cache',
                  'Expires': '0',
                  'X-DLHD-Channel': channelId,
                  'X-DLHD-Server': 'moveonjoy',
                  'X-DLHD-Backend': 'moveonjoy-fallback',
                },
              });
            }
          } catch (e) {
            console.log(`[/play] Moveonjoy fallback error: ${e}`);
          }
        }
        
        // If forced backend was set, also try player6 and moveonjoy
        if (forcedBackend) {
          if (hasPlayer6Channel(channelId)) {
            try {
              const p6Result = await fetchPlayer6Playlist(channelId, workerBaseUrl, token);
              if (p6Result) {
                const totalTime = Date.now() - startTime;
                console.log(`[/play] ✅ Player 6 forced-fallback SUCCESS for ch${channelId} in ${totalTime}ms`);
                return new Response(p6Result.content, {
                  status: 200,
                  headers: {
                    'Content-Type': 'application/vnd.apple.mpegurl',
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0',
                    'X-DLHD-Channel': channelId,
                    'X-DLHD-Server': 'player6-lovecdn',
                    'X-DLHD-Backend': 'player6-forced-fallback',
                  },
                });
              }
            } catch (e) {
              console.log(`[/play] Player 6 forced-fallback failed: ${e}`);
            }
          }
          if (hasMoveonjoyChannel(channelId)) {
            try {
              const movResult = await fetchMoveonjoyPlaylist(channelId, workerBaseUrl, token);
              if (movResult) {
                const totalTime = Date.now() - startTime;
                console.log(`[/play] ✅ Moveonjoy forced-fallback SUCCESS for ch${channelId} in ${totalTime}ms`);
                return new Response(movResult.content, {
                  status: 200,
                  headers: {
                    'Content-Type': 'application/vnd.apple.mpegurl',
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0',
                    'X-DLHD-Channel': channelId,
                    'X-DLHD-Server': 'moveonjoy',
                    'X-DLHD-Backend': 'moveonjoy-forced-fallback',
                  },
                });
              }
            } catch (e) {
              console.log(`[/play] Moveonjoy forced-fallback failed: ${e}`);
            }
          }
        }
        
        return new Response(JSON.stringify({ 
          error: 'Stream temporarily unavailable',
          code: 'STREAM_UNAVAILABLE',
          hint: 'Channel may be offline or experiencing issues. Try again later.',
        }), { 
          status: 502, 
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          } 
        });
      }
      
      // Step 4: Rewrite M3U8 URLs to go through CF Worker's /dlhdprivate
      const rewriteStart = Date.now();
      // Use the actual URL pattern that was fetched (chevy.{domain}/proxy/{server}/...)
      const m3u8Url = `https://chevy.${workingDomain}/proxy/${workingServer}/${channelKey}/mono.css`;
      
      // Rewrite the M3U8 content with the current JWT and channelSalt
      const rewrittenM3u8 = await rewriteM3u8ForPlayEndpoint(
        m3u8Content, 
        m3u8Url, 
        workerBaseUrl, 
        token,
        channelSalt // Pass channelSalt to avoid re-fetching auth for key requests
      );
      const rewriteTime = Date.now() - rewriteStart;
      const totalTime = Date.now() - startTime;
      
      console.log(`[/play] M3U8 rewrite: ${rewriteTime}ms, total: ${totalTime}ms, server: ${workingServer}.${workingDomain}`);
      
      return new Response(rewrittenM3u8, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Access-Control-Allow-Origin': '*',
          // CRITICAL: Set Cache-Control to no-cache to ensure players refetch the playlist
          // This allows them to get updated segments for live streams
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
          'X-DLHD-Channel': channelId,
          'X-DLHD-Server': `${workingServer}.${workingDomain}`,
        },
      });
    } catch (error) {
      console.error(`[/play] Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return new Response(JSON.stringify({ 
        error: 'Failed to fetch stream',
        details: error instanceof Error ? error.message : 'Unknown error',
      }), { 
        status: 502, 
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        } 
      });
    }
  });

  // DLHD Private proxy endpoint - fetches EVERYTHING directly (no RPI needed!)
  // Keys, M3U8, and segments all work directly from CF
  // 
  // SECURITY: This endpoint requires either:
  // 1. A valid JWT token (from /play endpoint rewritten URLs)
  // 2. A valid API key (for direct access)
  // 3. A valid referer from our own worker (internal calls)
  router.get('/dlhdprivate', async (request, env, params) => {
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');
    const jwtToken = url.searchParams.get('jwt');
    const channelSalt = url.searchParams.get('salt'); // Pre-fetched channelSalt to avoid re-fetching auth
    const shouldStripHeader = url.searchParams.get('strip') === '1';
    const customReferer = url.searchParams.get('ref'); // Custom referer for player6/moveonjoy proxying
    
    // SECURITY: Validate access - must have JWT token OR API key OR be internal call
    const referer = request.headers.get('referer') || '';
    const isInternalCall = referer.includes(url.host);
    const hasApiKey = validateApiKey(request, env).valid;
    const hasJwt = !!jwtToken && jwtToken.length > 20; // Basic JWT format check
    
    if (!isInternalCall && !hasApiKey && !hasJwt) {
      return new Response(JSON.stringify({ 
        error: 'Unauthorized - missing authentication',
        hint: 'Use /play/:channelId endpoint for authenticated access'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
    
    if (!targetUrl) {
      return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
    
    // Check if this is a KEY request - needs special auth headers
    const isKeyRequest = targetUrl.includes('/key/');
    
    if (isKeyRequest) {
      console.log(`[/dlhdprivate] KEY request: ${targetUrl.substring(0, 60)}...`);
      
      // Extract channel from key URL
      const keyMatch = targetUrl.match(/\/key\/([^/]+)\/(\d+)/);
      if (!keyMatch) {
        return new Response(JSON.stringify({ error: 'Invalid key URL format' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      
      const resource = keyMatch[1]; // e.g., "premium577"
      const keyNumber = keyMatch[2]; // e.g., "5900830"
      const channelMatch = resource.match(/premium(\d+)/);
      const channel = channelMatch ? channelMatch[1] : null;
      
      if (!channel) {
        return new Response(JSON.stringify({ error: 'Could not extract channel from key URL' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      
      // Import auth functions
      const { fetchAuthData, generateKeyHeaders: genHeaders } = await import('./direct/dlhd-auth-v5');
      
      // Check if we have pre-passed auth data (from /play endpoint)
      let authToken = jwtToken;
      let usedChannelSalt = channelSalt;
      
      // If we don't have pre-passed auth, try cache first, then fetch fresh
      if (!authToken || !usedChannelSalt) {
        // Try auth cache first
        const cached = getCachedAuth(channel);
        if (cached) {
          authToken = cached.authToken;
          usedChannelSalt = cached.channelSalt;
          console.log(`[/dlhdprivate] Using cached auth for channel ${channel}`);
        } else {
          console.log(`[/dlhdprivate] Fetching fresh auth data for channel ${channel}...`);
          const authData = await fetchAuthData(channel);
          
          if (!authData || !authData.channelSalt) {
            console.log(`[/dlhdprivate] ❌ Failed to get auth data`);
            return new Response(JSON.stringify({ error: 'Failed to get auth data from player page' }), {
              status: 502,
              headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            });
          }
          
          authToken = authData.authToken;
          usedChannelSalt = authData.channelSalt;
          // Cache for future key requests on this channel
          setCachedAuth(channel, authToken, usedChannelSalt);
          console.log(`[/dlhdprivate] ✅ Got fresh auth with salt: ${usedChannelSalt.substring(0, 16)}...`);
        }
      } else {
        console.log(`[/dlhdprivate] Using pre-passed auth data`);
      }
      
      // Step 2: Compute V5 auth headers and fetch key DIRECTLY from CF Worker
      // RPI proxy shares the same banned home IP, so we fetch directly from CF edge
      const authDataForKey: DLHDAuthDataV5 = {
        authToken: authToken!,
        channelKey: resource,
        country: 'US',
        timestamp: Math.floor(Date.now() / 1000),
        channelSalt: usedChannelSalt!,
        source: 'dlhdprivate-cf-direct',
      };
      const keyHeaders = await genHeaders(resource, keyNumber, authDataForKey);
      console.log(`[/dlhdprivate] Auth headers computed via V5 helper`);
      
      // Check key cache first - avoid hitting upstream if we already have this key
      const keyCacheKey = `${resource}/${keyNumber}`;
      const cachedKey = keyCache.get(keyCacheKey);
      if (cachedKey && cachedKey.expires > Date.now()) {
        console.log(`[/dlhdprivate] ✅ Key from cache: ${keyCacheKey}`);
        return new Response(cachedKey.data, {
          status: 200,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': '16',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache',
            'X-Fetched-By': 'key-cache',
          },
        });
      }
      
      console.log(`[/dlhdprivate] Fetching key via RPI /dlhd-key → CF direct → RPI fallback...`);
      
      // Helper to validate a 16-byte key response
      const validateKeyResponse = (keyData: ArrayBuffer | Uint8Array, source: string): Response | null => {
        const bytes = keyData instanceof Uint8Array ? keyData : new Uint8Array(keyData);
        if (bytes.byteLength !== 16) {
          console.log(`[/dlhdprivate] ❌ Invalid key size from ${source}: ${bytes.byteLength}`);
          return null;
        }
        const keyHex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
        console.log(`[/dlhdprivate] Got key from ${source}: ${keyHex}`);
        
        // Check for error-as-key patterns (rate limit error encoded as bytes)
        const isRateLimited = keyHex === '6572726f7220636f64653a2031303135' || keyHex.startsWith('6572726f72');
        if (isRateLimited) {
          console.log(`[/dlhdprivate] ⚠️ Rate limited (error in key bytes) from ${source}`);
          return null;
        }
        
        // Check for known fake/decoy key patterns
        const isFake = keyHex.startsWith('455806f8') || keyHex.startsWith('45c6497');
        if (isFake) {
          console.log(`[/dlhdprivate] ⚠️ Fake/decoy key from ${source}`);
          return null;
        }
        
        // Valid key - cache it
        console.log(`[/dlhdprivate] ✅ Valid key from ${source}: ${keyHex}`);
        keyCache.set(keyCacheKey, { data: new Uint8Array(bytes), expires: Date.now() + 60_000 });
        if (keyCache.size > 100) cleanExpiredKeys();
        
        return new Response(new Uint8Array(bytes), {
          status: 200,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': '16',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache',
            'X-Fetched-By': source,
          },
        });
      };
      
      const rpiProxyUrl = env.RPI_PROXY_URL;
      const rpiApiKey = env.RPI_PROXY_API_KEY;
      
      // Attempt 1: RPI /dlhd-key (PRIMARY — does full V5 auth from residential IP)
      // This endpoint fetches the player page, extracts XOR-encrypted salt/token,
      // computes PoW, and fetches the key — all from the RPI's residential IP.
      if (rpiProxyUrl && rpiApiKey) {
        console.log(`[/dlhdprivate] Trying RPI /dlhd-key (V5 auth)...`);
        try {
          const dlhdKeyUrl = `${rpiProxyUrl}/dlhd-key?url=${encodeURIComponent(targetUrl)}&key=${rpiApiKey}`;
          
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 15000);
          
          const dlhdKeyResponse = await fetch(dlhdKeyUrl, {
            headers: { 'X-API-Key': rpiApiKey },
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          
          if (dlhdKeyResponse.ok) {
            const keyData = await dlhdKeyResponse.arrayBuffer();
            const validResponse = validateKeyResponse(keyData, 'rpi-dlhd-key-v5');
            if (validResponse) return validResponse;
          } else {
            const errText = await dlhdKeyResponse.text().catch(() => '');
            console.log(`[/dlhdprivate] RPI /dlhd-key failed: ${dlhdKeyResponse.status} ${errText.substring(0, 100)}`);
          }
        } catch (e) {
          console.log(`[/dlhdprivate] RPI /dlhd-key error: ${e}`);
        }
      }
      
      // Attempt 2: Direct fetch from CF Worker with pre-computed V5 headers
      // May get fake key from datacenter IP but worth trying
      try {
        const directResponse = await fetch(targetUrl, { headers: keyHeaders });
        
        if (directResponse.ok) {
          const keyData = await directResponse.arrayBuffer();
          const validResponse = validateKeyResponse(keyData, 'cf-direct');
          if (validResponse) return validResponse;
        } else {
          console.log(`[/dlhdprivate] CF direct key fetch: ${directResponse.status}`);
        }
      } catch (e) {
        console.log(`[/dlhdprivate] CF direct key fetch error: ${e}`);
      }
      
      // Attempt 3: RPI /fetch-socks5 bridge (tunnels through SOCKS5 proxies with pre-computed headers)
      if (rpiProxyUrl && rpiApiKey) {
        console.log(`[/dlhdprivate] Trying RPI SOCKS5 bridge...`);
        try {
          const socks5Endpoint = `${rpiProxyUrl}/fetch-socks5?` + new URLSearchParams({
            url: targetUrl,
            headers: JSON.stringify(keyHeaders),
          }).toString();
          
          const socks5Response = await fetch(socks5Endpoint, {
            headers: { 'X-API-Key': rpiApiKey },
          });
          
          if (socks5Response.ok) {
            const keyData = await socks5Response.arrayBuffer();
            const validResponse = validateKeyResponse(keyData, `rpi-socks5-${socks5Response.headers.get('x-socks5-proxy') || 'unknown'}`);
            if (validResponse) return validResponse;
          } else {
            console.log(`[/dlhdprivate] RPI SOCKS5 bridge failed: ${socks5Response.status}`);
          }
        } catch (e) {
          console.log(`[/dlhdprivate] RPI SOCKS5 bridge error: ${e}`);
        }
      }
      
      // All attempts failed
      console.log(`[/dlhdprivate] ❌ All key fetch attempts failed for ${keyCacheKey}`);
      authCache.delete(channel);
      return new Response(JSON.stringify({ 
        error: 'Key fetch failed from all sources',
        code: 'KEY_FETCH_FAILED',
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
    
    // M3U8 and SEGMENT requests - fetch directly (no RPI needed!)
    console.log(`[/dlhdprivate] Direct fetch: ${targetUrl.substring(0, 60)}...`);
    
    try {
      const upstreamReferer = customReferer || 'https://www.ksohls.ru/';
      const upstreamOrigin = customReferer ? customReferer.replace(/\/$/, '') : 'https://www.ksohls.ru';
      const response = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Referer': upstreamReferer,
          'Origin': upstreamOrigin,
        },
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.log(`[/dlhdprivate] Direct fetch failed: ${response.status} - ${errorText.substring(0, 100)}`);
        return new Response(errorText, {
          status: response.status,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      
      // If strip=1, remove the 32-byte header from segments
      if (shouldStripHeader) {
        const segmentBuffer = await response.arrayBuffer();
        const segmentData = new Uint8Array(segmentBuffer);
        
        if (segmentData.length > 32) {
          const strippedData = segmentData.slice(32);
          return new Response(strippedData, {
            status: 200,
            headers: {
              'Content-Type': 'video/mp2t',
              'Content-Length': strippedData.length.toString(),
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'no-cache',
            },
          });
        }
      }
      
      // Stream response to client
      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const contentLength = response.headers.get('content-length');
      
      const responseHeaders: Record<string, string> = {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
      };
      if (contentLength) {
        responseHeaders['Content-Length'] = contentLength;
      }
      
      return new Response(response.body, {
        status: 200,
        headers: responseHeaders,
      });
    } catch (e) {
      console.error(`[/dlhdprivate] Error: ${e}`);
      return new Response(JSON.stringify({ error: `Request failed: ${e}` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
  });
  // Fast stream extraction endpoint - uses local JWT generation
  // This is the FASTEST way to get a stream - no external API calls needed
  // Returns direct URL + headers for client-side fetching (bypasses CF Worker IP blocking)
  router.get('/fast/:channelId', async (request, env, params) => {
    const channelId = params.channelId;
    const startTime = Date.now();
    
    // Check if client wants proxied URL or direct URL
    const url = new URL(request.url);
    const direct = url.searchParams.get('direct') === 'true';
    
    try {
      // Use fast extraction with local JWT generation
      const stream = await extractFast(channelId);
      
      if (!stream) {
        const timing: TimingInfo = {
          durationMs: Date.now() - startTime,
          startTime: new Date(startTime).toISOString(),
        };
        
        const errorResponse: ErrorResponse = {
          success: false,
          error: `Channel ${channelId} not found or not supported`,
          code: 'CHANNEL_NOT_FOUND',
          details: { timing },
        };
        
        return new Response(JSON.stringify(errorResponse), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      
      const timing: TimingInfo = {
        durationMs: Date.now() - startTime,
        startTime: new Date(startTime).toISOString(),
      };
      
      // If direct mode, return the raw URL and headers for client-side fetching
      // This bypasses Cloudflare Worker IP blocking by the upstream server
      if (direct) {
        const response = {
          success: true,
          streamUrl: stream.m3u8Url,
          headers: stream.headers,
          playerId: 0,
          quality: stream.quality,
          timing,
          note: 'Direct mode - client must fetch with provided headers',
        };
        
        return new Response(JSON.stringify(response), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      
      // Build the worker base URL for proxying
      const workerBaseUrl = `${url.protocol}//${url.host}`;
      
      // Create the proxied playable URL
      const proxiedUrl = encodeProxyUrl(
        stream.m3u8Url,
        stream.headers,
        workerBaseUrl,
        'playlist'
      );
      
      const response: StreamResponse = {
        success: true,
        streamUrl: proxiedUrl,
        playerId: 0, // Fast extraction doesn't use player IDs
        quality: stream.quality,
        timing,
      };
      
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      const timing: TimingInfo = {
        durationMs: Date.now() - startTime,
        startTime: new Date(startTime).toISOString(),
      };
      
      const errorResponse: ErrorResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Fast extraction failed',
        code: 'EXTRACTION_ERROR',
        details: { timing },
      };
      
      return new Response(JSON.stringify(errorResponse), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  });

  // Fast stats endpoint - shows server mapping coverage
  router.get('/fast/stats', async (request, env, params) => {
    const stats = getCacheStats();
    return new Response(JSON.stringify({
      success: true,
      stats,
      timestamp: new Date().toISOString(),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  // Debug endpoint - shows proxy config (remove in production)
  router.get('/debug/proxy', async (request, env, params) => {
    const { getProxyConfig } = await import('./discovery/fetcher');
    const proxyConfig = getProxyConfig();
    return new Response(JSON.stringify({
      success: true,
      proxyConfig: {
        url: proxyConfig.url || 'NOT SET',
        apiKeySet: !!proxyConfig.apiKey,
      },
      envVars: {
        RPI_PROXY_URL: env.RPI_PROXY_URL || 'NOT SET',
        RPI_PROXY_API_KEY_SET: !!env.RPI_PROXY_API_KEY,
      },
      timestamp: new Date().toISOString(),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  // Debug endpoint to test auth computation
  router.get('/debug-auth/:channelId', async (request, env, params) => {
    const channelId = params.channelId;
    
    try {
      // Import the auth functions
      const { fetchAuthData, generateKeyHeaders, computePowNonce, computeKeyPath, generateFingerprint, hmacSha256Debug } = await import('./direct/dlhd-auth-v5');
      
      // Fetch auth data
      const authData = await fetchAuthData(channelId);
      if (!authData) {
        return new Response(JSON.stringify({ error: 'Failed to fetch auth data' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      
      // Test values
      const resource = `premium${channelId}`;
      const keyNumber = '5900829';
      const timestamp = Math.floor(Date.now() / 1000);
      const fingerprint = await generateFingerprint();
      
      // Debug: compute HMAC prefix
      const hmacPrefix = await hmacSha256Debug(resource, authData.channelSalt);
      
      const nonce = await computePowNonce(resource, keyNumber, timestamp, authData.channelSalt);
      const keyPath = await computeKeyPath(resource, keyNumber, timestamp, fingerprint, authData.channelSalt);
      
      return new Response(JSON.stringify({
        authData: {
          authToken: authData.authToken.substring(0, 50) + '...',
          channelSalt: authData.channelSalt,
          channelKey: authData.channelKey,
          source: authData.source,
        },
        computed: {
          resource,
          keyNumber,
          timestamp,
          fingerprint,
          hmacPrefix,
          nonce,
          keyPath,
        },
        expected: {
          hmacPrefix: '1a4c310c0393ca113fc743a92b8180cfbebd0d1f624519c0185e64aa2b8a35c5',
        },
      }, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  });

  // Root endpoint (public)
  router.get('/', async (request, env, params) => {
    return new Response(
      JSON.stringify({
        name: 'DLHD Stream Extractor Worker',
        version: '2.3.0',
        endpoints: [
          'GET /play/:channelId - VLC-compatible: JWT generated locally, M3U8 via RPI',
          'GET /dlhdprivate?url=&headers= - Proxy segments/keys via RPI (internal use)',
          'GET /fast/:channelId - Get stream with local JWT (may fail due to CF IP blocking)',
          'GET /fast/:channelId?direct=true - Get raw URL + headers for client-side fetching',
          'GET /fast/stats - Get server mapping statistics',
          'GET /channels - List all channels',
          'GET /channel/:id - Get channel details',
          'GET /stream/:channelId - Auto-select best stream',
          'GET /stream/:channelId/:playerId - Get specific player stream',
          'GET /live/* - Proxy stream resources',
        ],
        notes: [
          '/play/:channelId - CF Worker generates JWT, fetches M3U8 via RPI, decrypts segments',
          '/dlhdprivate is used internally by M3U8 URLs to proxy segments through RPI',
          'All smart logic (JWT, PoW, server maps) is in CF Worker - RPI is just a dumb proxy',
          'Use ?direct=true to get raw M3U8 URL + headers for client-side fetching',
        ],
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  });

  // Channel listing endpoint (protected)
  router.get('/channels', async (_request, _env, _params) => {
    const startTime = Date.now();
    
    try {
      const { channels, timing } = await discoverChannels();
      const response = buildChannelListResponse(channels, timing);
      
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      const timing: TimingInfo = {
        durationMs: Date.now() - startTime,
        startTime: new Date(startTime).toISOString(),
      };
      
      // Handle parse errors specifically
      if (error instanceof ParseError) {
        const errorResponse: ErrorResponse = {
          success: false,
          error: error.message,
          code: error.code,
          details: { timing },
        };
        
        return new Response(JSON.stringify(errorResponse), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      
      // Handle network/fetch errors
      const errorResponse: ErrorResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch channels',
        code: 'FETCH_ERROR',
        details: { timing },
      };
      
      return new Response(JSON.stringify(errorResponse), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  });

  // Channel details endpoint (protected)
  router.get('/channel/:id', async (_request, _env, params) => {
    const channelId = params.id;
    const startTime = Date.now();
    
    try {
      // Fetch the channel page
      const { html } = await fetchChannelPage(channelId);
      
      // Detect all player sources
      const players = detectPlayers(html, channelId);
      
      // Build channel details response
      const channelDetails: ChannelDetails = {
        id: channelId,
        name: `Channel ${channelId}`, // Name will be extracted from page in future
        category: '24-7',
        status: 'live',
        players,
        lastUpdated: new Date().toISOString(),
      };
      
      const timing: TimingInfo = {
        durationMs: Date.now() - startTime,
        startTime: new Date(startTime).toISOString(),
      };
      
      return new Response(JSON.stringify({
        success: true,
        channel: channelDetails,
        timing,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      const timing: TimingInfo = {
        durationMs: Date.now() - startTime,
        startTime: new Date(startTime).toISOString(),
      };
      
      // Handle player detection errors
      if (error instanceof PlayerDetectionError) {
        const errorResponse: ErrorResponse = {
          success: false,
          error: error.message,
          code: error.code,
          details: { timing },
        };
        
        return new Response(JSON.stringify(errorResponse), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      
      // Handle 404 errors (channel not found)
      if (error instanceof Error && error.message.includes('404')) {
        const errorResponse: ErrorResponse = {
          success: false,
          error: `Channel ${channelId} not found`,
          code: 'CHANNEL_NOT_FOUND',
          details: { timing },
        };
        
        return new Response(JSON.stringify(errorResponse), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      
      // Handle network/fetch errors
      const errorResponse: ErrorResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch channel details',
        code: 'FETCH_ERROR',
        details: { timing },
      };
      
      return new Response(JSON.stringify(errorResponse), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  });

  // Auto-select stream endpoint (protected)
  // Requirements: 6.4 - THE Worker SHALL expose a `/stream/:channelId` endpoint 
  // that auto-selects the best working player and returns a playable stream
  router.get('/stream/:channelId', async (request, env, params) => {
    const channelId = params.channelId;
    const startTime = Date.now();
    
    try {
      // Fetch the channel page to get player sources
      const { html } = await fetchChannelPage(channelId);
      
      // Detect all player sources
      const players = detectPlayers(html, channelId);
      
      // Try to extract the best stream (tries direct backend first, then players)
      const result = await extractBestStream(channelId, players, undefined, { env });
      
      if (!result.success || !result.stream) {
        const timing: TimingInfo = {
          durationMs: Date.now() - startTime,
          startTime: new Date(startTime).toISOString(),
        };
        
        // Build comprehensive error message from all attempts
        const errorMessage = buildErrorMessage(result.attempts);
        
        // Use aggregated error if available
        const aggregatedError = result.aggregatedError;
        
        const errorResponse: ErrorResponse = {
          success: false,
          error: aggregatedError?.summary || errorMessage,
          code: 'ALL_PLAYERS_FAILED',
          details: { 
            timing,
            totalAttempts: aggregatedError?.totalAttempts || result.attempts.length,
            failedAttempts: aggregatedError?.failedAttempts || result.attempts.filter(a => !a.success).length,
            mostCommonError: aggregatedError?.mostCommonError,
            errorCodeCounts: aggregatedError?.errorCodeCounts,
            playerErrors: aggregatedError?.playerErrors || result.attempts.map(a => ({
              playerId: a.playerId,
              success: a.success,
              error: a.error,
              errorCode: a.errorCode,
              durationMs: a.durationMs,
            })),
          },
        };
        
        return new Response(JSON.stringify(errorResponse), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      
      // Build the worker base URL for proxying
      const url = new URL(request.url);
      const workerBaseUrl = `${url.protocol}//${url.host}`;
      
      // Create the proxied playable URL
      const proxiedUrl = encodeProxyUrl(
        result.stream.m3u8Url,
        result.stream.headers,
        workerBaseUrl,
        'playlist'
      );
      
      const timing: TimingInfo = {
        durationMs: Date.now() - startTime,
        startTime: new Date(startTime).toISOString(),
      };
      
      const response: StreamResponse = {
        success: true,
        streamUrl: proxiedUrl,
        playerId: result.playerId!,
        quality: result.stream.quality,
        timing,
      };
      
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      const timing: TimingInfo = {
        durationMs: Date.now() - startTime,
        startTime: new Date(startTime).toISOString(),
      };
      
      // Handle player detection errors
      if (error instanceof PlayerDetectionError) {
        const errorResponse: ErrorResponse = {
          success: false,
          error: error.message,
          code: error.code,
          details: { timing },
        };
        
        return new Response(JSON.stringify(errorResponse), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      
      // Handle 404 errors (channel not found)
      if (error instanceof Error && error.message.includes('404')) {
        const errorResponse: ErrorResponse = {
          success: false,
          error: `Channel ${channelId} not found`,
          code: 'CHANNEL_NOT_FOUND',
          details: { timing },
        };
        
        return new Response(JSON.stringify(errorResponse), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      
      // Handle generic errors
      const errorResponse: ErrorResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to extract stream',
        code: 'EXTRACTION_ERROR',
        details: { timing },
      };
      
      return new Response(JSON.stringify(errorResponse), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  });

  // Specific player stream endpoint (protected)
  // Requirements: 6.3 - THE Worker SHALL expose a `/stream/:channelId/:playerId` endpoint 
  // that returns a DIRECTLY PLAYABLE proxied M3U8 URL
  router.get('/stream/:channelId/:playerId', async (request, env, params) => {
    const { channelId, playerId: playerIdStr } = params;
    const startTime = Date.now();
    const playerId = parseInt(playerIdStr, 10);
    
    // Validate player ID
    if (isNaN(playerId) || playerId < 1 || playerId > 6) {
      const timing: TimingInfo = {
        durationMs: Date.now() - startTime,
        startTime: new Date(startTime).toISOString(),
      };
      
      const errorResponse: ErrorResponse = {
        success: false,
        error: `Invalid player ID: ${playerIdStr}. Must be between 1 and 6.`,
        code: 'INVALID_PLAYER',
        details: { timing },
      };
      
      return new Response(JSON.stringify(errorResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    try {
      // Fetch the channel page to get player sources
      const { html } = await fetchChannelPage(channelId);
      
      // Detect all player sources
      const players = detectPlayers(html, channelId);
      
      // Extract stream from the specific player
      const stream = await extractFromPlayerId(channelId, playerId, players);
      
      // Build the worker base URL for proxying
      const url = new URL(request.url);
      const workerBaseUrl = `${url.protocol}//${url.host}`;
      
      // Create the proxied playable URL
      const proxiedUrl = encodeProxyUrl(
        stream.m3u8Url,
        stream.headers,
        workerBaseUrl,
        'playlist'
      );
      
      const timing: TimingInfo = {
        durationMs: Date.now() - startTime,
        startTime: new Date(startTime).toISOString(),
      };
      
      const response: StreamResponse = {
        success: true,
        streamUrl: proxiedUrl,
        playerId,
        quality: stream.quality,
        timing,
      };
      
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      const timing: TimingInfo = {
        durationMs: Date.now() - startTime,
        startTime: new Date(startTime).toISOString(),
      };
      
      // Handle stream extraction errors
      if (error instanceof StreamExtractionError) {
        const errorResponse: ErrorResponse = {
          success: false,
          error: error.message,
          code: error.code,
          details: { timing, playerId: error.playerId },
        };
        
        return new Response(JSON.stringify(errorResponse), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      
      // Handle player detection errors
      if (error instanceof PlayerDetectionError) {
        const errorResponse: ErrorResponse = {
          success: false,
          error: error.message,
          code: error.code,
          details: { timing },
        };
        
        return new Response(JSON.stringify(errorResponse), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      
      // Handle 404 errors (channel not found)
      if (error instanceof Error && error.message.includes('404')) {
        const errorResponse: ErrorResponse = {
          success: false,
          error: `Channel ${channelId} not found`,
          code: 'CHANNEL_NOT_FOUND',
          details: { timing },
        };
        
        return new Response(JSON.stringify(errorResponse), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      
      // Handle generic errors
      const errorResponse: ErrorResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to extract stream',
        code: 'EXTRACTION_ERROR',
        details: { timing },
      };
      
      return new Response(JSON.stringify(errorResponse), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  });

  // Live proxy endpoint (protected)
  // Requirements: 6.5 - THE Worker SHALL expose a `/live/:path*` endpoint 
  // that proxies all stream resources (playlists, segments, keys)
  router.get('/live/*', async (request, env, params) => {
    const path = params.path;
    const url = new URL(request.url);
    const searchParams = url.searchParams;
    const startTime = Date.now();
    
    console.log(`[/live/*] Path: ${path}`);
    console.log(`[/live/*] Search params: ${searchParams.toString().substring(0, 100)}`);
    
    // Build the worker base URL for rewriting nested URLs
    const workerBaseUrl = `${url.protocol}//${url.host}`;
    console.log(`[/live/*] Worker base URL: ${workerBaseUrl}`);
    
    // Extract API key from query params for VLC/media player compatibility
    const apiKey = searchParams.get('key') || searchParams.get('api_key') || undefined;
    console.log(`[/live/*] API Key: ${apiKey ? 'present' : 'none'}`);
    
    try {
      // Handle the proxy request based on path type
      const result = await handleProxyRequest(path, searchParams, {
        workerBaseUrl,
        timeout: 30000,
        rewriteM3U8: true,
        apiKey,
      });
      
      // Add CORS headers to the response
      return addProxyCorsHeaders(result.response);
    } catch (error) {
      const timing: TimingInfo = {
        durationMs: Date.now() - startTime,
        startTime: new Date(startTime).toISOString(),
      };
      
      // Handle proxy errors
      if (error instanceof ProxyError) {
        const errorResponse: ErrorResponse = {
          success: false,
          error: error.message,
          code: error.code,
          details: { timing, ...error.details },
        };
        
        return addProxyCorsHeaders(new Response(JSON.stringify(errorResponse), {
          status: error.statusCode,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      
      // Handle generic errors
      const errorResponse: ErrorResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Proxy request failed',
        code: 'PROXY_ERROR',
        details: { timing },
      };
      
      return addProxyCorsHeaders(new Response(JSON.stringify(errorResponse), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }));
    }
  });
}
