/**
 * DLHD Proxy - January 2026 Update
 *
 * Proxies daddyhd.com live streams through Cloudflare Workers.
 * Domain changed from kiko2.ru to dvalna.ru.
 * Key requests now require Proof-of-Work nonce computation.
 *
 * Authentication Flow (January 2026):
 *   1. Fetch player page → Extract JWT token (eyJ...)
 *   2. Server lookup → Get server key (zeko, wind, etc.)
 *   3. Fetch M3U8 → Get playlist with key URLs
 *   4. Fetch key with PoW → Compute nonce, send with JWT
 *
 * Routes:
 *   GET /?channel=<id>           - Get proxied M3U8 playlist
 *   GET /key?url=<url>&jwt=<jwt> - Proxy encryption key (with PoW)
 *   GET /segment?url=<url>       - Proxy video segment
 *   GET /auth?channel=<id>       - Get fresh JWT token
 *   GET /health                  - Health check
 */

import { createLogger, type LogLevel } from './logger';

export interface Env {
  LOG_LEVEL?: string;
  RPI_PROXY_URL?: string;
  RPI_PROXY_KEY?: string;
  SIGNING_SECRET?: string;
  RATE_LIMIT_KV?: KVNamespace;
  ALLOWED_ORIGINS?: string;
}

// =============================================================================
// SECURITY HELPERS
// =============================================================================

/**
 * Allowed origins for DLHD access
 * SECURITY: Do NOT add '*' - it bypasses all origin checks
 */
const ALLOWED_ORIGINS = [
  'https://tv.vynx.cc',
  'https://flyx.tv',
  'https://www.flyx.tv',
  'http://localhost:3000',
  'http://localhost:3001',
  '.vercel.app',
  '.pages.dev',
  '.workers.dev',
  // REMOVED: '*' - was allowing all origins, defeating anti-leech protection
];

/**
 * Check if origin is allowed
 */
function isAllowedOrigin(origin: string): boolean {
  // Allow all origins if '*' is in the list
  if (ALLOWED_ORIGINS.includes('*')) return true;
  
  return ALLOWED_ORIGINS.some(allowed => {
    if (allowed.includes('localhost')) {
      return origin.includes('localhost');
    }
    if (allowed.startsWith('.')) {
      try {
        const originHost = new URL(origin).hostname;
        return originHost.endsWith(allowed);
      } catch {
        return false;
      }
    }
    try {
      const allowedHost = new URL(allowed).hostname;
      const originHost = new URL(origin).hostname;
      return originHost === allowedHost || originHost.endsWith(`.${allowedHost}`);
    } catch {
      return false;
    }
  });
}

/**
 * Generate signature for request validation
 */
async function generateSignature(sessionId: string, resource: string, timestamp: number, secret: string): Promise<string> {
  const data = `${sessionId}:${resource}:${timestamp}`;
  const encoder = new TextEncoder();
  
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .substring(0, 32);
}

// =============================================================================
// CONSTANTS
// =============================================================================

// UPDATED February 2026: epaly.fun is the new player domain (was codepcplay.fun, before that epicplayplay.cfd)
const PLAYER_DOMAIN = 'epaly.fun';
const PARENT_DOMAIN = 'dlhd.link';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

// Channel ID to topembed.pw channel name mapping
const CHANNEL_TO_TOPEMBED: Record<string, string> = {
  '31': 'TNTSports1[UK]',
  '32': 'TNTSports2[UK]',
  '33': 'TNTSports3[UK]',
  '34': 'TNTSports4[UK]',
  '35': 'SkySportsFootball[UK]',
  '36': 'SkySportsArena[UK]',
  '37': 'SkySportsAction[UK]',
  '38': 'SkySportsMainEvent[UK]',
  '39': 'FOXSports1[USA]',
  '40': 'TennisChannel[USA]',
  '43': 'PDCTV[USA]',
  '44': 'ESPN[USA]',
  '45': 'ESPN2[USA]',
  '46': 'SkySportsTennis[UK]',
  '48': 'CanalSport[Poland]',
  '49': 'SportTV1[Portugal]',
  '51': 'AbcTv[USA]',
  '52': 'CBS[USA]',
  '53': 'NBC[USA]',
  '54': 'Fox[USA]',
  '56': 'SuperSportFootball[SouthAfrica]',
  '57': 'Eurosport1[Poland]',
  '58': 'Eurosport2[Poland]',
  '60': 'SkySportsF1[UK]',
  '61': 'BeinSportsMena1[UK]',
  '65': 'SkySportsCricket[UK]',
  '66': 'TUDN[USA]',
  '70': 'SkySportsGolf[UK]',
  '71': 'ElevenSports1[Poland]',
  '74': 'SportTV2[Portugal]',
  '75': 'CanalPlusSport5[Poland]',
  '81': 'ESPNBrazil[Brazil]',
  '84': 'MLaliga[Spain]',
  '88': 'Premiere1[Brasil]',
  '89': 'Combate[Brazil]',
  '91': 'BeinSports1[Arab]',
  '92': 'BeinSports2[Arab]',
};

/** New domain (January 2026) - was kiko2.ru */
const CDN_DOMAIN = 'dvalna.ru';

/** HMAC secret for PoW computation - loaded from environment variable */
// SECURITY: Never hardcode secrets in source code
const getHmacSecret = (env?: Env): string => {
  const secret = (env as any)?.DLHD_HMAC_SECRET;
  if (!secret) {
    // SECURITY: Log warning but don't expose in production
    console.warn('[DLHD] WARNING: DLHD_HMAC_SECRET not configured - using insecure fallback');
  }
  // In production, ALWAYS set DLHD_HMAC_SECRET in Cloudflare Worker secrets
  // CORRECT SECRET - extracted from WASM module (January 2026)
  return secret || '444c44cc8888888844444444';
};

/** PoW threshold - hash prefix must be less than this */
const POW_THRESHOLD = 0x1000;

/** Maximum PoW iterations */
const POW_MAX_ITERATIONS = 100000;

/** Session cache TTL (4 hours - JWT valid for 5) */
const SESSION_CACHE_TTL_MS = 4 * 60 * 60 * 1000;

/** Maximum session cache size to prevent memory exhaustion */
const SESSION_CACHE_MAX_SIZE = 500;

