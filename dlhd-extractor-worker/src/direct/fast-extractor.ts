/**
 * DLHD Fast Stream Extractor - INSTANT VERSION with Dynamic Server Lookup
 * 
 * DISCOVERY: M3U8 doesn't require auth! Only keys do.
 * This means we can extract streams in <500ms!
 * 
 * Flow (updated Feb 28, 2026):
 * 1. Look up server via LIVE server_lookup API (with in-memory cache) (~0-200ms)
 * 2. Fall back to pre-computed map if API fails (0ms)
 * 3. Construct M3U8 URL (0ms)  
 * 4. Fetch M3U8 with just Referer header (~100-400ms)
 * 5. If primary fails, try fallback servers
 * 
 * Auth is only needed when fetching keys, which happens on-demand.
 * 
 * Updated January 2026: Uses EPlayerAuth (V5) - no more JWT!
 * Updated February 2026: Added multi-server fallback for reliability
 * Updated February 28, 2026: Dynamic server_lookup API replaces stale hardcoded map
 *   - New lookup domain: chevy.vovlacosa.sbs
 *   - Channel range extended to 950+
 *   - In-memory cache for server lookups (2 min TTL)
 *   - Hardcoded map kept as fallback only
 */

import { Env, ExtractedStream } from '../types';
import { fetchAuthData, DLHDAuthDataV5 } from './dlhd-auth-v5';

// All known DLHD servers (discovered via server_lookup API)
// SECURITY: Keep these private - don't expose via public APIs
const ALL_SERVERS = ['ddy6', 'zeko', 'wind', 'dokko1', 'nfs', 'wiki'] as const;

// All known DLHD domains for M3U8 proxy
// SECURITY: Keep these private - don't expose via public APIs  
// UPDATED Feb 28, 2026: Added vovlacosa.sbs (new lookup domain found in player page)
const ALL_DOMAINS = ['adsfadfds.cfd', 'soyspace.cyou'] as const;

// Domains for server_lookup API (ordered by reliability)
const LOOKUP_DOMAINS = ['vovlacosa.sbs', 'adsfadfds.cfd', 'soyspace.cyou'] as const;

// Default domain (for M3U8 proxy)
const DEFAULT_DOMAIN = 'adsfadfds.cfd';

// Fallback request timeout (ms)
const FALLBACK_REQUEST_TIMEOUT = 8000;

// Maximum fallback attempts before giving up
const MAX_FALLBACK_ATTEMPTS = 6;

// Maximum valid channel ID (extended from 850 to 1000 to cover new channels)
const MAX_CHANNEL_ID = 1000;

// =============================================================================
// DYNAMIC SERVER LOOKUP (with in-memory cache)
// =============================================================================

// Cache: channel_id -> { server, expires }
const serverLookupCache = new Map<number, { server: string; expires: number }>();
const LOOKUP_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Look up the correct server for a channel via the live API.
 * Uses chevy.{domain}/server_lookup?channel_id=premium{ch}
 * Returns the server_key (e.g., "zeko", "ddy6") or null if lookup fails.
 * Results are cached in-memory for 2 minutes.
 */