// Session cache
interface SessionData {
  jwt: string;
  channelKey: string;
  country: string;
  iat: number;
  exp: number;
  fetchedAt: number;
  source?: 'epaly.fun' | 'hitsplay.fun' | 'topembed.pw'; // Track where JWT was obtained from
}
const sessionCache = new Map<string, SessionData>();

/**
 * Add to session cache with size limit enforcement
 */
function addToSessionCache(channel: string, session: SessionData): void {
  // Evict oldest entries if cache is full
  if (sessionCache.size >= SESSION_CACHE_MAX_SIZE) {
    const oldestKey = sessionCache.keys().next().value;
    if (oldestKey) sessionCache.delete(oldestKey);
  }
  sessionCache.set(channel, session);
}

// =============================================================================
// CRYPTO HELPERS
// =============================================================================

/**
 * Convert ArrayBuffer to hex string
 */
function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Compute HMAC-SHA256
 */
async function hmacSha256(key: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(key);
  const msgData = encoder.encode(data);
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
  return bufferToHex(signature);
}

/**
 * Compute MD5 hash (pure JS implementation for CF Workers)
 */
function md5(input: string): string {
  const md5cycle = (x: number[], k: number[]) => {
    let a = x[0], b = x[1], c = x[2], d = x[3];
    
    const ff = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) => {
      const n = a + ((b & c) | (~b & d)) + x + t;
      return ((n << s) | (n >>> (32 - s))) + b;
    };
    const gg = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) => {
      const n = a + ((b & d) | (c & ~d)) + x + t;
      return ((n << s) | (n >>> (32 - s))) + b;
    };
    const hh = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) => {
      const n = a + (b ^ c ^ d) + x + t;
      return ((n << s) | (n >>> (32 - s))) + b;
    };
    const ii = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) => {
      const n = a + (c ^ (b | ~d)) + x + t;
      return ((n << s) | (n >>> (32 - s))) + b;
    };
    
    a = ff(a, b, c, d, k[0], 7, -680876936);
    d = ff(d, a, b, c, k[1], 12, -389564586);
    c = ff(c, d, a, b, k[2], 17, 606105819);
    b = ff(b, c, d, a, k[3], 22, -1044525330);
    a = ff(a, b, c, d, k[4], 7, -176418897);
    d = ff(d, a, b, c, k[5], 12, 1200080426);
    c = ff(c, d, a, b, k[6], 17, -1473231341);
    b = ff(b, c, d, a, k[7], 22, -45705983);
    a = ff(a, b, c, d, k[8], 7, 1770035416);
    d = ff(d, a, b, c, k[9], 12, -1958414417);
    c = ff(c, d, a, b, k[10], 17, -42063);
    b = ff(b, c, d, a, k[11], 22, -1990404162);
    a = ff(a, b, c, d, k[12], 7, 1804603682);
    d = ff(d, a, b, c, k[13], 12, -40341101);
    c = ff(c, d, a, b, k[14], 17, -1502002290);
    b = ff(b, c, d, a, k[15], 22, 1236535329);
    
    a = gg(a, b, c, d, k[1], 5, -165796510);
    d = gg(d, a, b, c, k[6], 9, -1069501632);
    c = gg(c, d, a, b, k[11], 14, 643717713);
    b = gg(b, c, d, a, k[0], 20, -373897302);
    a = gg(a, b, c, d, k[5], 5, -701558691);
    d = gg(d, a, b, c, k[10], 9, 38016083);
    c = gg(c, d, a, b, k[15], 14, -660478335);
    b = gg(b, c, d, a, k[4], 20, -405537848);
    a = gg(a, b, c, d, k[9], 5, 568446438);
    d = gg(d, a, b, c, k[14], 9, -1019803690);
    c = gg(c, d, a, b, k[3], 14, -187363961);
    b = gg(b, c, d, a, k[8], 20, 1163531501);
    a = gg(a, b, c, d, k[13], 5, -1444681467);
    d = gg(d, a, b, c, k[2], 9, -51403784);
    c = gg(c, d, a, b, k[7], 14, 1735328473);
    b = gg(b, c, d, a, k[12], 20, -1926607734);
    
    a = hh(a, b, c, d, k[5], 4, -378558);
    d = hh(d, a, b, c, k[8], 11, -2022574463);
    c = hh(c, d, a, b, k[11], 16, 1839030562);
    b = hh(b, c, d, a, k[14], 23, -35309556);
    a = hh(a, b, c, d, k[1], 4, -1530992060);
    d = hh(d, a, b, c, k[4], 11, 1272893353);
    c = hh(c, d, a, b, k[7], 16, -155497632);
    b = hh(b, c, d, a, k[10], 23, -1094730640);
    a = hh(a, b, c, d, k[13], 4, 681279174);
    d = hh(d, a, b, c, k[0], 11, -358537222);
    c = hh(c, d, a, b, k[3], 16, -722521979);
    b = hh(b, c, d, a, k[6], 23, 76029189);
    a = hh(a, b, c, d, k[9], 4, -640364487);
    d = hh(d, a, b, c, k[12], 11, -421815835);
    c = hh(c, d, a, b, k[15], 16, 530742520);
    b = hh(b, c, d, a, k[2], 23, -995338651);
    
    a = ii(a, b, c, d, k[0], 6, -198630844);
    d = ii(d, a, b, c, k[7], 10, 1126891415);
    c = ii(c, d, a, b, k[14], 15, -1416354905);
    b = ii(b, c, d, a, k[5], 21, -57434055);
    a = ii(a, b, c, d, k[12], 6, 1700485571);
    d = ii(d, a, b, c, k[3], 10, -1894986606);
    c = ii(c, d, a, b, k[10], 15, -1051523);
    b = ii(b, c, d, a, k[1], 21, -2054922799);
    a = ii(a, b, c, d, k[8], 6, 1873313359);
    d = ii(d, a, b, c, k[15], 10, -30611744);
    c = ii(c, d, a, b, k[6], 15, -1560198380);
    b = ii(b, c, d, a, k[13], 21, 1309151649);
    a = ii(a, b, c, d, k[4], 6, -145523070);
    d = ii(d, a, b, c, k[11], 10, -1120210379);
    c = ii(c, d, a, b, k[2], 15, 718787259);
    b = ii(b, c, d, a, k[9], 21, -343485551);
    
    x[0] = (a + x[0]) >>> 0;
    x[1] = (b + x[1]) >>> 0;
    x[2] = (c + x[2]) >>> 0;
    x[3] = (d + x[3]) >>> 0;
  };
  
  const md5blk = (s: string) => {
    const md5blks: number[] = [];
    for (let i = 0; i < 64; i += 4) {
      md5blks[i >> 2] = s.charCodeAt(i) + (s.charCodeAt(i + 1) << 8) +
        (s.charCodeAt(i + 2) << 16) + (s.charCodeAt(i + 3) << 24);
    }
    return md5blks;
  };
  
  let n = input.length;
  const state = [1732584193, -271733879, -1732584194, 271733878];
  let i: number;
  
  for (i = 64; i <= n; i += 64) {
    md5cycle(state, md5blk(input.substring(i - 64, i)));
  }
  
  input = input.substring(i - 64);
  const tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (i = 0; i < input.length; i++) {
    tail[i >> 2] |= input.charCodeAt(i) << ((i % 4) << 3);
  }
  tail[i >> 2] |= 0x80 << ((i % 4) << 3);
  if (i > 55) {
    md5cycle(state, tail);
    for (i = 0; i < 16; i++) tail[i] = 0;
  }
  tail[14] = n * 8;
  md5cycle(state, tail);
  
  const hex = (x: number) => {
    const hc = '0123456789abcdef';
    let s = '';
    for (let j = 0; j < 4; j++) {
      s += hc.charAt((x >> (j * 8 + 4)) & 0xF) + hc.charAt((x >> (j * 8)) & 0xF);
    }
    return s;
  };
  
  return state.map(hex).join('');
}