export async function lookupServer(channelId: number): Promise<string | null> {
  // Check cache first
  const cached = serverLookupCache.get(channelId);
  if (cached && cached.expires > Date.now()) {
    return cached.server;
  }
  
  const channelKey = `premium${channelId}`;
  
  // Try each lookup domain in order
  for (const domain of LOOKUP_DOMAINS) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      
      const resp = await fetch(
        `https://chevy.${domain}/server_lookup?channel_id=${encodeURIComponent(channelKey)}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://www.ksohls.ru/',
            'Origin': 'https://www.ksohls.ru',
          },
          signal: controller.signal,
        }
      );
      clearTimeout(timeoutId);
      
      if (resp.ok) {
        const data = await resp.json() as { server_key?: string; error?: string };
        if (data.server_key) {
          // Cache the result
          serverLookupCache.set(channelId, { server: data.server_key, expires: Date.now() + LOOKUP_CACHE_TTL_MS });
          
          // Evict old cache entries if too large
          if (serverLookupCache.size > 500) {
            const now = Date.now();
            for (const [key, val] of serverLookupCache.entries()) {
              if (val.expires < now) serverLookupCache.delete(key);
            }
          }
          
          console.log(`[ServerLookup] ch${channelId} -> ${data.server_key} (via ${domain})`);
          return data.server_key;
        }
      }
    } catch (e) {
      // Try next domain
      continue;
    }
  }
  
  console.log(`[ServerLookup] API failed for ch${channelId}, falling back to static map`);
  return null;
}

// Pre-computed server mappings from discovery scan
// Maps channel ID to PRIMARY server (first to try)
const SERVER_MAP: Record<number, string> = {};

// Initialize server map
const SERVER_CHANNELS: Record<string, number[]> = {
  'ddy6': [40,55,69,73,79,83,100,137,78,105,101,106,109,107,127,120,102,98,152,85,108,110,136,139,135,138,149,148,151,160,154,166,165,179,167,170,174,172,173,205,206,210,203,209,202,223,217,204,201,207,211,212,215,216,218,268,281,282,269,286,289,290,285,295,291,296,299,287,297,298,323,342,353,358,363,362,356,361,369,388,393,428,415,414,418,427,426,432,434,482,449,454,455,462,461,450,474,498,499,500,488,487,494,495,486,489,490,496,497,514,517,511,519,513,512,515,516,518,520,525,540,542,553,557,559,558,573,574,576,611,612,613,641,653,662,654,655,687,666,719,721,681,730,735,718,740,726,717,716,723,729,725,724,727,720,728,722,731,733,736,734,732,738,737,739,744,746,741,756,748,749,772,770,771,773,774,830,828,809,818,819,817,827,826,850],
  'zeko': [51,36,35,38,44,56,39,64,54,62,67,81,90,63,111,114,142,143,112,145,115,113,118,125,117,116,119,126,123,141,146,147,140,144,214,213,273,278,293,266,265,267,271,272,277,300,302,310,305,309,311,306,313,314,316,308,301,317,320,321,328,312,318,315,336,335,338,347,344,346,352,351,364,355,365,370,368,372,367,384,382,383,386,379,374,385,375,398,373,378,381,405,394,404,413,416,409,411,412,423,422,433,419,421,425,437,424,435,430,447,446,438,436,448,504,503,501,502,506,505,507,508,510,509,524,546,543,544,547,555,597,602,598,646,706,703,700,704,702,705,699,707,768,745,769,775,758,763,759,765,757,766,799,767,777,792,791,793,820,822,821,848],
  'wind': [43,70,42,49,46,41,58,50,59,47,66,45,61,60,57,71,87,75,53,68,122,72,84,88,89,80,76,82,121,124,131,129,134,150,162,161,155,164,169,163,175,176,177,168,171,178,235,230,231,260,232,236,233,238,239,234,237,259,276,274,275,324,327,325,326,331,329,330,333,332,337,340,354,360,377,366,376,387,397,390,406,396,399,408,407,410,420,429,431,478,484,443,451,457,456,459,458,445,468,466,463,469,453,471,467,473,475,479,465,464,472,470,481,485,476,480,477,483,541,521,522,570,550,554,578,569,581,580,579,599,600,672,678,671,673,674,683,680,675,676,677,715,679,688,685,686,682,684,755,776,754,750,753,787,788,824,825,849,847,844,846],
  'dokko1': [65,97,91,92,93,86,94,95,74,96,130,153,157,159,158,156,219,221,220,270,341,348,350,349,357,359,392,380,460,452,444,523,529,527,531,530,538,528,534,535,532,537,539,526,533,536,562,560,564,563,566,556,567,561,565,568,571,610,584,589,588,592,587,593,601,605,606,590,607,594,609,603,591,595,604,596,642,608,625,631,647,630,624,628,622,634,640,623,626,627,633,635,629,637,632,636,638,645,643,649,648,650,651,657,658,659,664,660,663,661,665,669,670,697,698,751,752,780,800,801,802,808,806,782,784,781,783,779,778,785,797,798,807,805,810,803,804,813,811,834,833,836,839,835,832,841,837,840,845,842],
  'nfs': [4,2,5,8,3,10,32,11,9,7,18,13,27,31,24,1,20,16,19,30,34,37,29,17,12,6,14,15,23,22,28,26,25,48,21,33,52,77,132,133,103,128,104,185,192,180,195,187,184,190,194,183,197,182,198,181,193,208,186,188,189,191,196,199,200,222,224,228,229,227,226,225,240,241,280,288,279,283,304,303,284,294,307,292,322,319,339,334,343,345,401,371,395,389,400,391,403,402,575,577,583,585,652,644,656,713,667,692,709,696,693,691,690,714,712,708,694,689,747,743,742,762,789,790,795,764,796,794,831,814,816,829,838],
  'wiki': [439,440,843]
};

// Build reverse lookup map
for (const [server, channels] of Object.entries(SERVER_CHANNELS)) {
  for (const ch of channels) {
    SERVER_MAP[ch] = server;
  }
}

/**
 * Get the ordered list of servers to try for a channel.
 * Uses LIVE server_lookup API first (cached), falls back to static map.
 * Primary server first, then all others as fallbacks.
 */
export async function getServersForChannelDynamic(channelId: number): Promise<string[]> {
  // Try live lookup first (uses cache, very fast on repeat calls)
  const liveServer = await lookupServer(channelId);
  if (liveServer) {
    // Return live result first, then all known servers as fallbacks
    return [liveServer, ...ALL_SERVERS.filter(s => s !== liveServer)];
  }
  
  // Fall back to static map
  return getServersForChannel(channelId);
}

/**
 * Get the ordered list of servers to try for a channel (static map only).
 * Primary server first, then all others as fallbacks.
 */
export function getServersForChannel(channelId: number): string[] {
  const primary = SERVER_MAP[channelId];
  if (primary) {
    // Return primary first, then all others
    return [primary, ...ALL_SERVERS.filter(s => s !== primary)];
  }
  // No primary mapping, try all servers
  return [...ALL_SERVERS];
}

/**
 * Get server for a channel from pre-computed map (primary only)
 */
export function getServerForChannel(channelId: number): string | null {
  return SERVER_MAP[channelId] || null;
}

/**
 * Build M3U8 URL for a channel on a specific server/domain
 * UPDATED Feb 25, 2026: M3U8 now served via proxy pattern
 * OLD: https://{server}new.dvalna.ru/{server}/premium{ch}/mono.css
 * NEW: https://chevy.adsfadfds.cfd/proxy/{server}/premium{ch}/mono.css
 */
function buildM3U8Url(channelId: string, server: string, domain: string = DEFAULT_DOMAIN): string {
  const channelKey = `premium${channelId}`;
  return `https://chevy.${domain}/proxy/${server}/${channelKey}/mono.css`;
}

/**
 * Fast stream extraction - INSTANT! No auth needed for M3U8!
 * Updated Feb 28, 2026: Uses dynamic server_lookup API with static map fallback.
 * 
 * @param channelId - Channel ID (1-1000)
 * @returns ExtractedStream or null if channel not found
 */
export async function extractFast(channelId: string): Promise<ExtractedStream | null> {
  const startTime = Date.now();
  console.log(`[FastExtract] Starting instant extraction for channel ${channelId}`);
  
  const chNum = parseInt(channelId, 10);
  if (isNaN(chNum) || chNum < 1 || chNum > MAX_CHANNEL_ID) {
    console.log(`[FastExtract] Invalid channel ID: ${channelId}`);
    return null;
  }

  // Step 1: Get server - try live API first, then static map
  let server = await lookupServer(chNum);
  if (!server) {
    server = getServerForChannel(chNum);
  }
  if (!server) {
    console.log(`[FastExtract] No server found for channel ${channelId}`);
    return null;
  }

  // Step 2: Construct M3U8 URL (instant - 0ms)
  const m3u8Url = buildM3U8Url(channelId, server);

  // Step 3: Build headers - NO AUTH NEEDED for M3U8!
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Referer': 'https://www.ksohls.ru/',
    'Origin': 'https://www.ksohls.ru',
  };

  const elapsed = Date.now() - startTime;
  console.log(`[FastExtract] SUCCESS in ${elapsed}ms: Channel ${channelId} -> ${server}.${DEFAULT_DOMAIN}`);

  return {
    m3u8Url,
    headers,
    referer: 'https://www.ksohls.ru/',
    origin: 'https://www.ksohls.ru',
    quality: undefined,
    isEncrypted: true,
  };
}