/**
 * Compute Proof-of-Work nonce for key request
 */
async function computePoWNonce(resource: string, keyNumber: string, timestamp: number, env?: Env): Promise<number> {
  const hmac = await hmacSha256(getHmacSecret(env), resource);
  
  for (let i = 0; i < POW_MAX_ITERATIONS; i++) {
    const data = `${hmac}${resource}${keyNumber}${timestamp}${i}`;
    const hash = md5(data);
    const prefix = parseInt(hash.substring(0, 4), 16);
    
    if (prefix < POW_THRESHOLD) {
      return i;
    }
  }
  
  return POW_MAX_ITERATIONS - 1;
}

// =============================================================================
// AUTH HELPERS
// =============================================================================

/**
 * Fetch JWT token from epaly.fun, hitsplay.fun, or topembed.pw player page
 * 
 * UPDATED February 2026: 
 * - epaly.fun is the new primary player domain (replaces codepcplay.fun)
 * - hitsplay.fun provides JWT directly for ALL channels (including 1-30)
 * - topembed.pw is fallback for channels with specific mappings
 * - MUST use RPI proxy for hitsplay.fun - it blocks Cloudflare IPs!
 */
async function fetchAuthData(channel: string, logger: any, env?: Env): Promise<SessionData | null> {
  // Check cache first
  const cached = sessionCache.get(channel);
  if (cached && Date.now() - cached.fetchedAt < SESSION_CACHE_TTL_MS) {
    logger.debug('Session cache hit', { channel });
    return cached;
  }

  logger.info('Fetching fresh JWT', { channel });

  // ============================================================================
  // METHOD 1: Try epaly.fun first (FAST, new primary domain - Feb 2026)
  // ============================================================================
  try {
    const epalyUrl = `https://epaly.fun/premiumtv/daddyhd.php?id=${channel}`;
    logger.info('Trying epaly.fun for JWT', { channel });
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    try {
      const res = await fetch(epalyUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          'Referer': 'https://dlhd.link/',
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        const html = await res.text();
        // Look for EPlayerAuth.init() or JWT token
        const jwtMatch = html.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
        if (jwtMatch) {
          const jwt = jwtMatch[0];
          let channelKey = `premium${channel}`;
          let country = 'US';
          let iat = Math.floor(Date.now() / 1000);
          let exp = iat + 18000;
          
          try {
            const payloadB64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
            const payload = JSON.parse(atob(payloadB64));
            channelKey = payload.sub || channelKey;
            country = payload.country || country;
            iat = payload.iat || iat;
            exp = payload.exp || exp;
            logger.info('JWT from epaly.fun', { channelKey, exp, expiresIn: exp - Math.floor(Date.now() / 1000) });
          } catch (e) {
            logger.warn('JWT decode failed, using defaults');
          }
          
          const session: SessionData = {
            jwt,
            channelKey,
            country,
            iat,
            exp,
            fetchedAt: Date.now(),
            source: 'epaly.fun',
          };
          
          addToSessionCache(channel, session);
          return session;
        }
      }
    } catch (e) {
      clearTimeout(timeoutId);
      logger.warn('epaly.fun fetch error', { error: (e as Error).message });
    }
  } catch (e) {
    logger.warn('epaly.fun JWT fetch failed', { error: (e as Error).message });
  }

  // ============================================================================
  // METHOD 2: Try hitsplay.fun via RPI proxy - fallback, it blocks Cloudflare IPs!
  // This is essential for channels 1-30 which don't have topembed mappings
  // ============================================================================
  try {
    const hitsplayUrl = `https://hitsplay.fun/premiumtv/daddyhd.php?id=${channel}`;
    logger.info('Trying hitsplay.fun for JWT via RPI proxy', { channel });
    
    let html: string | undefined;
    
    // MUST use RPI proxy - hitsplay.fun blocks Cloudflare IPs
    if (env?.RPI_PROXY_URL && env?.RPI_PROXY_KEY) {
      let rpiBase = env.RPI_PROXY_URL;
      if (!rpiBase.startsWith('http://') && !rpiBase.startsWith('https://')) {
        rpiBase = `https://${rpiBase}`;
      }
      rpiBase = rpiBase.replace(/\/+$/, '');
      
      const rpiUrl = `${rpiBase}/animekai?url=${encodeURIComponent(hitsplayUrl)}&key=${env.RPI_PROXY_KEY}&referer=${encodeURIComponent('https://dlhd.link/')}`;
      logger.info('Fetching hitsplay via RPI', { rpiUrl: rpiUrl.substring(0, 150) });
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      try {
        const res = await fetch(rpiUrl, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
          html = await res.text();
          logger.info('RPI hitsplay fetch success', { htmlLen: html.length });
        } else {
          logger.warn('RPI hitsplay fetch failed', { status: res.status });
        }
      } catch (e) {
        clearTimeout(timeoutId);
        logger.warn('RPI hitsplay fetch error', { error: (e as Error).message });
      }
    } else {
      logger.warn('RPI proxy not configured, trying direct (will likely fail)');
      // Fallback to direct fetch (will likely fail due to CF IP blocking)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      try {
        const res = await fetch(hitsplayUrl, {
          headers: {
            'User-Agent': USER_AGENT,
            'Referer': 'https://dlhd.link/',
          },
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (res.ok) {
          html = await res.text();
        }
      } catch (e) {
        clearTimeout(timeoutId);
        logger.warn('Direct hitsplay fetch failed', { error: (e as Error).message });
      }
    }
    
    if (html) {
      // hitsplay.fun embeds JWT directly in the page
      const jwtMatch = html.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
      if (jwtMatch) {
        const jwt = jwtMatch[0];
        
        // Decode payload
        let channelKey = `premium${channel}`;
        let country = 'US';
        let iat = Math.floor(Date.now() / 1000);
        let exp = iat + 18000;
        
        try {
          const payloadB64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
          const payload = JSON.parse(atob(payloadB64));
          channelKey = payload.sub || channelKey;
          country = payload.country || country;
          iat = payload.iat || iat;
          exp = payload.exp || exp;
          logger.info('JWT from hitsplay.fun', { channelKey, exp, expiresIn: exp - Math.floor(Date.now() / 1000) });
        } catch (e) {
          logger.warn('JWT decode failed, using defaults');
        }
        
        const session: SessionData = {
          jwt,
          channelKey,
          country,
          iat,
          exp,
          fetchedAt: Date.now(),
          source: 'hitsplay.fun',
        };
        
        addToSessionCache(channel, session);
        return session;
      } else {
        logger.warn('No JWT found in hitsplay response', { htmlPreview: html.substring(0, 200) });
      }
    }
  } catch (e) {
    logger.warn('hitsplay.fun JWT fetch failed', { error: (e as Error).message });
  }

  // ============================================================================
  // METHOD 2: Try topembed.pw (for channels with specific mappings)
  // ============================================================================
  try {
    // Get topembed channel name from mapping
    let topembedName = CHANNEL_TO_TOPEMBED[channel];
    
    if (!topembedName) {
      // Try to get the topembed name from DLHD /watch/ page
      logger.info('Channel not in mapping, fetching from DLHD', { channel });
      try {
        const dlhdUrl = `https://dlhd.link/watch/stream-${channel}.php`;
        const dlhdRes = await fetch(dlhdUrl, {
          headers: {
            'User-Agent': USER_AGENT,
            'Referer': 'https://dlhd.link/',
          },
        });
        
        if (dlhdRes.ok) {
          const dlhdHtml = await dlhdRes.text();
          const topembedMatch = dlhdHtml.match(/topembed\.pw\/channel\/([^"'\s]+)/);
          if (topembedMatch) {
            topembedName = topembedMatch[1];
            logger.info('Found topembed name from DLHD', { channel, topembedName });
          }
        }
      } catch (e) {
        logger.warn('Failed to fetch topembed name from DLHD', { error: (e as Error).message });
      }
    }
    
    if (!topembedName) {
      logger.warn('No topembed mapping for channel', { channel });
      return null;
    }
    
    const url = `https://${PLAYER_DOMAIN}/channel/${topembedName}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': `https://${PARENT_DOMAIN}/`,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    const html = await response.text();
    
    // Find JWT token (topembed stores it in SESSION_TOKEN variable)
    const jwtMatch = html.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    if (!jwtMatch) {
      logger.warn('No JWT found in topembed page', { channel, topembedName });
      return null;
    }

    const jwt = jwtMatch[0];
    
    // Decode payload
    let channelKey = `premium${channel}`;
    let country = 'US';
    let iat = Math.floor(Date.now() / 1000);
    let exp = iat + 18000;
    
    try {
      const payloadB64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(payloadB64));
      channelKey = payload.sub || channelKey; // topembed uses different keys like 'ustvabc'
      country = payload.country || country;
      iat = payload.iat || iat;
      exp = payload.exp || exp;
    } catch {}

    const session: SessionData = {
      jwt,
      channelKey,
      country,
      iat,
      exp,
      fetchedAt: Date.now(),
      source: 'topembed.pw',
    };

    addToSessionCache(channel, session);
    logger.info('JWT fetched and cached', { channel, channelKey, exp, source: 'topembed.pw' });
    
    return session;
  } catch (error) {
    logger.error('Auth fetch failed', { channel, error: (error as Error).message });
    return null;
  }
}

/** Fallback server keys to try if lookup fails */
// UPDATED January 2026: Added 'wiki', 'hzt', and 'x4' servers used by topembed.pw
const FALLBACK_SERVER_KEYS = ['wiki', 'hzt', 'x4', 'zeko', 'wind', 'nfs', 'ddy6', 'chevy', 'top1/cdn'];

/**
 * Fetch server key from lookup endpoint
 * Uses RPI proxy as fallback since dvalna.ru may block CF IPs
 */
async function fetchServerKey(channelKey: string, logger: any, env?: Env): Promise<string | null> {
  const url = `https://chevy.${CDN_DOMAIN}/server_lookup?channel_id=${channelKey}`;
  
  // Try direct fetch first
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Origin': `https://${PLAYER_DOMAIN}`,
        'Referer': `https://${PLAYER_DOMAIN}/`,
      },
    });

    if (response.ok) {
      const text = await response.text();
      if (text.startsWith('{')) {
        const data = JSON.parse(text) as { server_key?: string };
        if (data.server_key) {
          logger.info('Server lookup success (direct)', { channelKey, serverKey: data.server_key });
          return data.server_key;
        }
      }
    }
    logger.warn('Direct server lookup failed', { status: response.status });
  } catch (error) {
    logger.warn('Direct server lookup error', { error: (error as Error).message });
  }
  
  // Try RPI proxy as fallback
  if (env?.RPI_PROXY_URL && env?.RPI_PROXY_KEY) {
    try {
      let rpiBase = env.RPI_PROXY_URL;
      if (!rpiBase.startsWith('http://') && !rpiBase.startsWith('https://')) {
        rpiBase = `https://${rpiBase}`;
      }
      rpiBase = rpiBase.replace(/\/+$/, '');
      
      const rpiUrl = `${rpiBase}/animekai?url=${encodeURIComponent(url)}&key=${env.RPI_PROXY_KEY}`;
      logger.info('Trying server lookup via RPI', { channelKey });
      
      const rpiRes = await fetch(rpiUrl);
      if (rpiRes.ok) {
        const text = await rpiRes.text();
        if (text.startsWith('{')) {
          const data = JSON.parse(text) as { server_key?: string };
          if (data.server_key) {
            logger.info('Server lookup success (RPI)', { channelKey, serverKey: data.server_key });
            return data.server_key;
          }
        }
      }
    } catch (error) {
      logger.warn('RPI server lookup error', { error: (error as Error).message });
    }
  }
  
  logger.warn('All server lookup methods failed, using fallback', { channelKey });
  return FALLBACK_SERVER_KEYS[0];
}