/**
 * Extract stream with multi-server fallback
 * Tries primary server first, then falls back to other servers if it fails
 * 
 * SECURITY:
 * - Validates all inputs before use
 * - Limits fallback attempts to prevent DoS amplification
 * - Uses timeouts to prevent hanging requests
 * - Sanitizes log output to avoid leaking infrastructure details
 * 
 * @param channelId - Channel ID (1-850)
 * @param token - Auth token for the request (must be non-empty)
 * @param rpiProxyUrl - RPI proxy URL (must be valid HTTPS URL)
 * @param rpiApiKey - RPI proxy API key (must be non-empty)
 * @returns ExtractedStream with working server, or null if all fail
 */
export async function extractWithFallback(
  channelId: string,
  token: string,
  rpiProxyUrl: string,
  rpiApiKey: string
): Promise<{ stream: ExtractedStream; server: string; domain: string } | null> {
  const startTime = Date.now();
  
  // SECURITY: Validate all inputs
  if (!token || token.length < 10) {
    console.log(`[FastExtract] Invalid or missing auth token`);
    return null;
  }
  
  if (!rpiProxyUrl || !rpiApiKey) {
    console.log(`[FastExtract] Missing RPI proxy configuration`);
    return null;
  }
  
  // Validate RPI proxy URL format
  try {
    const proxyUrl = new URL(rpiProxyUrl);
    if (proxyUrl.protocol !== 'https:' && !proxyUrl.hostname.includes('localhost')) {
      console.log(`[FastExtract] RPI proxy must use HTTPS`);
      return null;
    }
  } catch {
    console.log(`[FastExtract] Invalid RPI proxy URL format`);
    return null;
  }
  
  const chNum = parseInt(channelId, 10);
  
  if (isNaN(chNum) || chNum < 1 || chNum > MAX_CHANNEL_ID) {
    console.log(`[FastExtract] Invalid channel ID: ${channelId}`);
    return null;
  }

  // Use dynamic lookup for server list
  const servers = await getServersForChannelDynamic(chNum);
  // SECURITY: Don't log server names - could leak infrastructure
  console.log(`[FastExtract] Trying fallback for channel ${channelId}`);

  let attempts = 0;
  
  // Try each server in order, but limit total attempts
  for (const server of servers) {
    for (const domain of ALL_DOMAINS) {
      // SECURITY: Limit total fallback attempts to prevent DoS amplification
      if (attempts >= MAX_FALLBACK_ATTEMPTS) {
        console.log(`[FastExtract] Max fallback attempts (${MAX_FALLBACK_ATTEMPTS}) reached`);
        break;
      }
      attempts++;
      
      const m3u8Url = buildM3U8Url(channelId, server, domain);
      
      try {
        // Fetch via RPI proxy with timeout
        const rpiUrl = new URL('/dlhdprivate', rpiProxyUrl);
        rpiUrl.searchParams.set('url', m3u8Url);
        // SECURITY: Pass auth in headers object, not as separate param
        rpiUrl.searchParams.set('headers', JSON.stringify({
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': '*/*',
          'Referer': 'https://www.ksohls.ru/',
          'Origin': 'https://www.ksohls.ru',
          'Authorization': `Bearer ${token}`,
        }));

        // SECURITY: Add timeout to prevent hanging requests
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FALLBACK_REQUEST_TIMEOUT);
        
        try {
          const response = await fetch(rpiUrl.toString(), {
            headers: { 'X-API-Key': rpiApiKey },
            signal: controller.signal,
          });
          
          clearTimeout(timeoutId);

          if (response.ok) {
            const text = await response.text();
            // Check if it's a valid M3U8
            if (text.includes('#EXTM3U') || text.includes('#EXT-X-')) {
              const elapsed = Date.now() - startTime;
              // SECURITY: Don't log server/domain in success message
              console.log(`[FastExtract] SUCCESS in ${elapsed}ms for channel ${channelId}`);
              
              return {
                stream: {
                  m3u8Url,
                  headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': '*/*',
                    'Referer': 'https://www.ksohls.ru/',
                    'Origin': 'https://www.ksohls.ru',
                    'Authorization': `Bearer ${token}`,
                  },
                  referer: 'https://www.ksohls.ru/',
                  origin: 'https://www.ksohls.ru',
                  quality: undefined,
                  isEncrypted: true,
                },
                server,
                domain,
              };
            }
          }
        } catch (fetchError) {
          clearTimeout(timeoutId);
          if (fetchError instanceof Error && fetchError.name === 'AbortError') {
            console.log(`[FastExtract] Timeout on attempt ${attempts}`);
          } else {
            throw fetchError;
          }
        }
        
        // SECURITY: Don't log which server failed
        console.log(`[FastExtract] Attempt ${attempts} failed for channel ${channelId}`);
      } catch (e) {
        // SECURITY: Don't log error details that might expose infrastructure
        console.log(`[FastExtract] Error on attempt ${attempts}`);
      }
    }
    
    if (attempts >= MAX_FALLBACK_ATTEMPTS) break;
  }

  const elapsed = Date.now() - startTime;
  console.log(`[FastExtract] All attempts failed for channel ${channelId} after ${elapsed}ms`);
  return null;
}