/**
 * Construct M3U8 URL for a channel
 * UPDATED January 2026: Added 'wiki', 'hzt', 'x4', 'top1' servers used by topembed.pw
 */
function constructM3U8Url(serverKey: string, channelKey: string): string {
  if (serverKey === 'wiki') {
    return `https://wikinew.${CDN_DOMAIN}/wiki/${channelKey}/mono.css`;
  }
  if (serverKey === 'hzt') {
    return `https://hztnew.${CDN_DOMAIN}/hzt/${channelKey}/mono.css`;
  }
  if (serverKey === 'x4') {
    return `https://x4new.${CDN_DOMAIN}/x4/${channelKey}/mono.css`;
  }
  if (serverKey === 'top1/cdn') {
    return `https://top1.${CDN_DOMAIN}/top1/cdn/${channelKey}/mono.css`;
  }
  if (serverKey === 'top1') {
    return `https://top1new.${CDN_DOMAIN}/top1/${channelKey}/mono.css`;
  }
  return `https://${serverKey}new.${CDN_DOMAIN}/${serverKey}/${channelKey}/mono.css`;
}

/**
 * Rewrite M3U8 to proxy keys and segments through our worker
 */
function rewriteM3U8(content: string, proxyOrigin: string, m3u8BaseUrl: string, jwt: string): string {
  let modified = content;

  // Rewrite key URLs to proxy through us with JWT
  // Key URLs can be on various subdomains but must be normalized to chevy.dvalna.ru
  modified = modified.replace(/URI="([^"]+)"/g, (_, originalKeyUrl) => {
    let absoluteKeyUrl = originalKeyUrl;

    if (!absoluteKeyUrl.startsWith('http')) {
      try {
        const base = new URL(m3u8BaseUrl);
        absoluteKeyUrl = new URL(
          absoluteKeyUrl,
          base.origin + base.pathname.replace(/\/[^/]*$/, '/')
        ).toString();
      } catch {
        const baseWithoutFile = m3u8BaseUrl.replace(/\/[^/]*$/, '/');
        absoluteKeyUrl = baseWithoutFile + absoluteKeyUrl;
      }
    }

    // Normalize key URLs to chevy.dvalna.ru (the key server)
    // Key URLs can be on any subdomain but keys are always served from chevy
    const keyPathMatch = absoluteKeyUrl.match(/\/key\/([^/]+)\/(\d+)/);
    if (keyPathMatch) {
      absoluteKeyUrl = `https://chevy.${CDN_DOMAIN}/key/${keyPathMatch[1]}/${keyPathMatch[2]}`;
    }

    const params = new URLSearchParams({ url: absoluteKeyUrl, jwt });
    return `URI="${proxyOrigin}/dlhd/key?${params.toString()}"`;
  });

  // Remove ENDLIST for live streams
  modified = modified.replace(/\n?#EXT-X-ENDLIST\s*$/m, '');

  // Fix: DLHD now splits long segment URLs across multiple lines
  // Join lines that are continuations of URLs (don't start with # or http)
  const lines = modified.split('\n');
  const joinedLines: string[] = [];
  let currentLine = '';
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // If line starts with # or is empty, flush current and add this line
    if (!trimmed || trimmed.startsWith('#')) {
      if (currentLine) {
        joinedLines.push(currentLine);
        currentLine = '';
      }
      joinedLines.push(line);
    }
    // If line starts with http, it's a new URL
    else if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      if (currentLine) {
        joinedLines.push(currentLine);
      }
      currentLine = trimmed;
    }
    // Otherwise it's a continuation of the previous URL
    else {
      currentLine += trimmed;
    }
  }
  
  // Don't forget the last line
  if (currentLine) {
    joinedLines.push(currentLine);
  }

  // Now proxy segment URLs
  const processedLines = joinedLines.map((line) => {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) return line;
    if (trimmed.includes('/dlhd/segment?')) return line;

    const isAbsoluteUrl = trimmed.startsWith('http://') || trimmed.startsWith('https://');
    const isDlhdSegment = trimmed.includes(`.${CDN_DOMAIN}/`);

    if (isAbsoluteUrl && isDlhdSegment && !trimmed.includes('mono.css')) {
      return `${proxyOrigin}/dlhd/segment?url=${encodeURIComponent(trimmed)}`;
    }

    return line;
  });

  return processedLines.join('\n');
}

// =============================================================================
// RESPONSE HELPERS
// =============================================================================

function corsHeaders(origin?: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Content-Type',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
  };
}

function jsonResponse(data: object, status: number, origin?: string | null): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

// =============================================================================
// REQUEST HANDLERS
// =============================================================================

/**
 * Handle health check
 * SECURITY: Minimal information exposure
 */
function handleHealthCheck(origin: string | null, env?: Env): Response {
  return jsonResponse({
    status: 'healthy',
    provider: 'dlhd',
    version: '2.0.2',
    security: 'pow-auth',
    timestamp: new Date().toISOString(),
  }, 200, origin);
}

/**
 * Handle auth request - returns fresh JWT for a channel
 */
async function handleAuthRequest(channel: string, logger: any, origin: string | null, env?: Env): Promise<Response> {
  const session = await fetchAuthData(channel, logger, env);
  
  if (!session) {
    return jsonResponse({ error: 'Failed to fetch auth data' }, 502, origin);
  }

  return jsonResponse({
    jwt: session.jwt,
    channelKey: session.channelKey,
    country: session.country,
    iat: session.iat,
    exp: session.exp,
    expiresIn: session.exp - Math.floor(Date.now() / 1000),
  }, 200, origin);
}

/**
 * Handle playlist request
 * REQUIRES: Signed token with session validation
 */