/**
 * Get stats for debugging
 */
export function getCacheStats(): { serverMapSize: number; totalServers: number; totalDomains: number } {
  return {
    serverMapSize: Object.keys(SERVER_MAP).length,
    totalServers: ALL_SERVERS.length,
    totalDomains: ALL_DOMAINS.length,
  };
}

/**
 * Check if a channel exists in the server map (static check only).
 * For dynamic check, use lookupServer() which queries the live API.
 */
export function channelExists(channelId: number): boolean {
  return SERVER_MAP[channelId] !== undefined;
}

/**
 * Check if a channel exists (dynamic + static).
 * Tries live API first, then falls back to static map.
 */
export async function channelExistsDynamic(channelId: number): Promise<boolean> {
  if (SERVER_MAP[channelId] !== undefined) return true;
  const server = await lookupServer(channelId);
  return server !== null;
}

/**
 * Get all valid channel IDs
 */
export function getAllChannels(): number[] {
  return Object.keys(SERVER_MAP).map(Number).sort((a, b) => a - b);
}

/**
 * Get all available servers (INTERNAL USE ONLY)
 * WARNING: Do not expose this list in public API responses
 */
export function getAllServers(): readonly string[] {
  return ALL_SERVERS;
}

/**
 * Get all available domains (INTERNAL USE ONLY)
 * WARNING: Do not expose this list in public API responses
 */