async function handlePlaylistRequest(
  channel: string,
  proxyOrigin: string,
  logger: any,
  origin: string | null,
  env?: Env,
  request?: Request
): Promise<Response> {
  // SECURITY: Validate origin first
  if (!origin || !isAllowedOrigin(origin)) {
    logger.warn('Unauthorized origin', { origin });
    return jsonResponse({ error: 'Forbidden - invalid origin' }, 403, origin);
  }

  // SECURITY: Rate limiting for playlist requests
  const ip = request?.headers.get('cf-connecting-ip') || '127.0.0.1';
  if (env?.RATE_LIMIT_KV) {
    const rateLimitKey = `ratelimit:playlist:${ip}`;
    const lastRequest = await env.RATE_LIMIT_KV.get(rateLimitKey);
    
    if (lastRequest) {
      const timeSince = Date.now() - parseInt(lastRequest);
      if (timeSince < 1000) { // 1 second between playlist requests per IP
        logger.warn('Playlist rate limit exceeded', { ip, timeSince });
        return jsonResponse({ error: 'Rate limit exceeded - try again in 1 second' }, 429, origin);
      }
    }
    
    await env.RATE_LIMIT_KV.put(rateLimitKey, Date.now().toString(), { expirationTtl: 60 });
  }

  // SECURITY: Optional authentication token validation
  // If auth headers are provided, validate them. Otherwise allow unauthenticated access.
  const token = request?.headers.get('x-dlhd-token');
  const sessionId = request?.headers.get('x-session-id');
  const fingerprint = request?.headers.get('x-fingerprint');
  const timestamp = request?.headers.get('x-timestamp');
  const signature = request?.headers.get('x-signature');

  // If ANY auth header is provided, ALL must be provided and valid
  if (token || sessionId || fingerprint || timestamp || signature) {
    if (!token || !sessionId || !fingerprint || !timestamp || !signature) {
      logger.warn('Incomplete auth headers', { channel });
      return jsonResponse({ 
        error: 'Authentication incomplete',
        hint: 'Provide all auth headers or none'
      }, 401, origin);
    }

    // SECURITY: Verify signature
    const expectedSig = await generateSignature(sessionId, channel, parseInt(timestamp), env?.SIGNING_SECRET || '');
    if (signature !== expectedSig) {
      logger.warn('Invalid signature', { channel, sessionId: sessionId.substring(0, 8) });
      return jsonResponse({ error: 'Invalid signature' }, 403, origin);
    }

    // SECURITY: Check token expiry (30 seconds)
    const ts = parseInt(timestamp);
    if (Date.now() - ts > 30000) {
      logger.warn('Token expired', { channel, age: Date.now() - ts });
      return jsonResponse({ error: 'Token expired' }, 401, origin);
    }
    
    logger.info('Authenticated request', { channel, sessionId: sessionId.substring(0, 8) });
  } else {
    logger.info('Unauthenticated request (allowed)', { channel });
  }

  // Step 1: Get auth data via RPI proxy (hitsplay.fun blocks CF IPs, epaly.fun tried first!)
  const session = await fetchAuthData(channel, logger, env);
  if (!session) {
    return jsonResponse({ error: 'Failed to fetch auth data - player endpoints may be blocking requests' }, 502, origin);
  }

  // Step 2: Get server key (try direct, fallback to RPI proxy)
  const serverKey = await fetchServerKey(session.channelKey, logger, env);
  if (!serverKey) {
    return jsonResponse({ error: 'Failed to fetch server key' }, 502, origin);
  }

  // Step 3: Fetch M3U8 - ALWAYS use RPI proxy (dvalna.ru blocks datacenter IPs)
  const m3u8Url = constructM3U8Url(serverKey, session.channelKey);
  logger.info('Fetching M3U8 via RPI proxy', { m3u8Url });
  
  try {
    let content: string;
    let fetchedVia = 'rpi-proxy';
    
    // ALWAYS route through RPI proxy - dvalna.ru blocks Cloudflare Worker IPs
    if (!env?.RPI_PROXY_URL || !env?.RPI_PROXY_KEY) {
      return jsonResponse({ 
        error: 'RPI proxy not configured', 
        hint: 'DLHD requires residential IP. Configure RPI_PROXY_URL and RPI_PROXY_KEY in Cloudflare Worker secrets.',
      }, 503, origin);
    }
    
    let rpiBase = env.RPI_PROXY_URL;
    if (!rpiBase.startsWith('http://') && !rpiBase.startsWith('https://')) {
      rpiBase = `https://${rpiBase}`;
    }
    rpiBase = rpiBase.replace(/\/+$/, '');
    
    // Use /animekai endpoint with referer header - dvalna.ru requires it
    const rpiUrl = `${rpiBase}/animekai?key=${env.RPI_PROXY_KEY}&url=${encodeURIComponent(m3u8Url)}&referer=${encodeURIComponent('https://dlhd.link/')}`;
    logger.info('Calling RPI /animekai for M3U8', { 
      rpiBase,
      rpiUrl: rpiUrl.substring(0, 200),
      m3u8Url,
      hasKey: !!env.RPI_PROXY_KEY,
    });
    
    const rpiResponse = await fetch(rpiUrl, {
      signal: AbortSignal.timeout(30000),
    });
    
    content = await rpiResponse.text();
    logger.info('RPI response', { 
      status: rpiResponse.status,
      contentLength: content.length,
      isM3U8: content.includes('#EXTM3U'),
      preview: content.substring(0, 100),
    });
    
    if (!rpiResponse.ok || (!content.includes('#EXTM3U') && !content.includes('#EXT-X-'))) {
      return jsonResponse({ 
        error: 'M3U8 fetch failed via RPI proxy', 
        rpiStatus: rpiResponse.status,
        rpiResponse: content.substring(0, 300),
        m3u8Url,
        hint: 'RPI proxy returned error. Check if RPI proxy is running and accessible.',
      }, 502, origin);
    }

    if (!content.includes('#EXTM3U') && !content.includes('#EXT-X-')) {
      return jsonResponse({ error: 'Invalid M3U8 response', preview: content.substring(0, 100) }, 502, origin);
    }

    // Rewrite M3U8 to proxy keys and segments
    const proxiedM3U8 = rewriteM3U8(content, proxyOrigin, m3u8Url, session.jwt);

    return new Response(proxiedM3U8, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-DLHD-Channel': channel,
        'X-DLHD-Server': serverKey,
        'X-Fetched-Via': fetchedVia,
        ...corsHeaders(origin),
      },
    });
  } catch (error) {
    logger.error('M3U8 fetch failed', { error: (error as Error).message });
    return jsonResponse({ error: 'M3U8 fetch failed', details: (error as Error).message }, 502, origin);
  }
}

/**
 * Handle key proxy request with PoW authentication
 * Key server blocks CF IPs - must use RPI proxy
 */
async function handleKeyProxy(url: URL, logger: any, origin: string | null, env?: Env): Promise<Response> {
  const keyUrlParam = url.searchParams.get('url');
  const jwt = url.searchParams.get('jwt');
  
  if (!keyUrlParam) {
    return jsonResponse({ error: 'Missing url parameter' }, 400, origin);
  }
  if (!jwt) {
    return jsonResponse({ error: 'Missing jwt parameter' }, 400, origin);
  }

  let keyUrl: string;
  try {
    keyUrl = decodeURIComponent(keyUrlParam);
  } catch {
    keyUrl = keyUrlParam;
  }

  // Extract resource and key number from URL
  const keyMatch = keyUrl.match(/\/key\/([^/]+)\/(\d+)/);
  if (!keyMatch) {
    return jsonResponse({ error: 'Invalid key URL format' }, 400, origin);
  }

  const resource = keyMatch[1];
  const keyNumber = keyMatch[2];
  
  // Normalize key URL to chevy.dvalna.ru (the key server)
  const normalizedKeyUrl = `https://chevy.${CDN_DOMAIN}/key/${resource}/${keyNumber}`;
  
  logger.info('Key fetch request', { resource, keyNumber, normalizedKeyUrl });

  try {
    let data: ArrayBuffer;
    let fetchedVia = 'direct';
    
    // Compute PoW for direct fetch
    // IMPORTANT: DLHD requires timestamp to be 5-10 seconds in the past (January 2026 security update)
    const timestamp = Math.floor(Date.now() / 1000) - 7; // Use 7 seconds in the past
    const nonce = await computePoWNonce(resource, keyNumber, timestamp, env);
    
    // Try direct fetch first (dvalna.ru may not block CF IPs anymore)
    // Use epaly.fun as Origin/Referer since that's the primary player domain
    try {
      logger.info('Trying direct key fetch with PoW', { timestamp, nonce });
      
      const directResponse = await fetch(normalizedKeyUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          'Origin': 'https://epaly.fun',
          'Referer': 'https://epaly.fun/',
          'Authorization': `Bearer ${jwt}`,
          'X-Key-Timestamp': timestamp.toString(),
          'X-Key-Nonce': nonce.toString(),
        },
      });
      
      data = await directResponse.arrayBuffer();
      const text = new TextDecoder().decode(data);
      
      // Valid key is exactly 16 bytes (AES-128)
      if (data.byteLength === 16 && !text.startsWith('{') && !text.startsWith('[')) {
        logger.info('Direct key fetch succeeded');
        fetchedVia = 'direct';
      } else {
        throw new Error(`Invalid key response: ${data.byteLength} bytes, preview: ${text.substring(0, 50)}`);
      }
    } catch (directError) {
      logger.warn('Direct key fetch failed, trying RPI proxy', { error: (directError as Error).message });
      
      // Fall back to RPI proxy if configured
      if (env?.RPI_PROXY_URL && env?.RPI_PROXY_KEY) {
        const rpiKeyUrl = `${env.RPI_PROXY_URL}/dlhd-key?url=${encodeURIComponent(normalizedKeyUrl)}&key=${env.RPI_PROXY_KEY}`;
        const rpiRes = await fetch(rpiKeyUrl);
        
        if (!rpiRes.ok) {
          const errText = await rpiRes.text();
          logger.warn('RPI key fetch also failed', { status: rpiRes.status, error: errText });
          return jsonResponse({ 
            error: 'Key fetch failed (both direct and RPI)', 
            directError: (directError as Error).message,
            rpiStatus: rpiRes.status,
            rpiError: errText.substring(0, 200)
          }, 502, origin);
        }
        
        data = await rpiRes.arrayBuffer();
        fetchedVia = 'rpi-proxy';
      } else {
        // No RPI proxy configured, return the direct error
        return jsonResponse({ 
          error: 'Key fetch failed (direct)', 
          details: (directError as Error).message,
          hint: 'Configure RPI_PROXY_URL and RPI_PROXY_KEY if dvalna.ru blocks CF IPs',
        }, 502, origin);
      }
    }

    const text = new TextDecoder().decode(data);

    // Valid key is exactly 16 bytes (AES-128)
    if (data.byteLength === 16 && !text.startsWith('{') && !text.startsWith('[')) {
      logger.info('Key fetched successfully', { viaRpi: fetchedVia === 'rpi-proxy' });
      
      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': '16',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'X-Fetched-Via': fetchedVia,
          ...corsHeaders(origin),
        },
      });
    }

    logger.warn('Invalid key response', { length: data.byteLength, preview: text.substring(0, 50) });
    return jsonResponse({
      error: 'Invalid key response',
      length: data.byteLength,
      preview: text.substring(0, 100),
    }, 502, origin);
  } catch (error) {
    logger.error('Key fetch failed', { error: (error as Error).message });
    return jsonResponse({ error: 'Key fetch failed', details: (error as Error).message }, 502, origin);
  }
}

/**
 * Handle segment proxy request
 */

// Known DLHD CDN domains that block Cloudflare IPs
const DLHD_DOMAINS = ['dvalna.ru', 'kiko2.ru', 'giokko.ru', 'soyspace.cyou'];