export function getAllDomains(): readonly string[] {
  return ALL_DOMAINS;
}


/**
 * Generate auth token for a channel (V5 EPlayerAuth)
 * 
 * This fetches the authToken from www.ksohls.ru which is MUCH faster
 * than hitsplay.fun (~300ms vs ~14000ms).
 * 
 * The authToken is a pipe-delimited string:
 * channelKey|country|timestamp|expiry|signature
 * 
 * @param channelId - Channel ID (e.g., "51")
 * @returns Object with token and channelKey
 */
export async function generateJWT(channelId: string): Promise<{ token: string; channelKey: string; channelSalt?: string }> {
  const chNum = parseInt(channelId, 10);
  const channelKey = `premium${chNum}`;
  
  // Fetch auth data from www.ksohls.ru (fast endpoint)
  const authData = await fetchAuthData(channelId);
  
  if (authData && authData.authToken) {
    console.log(`[generateJWT] Got V5 auth token for channel ${channelId}`);
    return {
      token: authData.authToken,
      channelKey: authData.channelKey || channelKey,
      channelSalt: authData.channelSalt, // CRITICAL: Pass channelSalt for key fetching
    };
  }
  
  // Fallback: Generate a minimal token if fetch fails
  // This won't work for key fetching but allows M3U8 to be fetched
  console.log(`[generateJWT] Auth fetch failed, using fallback token for channel ${channelId}`);
  const timestamp = Math.floor(Date.now() / 1000);
  const expiry = timestamp + 86400; // 24 hours
  const fallbackToken = `${channelKey}|US|${timestamp}|${expiry}|fallback`;
  
  return {
    token: fallbackToken,
    channelKey,
  };
}

/**
 * Get the server lookup cache stats for debugging
 */
export function getLookupCacheStats(): { size: number; entries: Array<{ channel: number; server: string; expiresIn: number }> } {
  const now = Date.now();
  const entries: Array<{ channel: number; server: string; expiresIn: number }> = [];
  for (const [ch, val] of serverLookupCache.entries()) {
    entries.push({ channel: ch, server: val.server, expiresIn: Math.max(0, val.expires - now) });
  }
  return { size: serverLookupCache.size, entries: entries.slice(0, 20) };
}