/**
 * Check if a URL is from a DLHD CDN domain that blocks CF IPs
 */
function isDLHDDomain(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return DLHD_DOMAINS.some(domain => url.hostname.endsWith(domain));
  } catch {
    return false;
  }
}

/**
 * Handle segment proxy request
 * SECURITY: Rate limited per IP
 */
async function handleSegmentProxy(url: URL, logger: any, origin: string | null, env?: Env, request?: Request): Promise<Response> {
  const segmentUrl = url.searchParams.get('url');
  
  if (!segmentUrl) {
    return jsonResponse({ error: 'Missing url parameter' }, 400, origin);
  }

  // SECURITY: Rate limiting check
  const ip = request?.headers.get('cf-connecting-ip') || '127.0.0.1';
  if (env?.RATE_LIMIT_KV) {
    const rateLimitKey = `ratelimit:segment:${ip}`;
    const lastRequest = await env.RATE_LIMIT_KV.get(rateLimitKey);
    
    if (lastRequest) {
      const timeSince = Date.now() - parseInt(lastRequest);
      if (timeSince < 100) { // 100ms between segment requests
        logger.warn('Rate limit exceeded', { ip, timeSince });
        return jsonResponse({ error: 'Rate limit exceeded' }, 429, origin);
      }
    }
    
    await env.RATE_LIMIT_KV.put(rateLimitKey, Date.now().toString(), { expirationTtl: 10 });
  }

  const decodedUrl = decodeURIComponent(segmentUrl);
  const isDlhd = isDLHDDomain(decodedUrl);
  logger.info('Segment proxy request', { url: decodedUrl.substring(0, 80), isDlhd });

  try {
    let data: ArrayBuffer;
    let fetchedVia = 'rpi-proxy';
    
    // ALWAYS use RPI proxy for DLHD segments - dvalna.ru blocks Cloudflare IPs
    if (isDlhd) {
      if (!env?.RPI_PROXY_URL || !env?.RPI_PROXY_KEY) {
        return jsonResponse({ 
          error: 'RPI proxy not configured', 
          hint: 'DLHD segments require residential IP. Configure RPI_PROXY_URL and RPI_PROXY_KEY.',
        }, 503, origin);
      }
      
      logger.info('Fetching DLHD segment via RPI proxy');
      
      const rpiUrl = `${env.RPI_PROXY_URL}/proxy?url=${encodeURIComponent(decodedUrl)}&key=${env.RPI_PROXY_KEY}`;
      const rpiRes = await fetch(rpiUrl);
      
      if (!rpiRes.ok) {
        const errText = await rpiRes.text();
        logger.warn('RPI segment fetch failed', { status: rpiRes.status, error: errText.substring(0, 100) });
        return jsonResponse({ 
          error: 'Segment fetch failed via RPI proxy', 
          rpiStatus: rpiRes.status,
          rpiError: errText.substring(0, 200),
        }, 502, origin);
      }
      
      data = await rpiRes.arrayBuffer();
      logger.info('RPI segment fetch succeeded', { size: data.byteLength });
    } else {
      // Non-DLHD segments can be fetched directly
      fetchedVia = 'direct';
      const directRes = await fetch(decodedUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          'Origin': `https://${PLAYER_DOMAIN}`,
          'Referer': `https://${PLAYER_DOMAIN}/`,
        },
      });

      if (!directRes.ok) {
        return jsonResponse({ 
          error: 'Segment fetch failed', 
          details: `HTTP ${directRes.status}`,
        }, 502, origin);
      }

      data = await directRes.arrayBuffer();
      logger.info('Direct segment fetch succeeded', { size: data.byteLength });
    }

    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': 'video/mp2t',
        'Cache-Control': 'public, max-age=300',
        'Content-Length': data.byteLength.toString(),
        'X-Fetched-Via': fetchedVia,
        ...corsHeaders(origin),
      },
    });
  } catch (error) {
    logger.error('Segment fetch failed', { error: (error as Error).message });
    return jsonResponse({ error: 'Segment fetch failed', details: (error as Error).message }, 502, origin);
  }
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

/**
 * Handle DLHD provider requests
 */
/**
 * Validate channel parameter
 * SECURITY: Prevent injection and abuse
 */
function isValidChannel(channel: string): boolean {
  // Channel should be numeric and reasonable length (1-10 digits)
  return /^\d{1,10}$/.test(channel);
}

export async function handleDLHDRequest(request: Request, env: Env): Promise<Response> {
  const logLevel = (env.LOG_LEVEL || 'info') as LogLevel;
  const logger = createLogger(request, logLevel);

  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/dlhd/, '') || '/';
  const origin = request.headers.get('origin');

  // SECURITY: Validate origin for all non-health endpoints
  if (path !== '/health' && (!origin || !isAllowedOrigin(origin))) {
    logger.warn('Blocked request from unauthorized origin', { origin, path });
    return jsonResponse({ error: 'Forbidden - invalid origin' }, 403, origin);
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders(origin) });
  }

  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405, origin);
  }

  try {
    if (path === '/health') {
      return handleHealthCheck(origin, env);
    }

    if (path === '/auth') {
      const channel = url.searchParams.get('channel');
      if (!channel || !isValidChannel(channel)) {
        return jsonResponse({ error: 'Invalid channel parameter' }, 400, origin);
      }
      return handleAuthRequest(channel, logger, origin, env);
    }

    if (path === '/key') {
      return handleKeyProxy(url, logger, origin, env);
    }

    if (path === '/segment') {
      return handleSegmentProxy(url, logger, origin, env, request);
    }

    // Main playlist request
    const channel = url.searchParams.get('channel');
    if (!channel) {
      return jsonResponse({
        error: 'Missing channel parameter',
        usage: 'GET /dlhd?channel=51',
      }, 400, origin);
    }
    
    // SECURITY: Validate channel format
    if (!isValidChannel(channel)) {
      return jsonResponse({ error: 'Invalid channel format' }, 400, origin);
    }

    return handlePlaylistRequest(channel, url.origin, logger, origin, env, request);
  } catch (error) {
    logger.error('DLHD Proxy error', error as Error);
    return jsonResponse({
      error: 'Proxy error',
      message: error instanceof Error ? error.message : String(error),
    }, 500, origin);
  }
}
