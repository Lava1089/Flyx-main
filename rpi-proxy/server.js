#!/usr/bin/env node
/**
 * Raspberry Pi Simple Proxy Server
 * 
 * A minimal residential IP proxy for DLHD keys and m3u8 playlists.
 * Now uses Authorization header for key requests (discovered via reverse engineering).
 * 
 * Key Discovery:
 *   - DLHD key server requires: Authorization: Bearer <token>
 *   - Token is generated server-side and embedded in player page
 *   - Token is fetched from: https://epicplayplay.cfd/premiumtv/daddyhd.php?id=<channel>
 * 
 * Setup:
 *   1. Copy this folder to your Raspberry Pi
 *   2. Set API_KEY environment variable
 *   3. Run: node server.js
 *   4. Use Cloudflare Tunnel or ngrok to expose it
 * 
 * Usage:
 *   GET /proxy?url=<encoded_url>
 *   Header: X-API-Key: your-secret-key
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const net = require('net');
const tls = require('tls');
const { URL } = require('url');

// ============================================================================
// SOCKS5 PROXY POOL MANAGER
// Automatically fetches, validates, and maintains a pool of working SOCKS5 proxies
// Used by /fetch-socks5 endpoint to tunnel requests through non-banned IPs
// ============================================================================

const PROXY_POOL = {
  validated: [],       // Array of { host, port, lastValidated, failures }
  validating: false,   // Lock to prevent concurrent validation runs
  lastRefresh: 0,      // Timestamp of last full refresh
  totalFetched: 0,     // Stats: total proxies fetched from lists
  totalValidated: 0,   // Stats: total proxies that passed validation
  totalFailed: 0,      // Stats: total proxies that failed validation
  roundRobinIndex: 0,  // Round-robin index for proxy selection
};

const PROXY_POOL_CONFIG = {
  minPoolSize: 100,
  refreshIntervalMs: 10 * 60 * 1000, // 10 minutes
  validationTimeoutMs: 6000,
  maxConcurrentValidations: 50,
  // GitHub proxy list sources
  sources: [
    'https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/socks5/data.txt',
    'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt',
    'https://raw.githubusercontent.com/officialputuid/KangProxy/KangProxy/socks5/socks5.txt',
  ],
};

// Hardcoded fallback proxies (known working as of Feb 7 2026)
const FALLBACK_SOCKS5_PROXIES = [
  '192.111.129.145:16894', '184.178.172.5:15303', '98.181.137.80:4145',
  '192.252.210.233:4145', '68.71.245.206:4145', '142.54.228.193:4145',
  '199.58.184.97:4145', '192.252.214.20:15864', '184.178.172.25:15291',
  '70.166.167.38:57728', '198.177.252.24:4145', '174.77.111.196:4145',
  '184.181.217.213:4145', '192.252.208.67:14287', '184.170.251.30:11288',
  '174.75.211.193:4145', '199.187.210.54:4145', '192.111.134.10:4145',
  '24.249.199.12:4145', '69.61.200.104:36181',
];

/**
 * Fetch proxy lists from all GitHub sources
 * Returns deduplicated array of "host:port" strings
 */
async function fetchProxyLists() {
  const allProxies = new Set();
  
  for (const sourceUrl of PROXY_POOL_CONFIG.sources) {
    try {
      const resp = await fetch(sourceUrl, { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) {
        console.log(`[ProxyPool] Failed to fetch ${sourceUrl}: ${resp.status}`);
        continue;
      }
      const text = await resp.text();
      const lines = text.split('\n').map(l => l.trim()).filter(l => /^\d+\.\d+\.\d+\.\d+:\d+$/.test(l));
      for (const line of lines) allProxies.add(line);
      console.log(`[ProxyPool] Fetched ${lines.length} proxies from ${sourceUrl.split('/')[4] || sourceUrl.substring(0, 60)}`);
    } catch (e) {
      console.log(`[ProxyPool] Error fetching ${sourceUrl.substring(0, 60)}: ${e.message}`);
    }
  }
  
  // Always include fallback proxies
  for (const p of FALLBACK_SOCKS5_PROXIES) allProxies.add(p);
  
  console.log(`[ProxyPool] Total unique proxies: ${allProxies.size}`);
  PROXY_POOL.totalFetched = allProxies.size;
  return Array.from(allProxies);
}

/**
 * Validate a single SOCKS5 proxy by connecting through it to cloudnestra.com
 * (the actual target we need these proxies for).
 * Just checks TCP+TLS connectivity — any HTTP response means the proxy works.
 */
function validateSocks5Proxy(proxyStr) {
  return new Promise((resolve) => {
    const [proxyHost, proxyPortStr] = proxyStr.split(':');
    const proxyPort = parseInt(proxyPortStr);
    const targetHost = 'cloudnestra.com';
    const targetPort = 443;
    
    const timer = setTimeout(() => {
      resolve(false);
    }, PROXY_POOL_CONFIG.validationTimeoutMs);
    
    try {
      const socket = net.connect(proxyPort, proxyHost, () => {
        socket.write(Buffer.from([0x05, 0x01, 0x00]));
      });
      
      let step = 'greeting';
      
      socket.on('error', () => { clearTimeout(timer); socket.destroy(); resolve(false); });
      socket.setTimeout(PROXY_POOL_CONFIG.validationTimeoutMs - 500, () => { socket.destroy(); clearTimeout(timer); resolve(false); });
      
      socket.on('data', (data) => {
        if (step === 'greeting') {
          if (data[0] !== 0x05 || data[1] !== 0x00) { clearTimeout(timer); socket.destroy(); resolve(false); return; }
          step = 'connect';
          const hostBuf = Buffer.from(targetHost);
          const portBuf = Buffer.alloc(2);
          portBuf.writeUInt16BE(targetPort);
          socket.write(Buffer.concat([
            Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
            hostBuf, portBuf,
          ]));
        } else if (step === 'connect') {
          if (data[0] !== 0x05 || data[1] !== 0x00) { clearTimeout(timer); socket.destroy(); resolve(false); return; }
          step = 'connected';
          
          const tlsSocket = tls.connect({
            socket: socket,
            servername: targetHost,
            rejectUnauthorized: false,
          }, () => {
            // TLS handshake succeeded — proxy can reach cloudnestra, that's all we need
            clearTimeout(timer);
            tlsSocket.destroy();
            socket.destroy();
            resolve(true);
          });
          
          tlsSocket.on('error', () => { clearTimeout(timer); socket.destroy(); resolve(false); });
        }
      });
    } catch {
      clearTimeout(timer);
      resolve(false);
    }
  });
}

/**
 * Validate proxies in batches with concurrency limit
 */
async function validateProxiesBatch(proxies) {
  const results = [];
  const concurrency = PROXY_POOL_CONFIG.maxConcurrentValidations;
  
  for (let i = 0; i < proxies.length; i += concurrency) {
    const batch = proxies.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (proxyStr) => {
        const valid = await validateSocks5Proxy(proxyStr);
        return { proxyStr, valid };
      })
    );
    
    for (const r of batchResults) {
      if (r.valid) {
        results.push(r.proxyStr);
      }
    }
    
    // If we already have enough, stop early
    if (results.length >= PROXY_POOL_CONFIG.minPoolSize * 1.5) {
      console.log(`[ProxyPool] Early stop: ${results.length} validated (checked ${i + batch.length}/${proxies.length})`);
      break;
    }
  }
  
  return results;
}

/**
 * Main pool refresh: fetch lists, validate, update pool
 */
async function refreshProxyPool() {
  if (PROXY_POOL.validating) {
    console.log(`[ProxyPool] Refresh already in progress, skipping`);
    return;
  }
  
  PROXY_POOL.validating = true;
  const startTime = Date.now();
  console.log(`[ProxyPool] Starting pool refresh...`);
  
  try {
    // Step 1: Fetch all proxy lists
    const allProxies = await fetchProxyLists();
    
    // Step 2: Shuffle to avoid always testing the same ones first
    for (let i = allProxies.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allProxies[i], allProxies[j]] = [allProxies[j], allProxies[i]];
    }
    
    // Step 3: Validate in batches
    const validated = await validateProxiesBatch(allProxies);
    
    const elapsed = Date.now() - startTime;
    PROXY_POOL.totalValidated = validated.length;
    PROXY_POOL.totalFailed = allProxies.length - validated.length;
    PROXY_POOL.lastRefresh = Date.now();
    
    if (validated.length > 0) {
      // Update pool with new validated proxies
      PROXY_POOL.validated = validated.map(p => ({
        host: p.split(':')[0],
        port: parseInt(p.split(':')[1]),
        str: p,
        lastValidated: Date.now(),
        failures: 0,
      }));
      PROXY_POOL.roundRobinIndex = 0;
      console.log(`[ProxyPool] ✅ Pool refreshed: ${validated.length} working proxies (${elapsed}ms)`);
    } else {
      // Keep existing pool if validation found nothing (network issue?)
      console.log(`[ProxyPool] ⚠️ No proxies validated, keeping existing pool of ${PROXY_POOL.validated.length}`);
    }
  } catch (e) {
    console.log(`[ProxyPool] ❌ Refresh error: ${e.message}`);
  } finally {
    PROXY_POOL.validating = false;
  }
}

/**
 * Get next proxy from the validated pool (round-robin)
 * Falls back to hardcoded list if pool is empty
 */
function getNextProxy() {
  if (PROXY_POOL.validated.length > 0) {
    const proxy = PROXY_POOL.validated[PROXY_POOL.roundRobinIndex % PROXY_POOL.validated.length];
    PROXY_POOL.roundRobinIndex++;
    return { host: proxy.host, port: proxy.port, str: proxy.str, source: 'pool' };
  }
  
  // Fallback to hardcoded list
  if (!global._socks5FallbackIndex) global._socks5FallbackIndex = 0;
  const p = FALLBACK_SOCKS5_PROXIES[global._socks5FallbackIndex % FALLBACK_SOCKS5_PROXIES.length];
  global._socks5FallbackIndex++;
  const [host, port] = p.split(':');
  return { host, port: parseInt(port), str: p, source: 'fallback' };
}

/**
 * Mark a proxy as failed (increment failure counter, remove if too many failures)
 */
function markProxyFailed(proxyStr) {
  const idx = PROXY_POOL.validated.findIndex(p => p.str === proxyStr);
  if (idx !== -1) {
    PROXY_POOL.validated[idx].failures++;
    if (PROXY_POOL.validated[idx].failures >= 3) {
      PROXY_POOL.validated.splice(idx, 1);
      console.log(`[ProxyPool] Removed ${proxyStr} after 3 failures (pool: ${PROXY_POOL.validated.length})`);
    }
  }
}

// ============================================================================
// SECURITY: Origin Validation
// Only allow requests from known origins (CF Worker, frontend apps)
// ============================================================================
const ALLOWED_ORIGINS = [
  'https://tv.vynx.cc',
  'https://flyx.tv',
  'https://www.flyx.tv',
  'http://localhost:3000',
  'http://localhost:3001',
];

const ALLOWED_ORIGIN_PATTERNS = [
  /\.vercel\.app$/,
  /\.pages\.dev$/,
  /\.workers\.dev$/,
];

function isAllowedOrigin(origin) {
  if (!origin) return false;
  
  // Check exact matches
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  
  // Check patterns
  try {
    const hostname = new URL(origin).hostname;
    return ALLOWED_ORIGIN_PATTERNS.some(p => p.test(hostname));
  } catch {
    return false;
  }
}

// ============================================================================
// SECURITY: URL Domain Allowlist
// Only proxy requests to known/trusted domains
// ============================================================================
const PROXY_ALLOWED_DOMAINS = [
  // Jikan (MAL API) — needed for anime episode listings from CF Workers
  'jikan.moe',
  'api.jikan.moe',
  // DLHD key servers
  'soyspace.cyou',
  'adsfadfds.cfd',
  'vovlacosa.sbs',
  'dvalna.ru',
  'topembed.pw',
  'dlhd.link',
  'daddylive.mp', // New main site domain (Feb 25, 2026)
  'dlstreams.top', // New main site domain (Mar 2026, dlhd.link redirects here)
  'www.ksohls.ru', // Previous player domain (Feb 25, 2026)
  'ksohls.ru',
  'adffdafdsafds.sbs', // Current player domain (Mar 2026)
  'go.ai-chatx.site', // reCAPTCHA verify + key server (Mar 2026)
  'ai-chatx.site', // reCAPTCHA verify domain (Mar 2026)
  'vmvmv.shop', // New key server domain (Mar 9 2026, from SSL cert)
  'lefttoplay.xyz', // Dead but kept for reference
  'hitsplay.fun', // Dead but kept for reference
  'codepcplay.fun', // Dead but kept for reference
  // AnimeKai/MegaUp (domains rotate frequently)
  'megaup.net',
  'megaup.live',
  'megaup.cc',
  '4spromax.site',
  'hub26link.site',
  'dev23app.site',
  'net22lab.site',
  'pro25zone.site',
  'tech20hub.site',
  'code29wave.site',
  'app28base.site',
  'animekai.to',
  'anikai.to',
  'enc-dec.app',
  // HiAnime/MegaCloud CDN (hostnames rotate: haildrop77.pro, fogtwist21.xyz, rainveil36.xyz, etc.)
  'hianime.to',
  'hianimez.to',
  'hianime.nz',
  'hianime.sx',
  'megacloud.blog',
  'megacloud.tv',
  'mgstatics.xyz', // MegaCloud subtitle CDN
  // VIPRow
  'boanki.net',
  'peulleieo.net',
  'casthill.net',
  'viprow.nu',
  // PPV
  'poocloud.in',
  'modistreams.org',
  // Flixer
  'flixer.su',
  'flixer.sh',
  'hexa.su',
  'workers.dev', // Flixer CDN uses p.XXXXX.workers.dev
  // VidLink CDN (storm.vodvidl.site, videostr.net — behind Cloudflare, blocks datacenter IPs)
  'vodvidl.site',
  'videostr.net',
  'vidlink.pro',
  // VidSrc / 2embed (residential IP bypass for Cloudflare)
  '2embed.stream',
  'v1.2embed.stream',
  '2embed.cc',
  'vidsrc-embed.ru',
  'vsembed.ru',
  'vidsrc.cc',
  'vidsrc.me',
  'vidsrc.xyz',
  'vidsrc.stream',
  'cloudnestra.com',
  'cloudnestra.net',
  'shadowlandschronicles.com',
  'shadowlandschronicles.net',
  'shadowlandschronicles.org',
  'embedsito.com',
  // CDN-Live (all resolve to 195.128.27.233, but CF Workers get 403)
  'cdn-live.tv',
  'cdn-live-tv.ru',
  'cdn-live-tv.cfd',
  'edge.cdn-live.ru',
  'edge.cdn-live-tv.ru',
  'edge.cdn-live-tv.cfd',
  'edge.cdn-google.ru',
  // Moveonjoy (direct M3U8, no auth needed)
  'moveonjoy.com',
  // Player 6 (lovecdn/lovetier)
  'lovecdn.ru',
  'lovetier.bz',
  // Testing
  'example.com',
  'example.org',
];

function isAllowedProxyDomain(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    // Exact or suffix match against allowlist
    if (PROXY_ALLOWED_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d))) {
      return true;
    }
    // MegaCloud CDN uses rotating hostnames (haildrop77.pro, fogtwist21.xyz, rainveil36.xyz, etc.)
    // They all serve from /_v7/ or /_v8/ paths — allow any domain with that pattern
    if (parsed.pathname.startsWith('/_v')) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ============================================================================
// SECURITY: Timing-safe API key comparison
// Prevents timing attacks on API key validation
// ============================================================================
function timingSafeApiKeyCheck(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  
  // Pad to same length to prevent length-based timing leaks
  const maxLen = Math.max(provided.length, expected.length);
  const paddedProvided = provided.padEnd(maxLen, '\0');
  const paddedExpected = expected.padEnd(maxLen, '\0');
  
  try {
    return crypto.timingSafeEqual(
      Buffer.from(paddedProvided),
      Buffer.from(paddedExpected)
    ) && provided.length === expected.length;
  } catch {
    return false;
  }
}

// ============================================================================
// DLHD Auth Token Management
// The key server requires Authorization: Bearer <token>
// Token is fetched from the player page - NO CACHING to avoid stale token issues
// ============================================================================

// Import v4 auth module for WASM-based PoW authentication (Jan 2026)
// V4 uses the actual WASM module from DLHD for correct nonce computation
const dlhdAuthV4 = require('./dlhd-auth-v4');

// ============================================================================
// DLHD Heartbeat Session Management  
// The key server requires a heartbeat session to be established BEFORE key fetch
// Heartbeat must be called from residential IP (datacenter IPs get 403)
// NO CACHING - always establish fresh session to avoid stale session issues
// ============================================================================

/**
 * Fetch auth data from the player page for a given channel
 * Returns: { token, country, timestamp }
 * NO CACHING - always fetch fresh to avoid stale token issues
 */
async function fetchAuthToken(channel) {
  console.log(`[Auth] Fetching fresh token for channel ${channel}...`);
  
  return new Promise((resolve) => {
    const url = `https://epicplayplay.cfd/premiumtv/daddyhd.php?id=${channel}`;
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://daddyhd.com/',
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        // Extract AUTH_TOKEN from the page
        const tokenMatch = data.match(/AUTH_TOKEN\s*=\s*["']([^"']+)["']/);
        if (tokenMatch) {
          const token = tokenMatch[1];
          
          // Extract AUTH_COUNTRY
          const countryMatch = data.match(/AUTH_COUNTRY\s*=\s*["']([^"']+)["']/);
          const country = countryMatch ? countryMatch[1] : 'US';
          
          // Extract AUTH_TS
          const tsMatch = data.match(/AUTH_TS\s*=\s*["']([^"']+)["']/);
          const timestamp = tsMatch ? tsMatch[1] : String(Math.floor(Date.now() / 1000));
          
          const authData = { token, country, timestamp };
          console.log(`[Auth] Got token for channel ${channel}: ${token.substring(0, 20)}... country=${country} ts=${timestamp}`);
          resolve(authData);
        } else {
          console.log(`[Auth] No token found in page for channel ${channel}`);
          resolve(null);
        }
      });
    }).on('error', (e) => {
      console.error(`[Auth] Error fetching token: ${e.message}`);
      resolve(null);
    });
  });
}

/**
 * Extract channel number from key URL
 * e.g., https://chevy.kiko2.ru/key/premium51/5886102 -> 51
 */
function extractChannelFromKeyUrl(url) {
  const match = url.match(/premium(\d+)/);
  return match ? match[1] : null;
}

/**
 * Extract server from key URL
 * e.g., https://chevy.kiko2.ru/key/premium51/5886102 -> { server: 'chevy', domain: 'kiko2.ru' }
 */
function extractServerFromKeyUrl(url) {
  try {
    const parsed = new URL(url);
    const parts = parsed.hostname.split('.');
    if (parts.length >= 3) {
      return { server: parts[0], domain: parts.slice(1).join('.') };
    }
  } catch {}
  return null;
}

/**
 * Generate CLIENT_TOKEN for heartbeat authentication
 * This mimics the browser's generateClientToken() function
 * 
 * Format: base64(channelKey|country|timestamp|userAgent|fingerprint)
 * Where fingerprint = userAgent|screen|timezone|language
 */
function generateClientToken(channelKey, country, timestamp, userAgent) {
  const screen = '1920x1080'; // Common resolution
  const tz = 'America/New_York'; // Common timezone
  const lang = 'en-US';
  const fingerprint = `${userAgent}|${screen}|${tz}|${lang}`;
  const signData = `${channelKey}|${country}|${timestamp}|${userAgent}|${fingerprint}`;
  return Buffer.from(signData).toString('base64');
}

/**
 * Establish heartbeat session for a channel on a specific server
 * This MUST be called before fetching keys - the key server returns E2 error otherwise
 * 
 * CRITICAL: Heartbeat requires X-Client-Token header (base64 fingerprint)
 * Without it, server returns 403 "Missing client token"
 * 
 * @param {string} channel - Channel number (e.g., "51")
 * @param {string} server - Server name (e.g., "zeko", "chevy")
 * @param {string} domain - Domain (e.g., "kiko2.ru", "giokko.ru")
 * @param {string} authToken - Auth token from player page
 * @param {string} country - Country code (e.g., "US")
 * @param {string} timestamp - Auth timestamp from player page
 * @returns {Promise<{success: boolean, expiry?: number, error?: string}>}
 */
async function establishHeartbeatSession(channel, server, domain, authToken, country = 'US', timestamp = null) {
  // NO CACHING - always establish fresh session to avoid stale session issues
  console.log(`[Heartbeat] Establishing fresh session for channel ${channel} on ${server}.${domain}...`);
  
  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const channelKey = `premium${channel}`;
  const ts = timestamp || String(Math.floor(Date.now() / 1000));
  const clientToken = generateClientToken(channelKey, country, ts, userAgent);
  
  console.log(`[Heartbeat] Using CLIENT_TOKEN: ${clientToken.substring(0, 40)}...`);
  
  return new Promise((resolve) => {
    const hbUrl = `https://${server}.${domain}/heartbeat`;
    
    const req = https.get(hbUrl, {
      headers: {
        'User-Agent': userAgent,
        'Accept': '*/*',
        'Origin': 'https://epicplayplay.cfd',
        'Referer': 'https://epicplayplay.cfd/',
        'Authorization': `Bearer ${authToken}`,
        'X-Channel-Key': channelKey,
        'X-Client-Token': clientToken,
        'X-User-Agent': userAgent,
      },
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`[Heartbeat] Response: ${res.statusCode} - ${data.substring(0, 100)}`);
        
        // 404 = endpoint doesn't exist on this server, not an error
        if (res.statusCode === 404) {
          console.log(`[Heartbeat] Server ${server}.${domain} doesn't have heartbeat endpoint`);
          resolve({ success: false, error: 'No heartbeat endpoint (404)' });
          return;
        }
        
        // Check for success - heartbeat returns {"status":"ok","expiry":1734567890}
        if (res.statusCode === 200 && (data.includes('"ok"') || data.includes('"status":"ok"'))) {
          // Extract expiry timestamp
          let expiry = Math.floor(Date.now() / 1000) + 1800; // Default 30 min
          try {
            const json = JSON.parse(data);
            if (json.expiry) expiry = json.expiry;
          } catch {}
          
          console.log(`[Heartbeat] ✅ Session established for ${channel}:${server}, expires at ${expiry}`);
          resolve({ success: true, expiry });
        } else {
          console.log(`[Heartbeat] ❌ Failed for ${channel}:${server}: ${res.statusCode} - ${data.substring(0, 100)}`);
          resolve({ success: false, error: data.substring(0, 200) });
        }
      });
    });
    
    req.on('error', (err) => {
      console.error(`[Heartbeat] Error: ${err.message}`);
      resolve({ success: false, error: err.message });
    });
    
    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, error: 'Timeout' });
    });
  });
}

// DLHD Auth modules (required for key fetching)
// dlhdAuthV4 already imported above
const dlhdAuthV5 = require('./dlhd-auth-v5');

// Validate that V5 module exports expected function
if (typeof dlhdAuthV5.fetchDLHDKeyV5 !== 'function') {
  throw new Error('dlhd-auth-v5 module missing fetchDLHDKeyV5 function');
}

// Browser-based key fetcher (bypasses TLS fingerprint detection)
let keyFetcher = null;
try {
  keyFetcher = require('./key-fetcher');
  console.log('[Init] Browser key fetcher loaded');
} catch (e) {
  console.log('[Init] Browser key fetcher not available:', e.message);
}

console.log('[Init] DLHD auth modules loaded (V4 and V5)');

const PORT = process.env.PORT || 3001;
const API_KEY = process.env.API_KEY || 'change-this-secret-key';

// Rate limiting — NO limit for authenticated requests (valid API key)
// Only rate-limit unauthenticated requests by IP (200/min)
const rateLimiter = new Map();
const RATE_LIMIT_UNAUTH = 200; // requests per minute for unauthenticated IPs
const RATE_WINDOW = 60000;

function checkRateLimit(key, isAuthenticated) {
  if (isAuthenticated) return true; // No limit for API-key-authenticated requests
  
  const now = Date.now();
  const record = rateLimiter.get(key) || { count: 0, resetAt: now + RATE_WINDOW };
  
  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + RATE_WINDOW;
  }
  
  record.count++;
  rateLimiter.set(key, record);
  return record.count <= RATE_LIMIT_UNAUTH;
}

// Clean up rate limits every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimiter.entries()) {
    if (now > record.resetAt) rateLimiter.delete(ip);
  }
}, 300000);

// Simple response cache - NO CACHING FOR KEYS OR AUTH!
// Keys and auth tokens must be fresh every request
const cache = new Map();
const KEY_CACHE_TTL = 0; // NO CACHING for keys - must be fresh!
const M3U8_CACHE_TTL = 0; // NO CACHING for m3u8 - must be fresh!

function getCacheTTL(url) {
  // NO CACHING for keys - they require fresh auth tokens
  if (url.includes('.key') || url.includes('key.php') || url.includes('wmsxx.php') || url.includes('/key/premium')) return 0;
  // NO CACHING for m3u8 - they update frequently
  if (url.includes('.m3u8') || url.includes('mono.css')) return 0;
  // Only cache static segments
  return 30000; // 30 seconds for segments only
}

function getCached(url) {
  const ttl = getCacheTTL(url);
  if (ttl === 0) return null;
  
  const cached = cache.get(url);
  if (!cached) return null;
  
  if (Date.now() - cached.timestamp > ttl) {
    cache.delete(url);
    return null;
  }
  
  return cached;
}

function setCache(url, data, contentType) {
  const ttl = getCacheTTL(url);
  if (ttl === 0) return;
  cache.set(url, { data, contentType, timestamp: Date.now() });
}

// Cache cleanup disabled - we don't cache keys/auth anymore

/**
 * Generate fake AWS auth headers (server checks presence, not validity)
 */
function getAwsHeaders() {
  const now = new Date();
  // Format: 20251210T004300Z
  const pad = (n) => n.toString().padStart(2, '0');
  const amzDate = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const dateStamp = amzDate.substring(0, 8);
  const fakeSignature = '0'.repeat(64);
  const authorization = `AWS4-HMAC-SHA256 Credential=/${dateStamp}/us-east-1//aws4_request, SignedHeaders=host;x-amz-date, Signature=${fakeSignature}`;
  
  return { amzDate, authorization };
}

const { spawn } = require('child_process');

/**
 * Fetch DLHD key with Authorization header
 * IMPORTANT: Now uses v2 auth with HMAC-SHA256 signed requests
 * 
 * Flow (v2):
 *   1. Get FRESH auth data from player page (JWT token + HMAC secret)
 *   2. Call heartbeat endpoint to establish session
 *   3. Fetch key with signed headers (Authorization, X-Key-Signature, etc.)
 *   4. If E2/E4 error, retry with fresh auth
 */
async function fetchKeyWithAuth(keyUrl, res) {
  // Extract channel from URL
  const channel = extractChannelFromKeyUrl(keyUrl);
  if (!channel) {
    console.log(`[Key] Could not extract channel from URL: ${keyUrl}`);
    res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: 'Invalid key URL format' }));
    return;
  }
  
  // Extract server info from URL
  const serverInfo = extractServerFromKeyUrl(keyUrl);
  if (!serverInfo) {
    console.log(`[Key] Could not extract server from URL: ${keyUrl}`);
    res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: 'Invalid key URL format - cannot extract server' }));
    return;
  }
  
  console.log(`[Key] Fetching key for channel ${channel} from ${serverInfo.server}.${serverInfo.domain} (using v4 WASM PoW auth)`);
  
  // Use v4 auth with WASM-based PoW nonce (Jan 2026 update)
  const result = await dlhdAuthV4.fetchDLHDKeyV4(keyUrl);
  
  if (result.success) {
    console.log(`[Key] ✅ Valid key via v4 WASM auth: ${result.data.toString('hex')}`);
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': result.data.length,
      'Access-Control-Allow-Origin': '*',
      'X-Fetched-By': 'v4-wasm-auth',
    });
    res.end(result.data);
    return;
  }
  
  // V4 auth failed - return error
  console.log(`[Key] ❌ V4 auth failed: ${result.error}`);
  
  // Map error codes to HTTP status
  let status = 502;
  if (result.code === 'E3') status = 401; // Token expired
  if (result.code === 'E4') status = 403; // Invalid signature
  if (result.code === 'E5') status = 403; // Invalid fingerprint
  
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify({ 
    error: result.error, 
    code: result.code,
    response: result.response?.substring(0, 200),
  }));
}

/**
 * Proxy using curl for non-key requests
 */
function proxyWithCurl(targetUrl, res) {
  // Build args
  const args = ['-s', '--max-time', '30'];
  
  // Add HTTP/2 and ignore cert errors
  args.push('--http2', '-k');
  
  // Add browser headers
  args.push('-H', 'user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  args.push('-H', 'accept: */*');
  args.push('-i'); // Include response headers
  args.push(targetUrl);
  
  console.log(`[Curl] ${targetUrl.substring(0, 80)}...`);
  console.log(`[Curl Args] ${args.join(' ')}`);
  
  const curl = spawn('curl', args);
  const chunks = [];
  let stderr = '';
  
  curl.stdout.on('data', (data) => chunks.push(data));
  curl.stderr.on('data', (data) => { stderr += data.toString(); });
  
  curl.on('close', (code) => {
    if (code !== 0) {
      console.error(`[Curl Error] Exit ${code}: ${stderr}`);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Curl failed', details: stderr }));
      }
      return;
    }
    
    const output = Buffer.concat(chunks);
    console.log(`[Curl Raw Output] ${output.length} bytes total`);
    
    // With -i flag, output is: HTTP headers + \r\n\r\n + body
    // Parse status from first line: "HTTP/2 200" or "HTTP/1.1 200 OK"
    let statusCode = 200;
    let data = output;
    
    // Find the header/body separator (double CRLF)
    const headerEnd = output.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd > 0) {
      const headers = output.slice(0, headerEnd).toString();
      data = output.slice(headerEnd + 4);
      
      // Parse status from first line
      const statusMatch = headers.match(/HTTP\/[\d.]+ (\d+)/);
      if (statusMatch) {
        statusCode = parseInt(statusMatch[1], 10);
      }
      console.log(`[Curl Headers] ${headers.split('\r\n')[0]}`);
    }
    
    console.log(`[Curl Parsed] Status: ${statusCode}, Body: ${data.length} bytes`);
    
    // CRITICAL: For key requests, if we get 401 but body is exactly 16 bytes,
    // the server might be returning the key data with an error status.
    // AES-128 keys are always exactly 16 bytes.
    // The {"error":"E3"} JSON response is also 16 bytes, so check if it's JSON
    const isKeyRequest = targetUrl.includes('/key/premium') || targetUrl.includes('wmsxx.php') || targetUrl.includes('.key');
    let finalStatus = statusCode;
    
    if (isKeyRequest && statusCode === 401 && data.length === 16) {
      // Check if it's JSON error or actual binary key data
      const dataStr = data.toString('utf8');
      const looksLikeJson = dataStr.startsWith('{') || dataStr.startsWith('[');
      
      if (looksLikeJson) {
        console.log(`[Key 401] Got JSON error response: ${dataStr}`);
        // It's a JSON error, keep 401 status
      } else {
        // It's likely binary key data! Return as 200
        console.log(`[Key 401] Got 16-byte binary data, treating as valid key!`);
        console.log(`[Key Data] Hex: ${data.toString('hex')}`);
        finalStatus = 200;
        // NO CACHING for keys
      }
    }
    // NO CACHING for keys
    
    console.log(`[Response] ${finalStatus} - ${data.length} bytes`);
    
    res.writeHead(finalStatus, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': data.length,
      'Access-Control-Allow-Origin': '*',
      'X-Original-Status': statusCode.toString(),
    });
    res.end(data);
  });
  
  curl.on('error', (err) => {
    console.error(`[Curl Spawn Error] ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Curl spawn failed', details: err.message }));
    }
  });
}

/**
 * IPTV API proxy - makes Stalker portal API calls from residential IP
 * This is needed because stream tokens are bound to the requesting IP
 */
function proxyIPTVApi(targetUrl, mac, token, res) {
  const url = new URL(targetUrl);
  const client = url.protocol === 'https:' ? https : http;
  
  // STB Device Headers - must match exactly what works from Vercel
  const encodedMac = mac ? encodeURIComponent(mac) : '';
  const headers = {
    'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3',
    'X-User-Agent': 'Model: MAG250; Link: WiFi',
    'Accept': '*/*',
    'Accept-Encoding': 'gzip, deflate',
    'Accept-Language': 'en-US,en;q=0.9',
    'Connection': 'keep-alive',
    'Referer': `${url.protocol}//${url.host}/`,
  };
  
  if (mac) {
    headers['Cookie'] = `mac=${encodedMac}; stb_lang=en; timezone=GMT`;
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  console.log(`[IPTV API] Headers:`, JSON.stringify(headers, null, 2));

  const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    method: 'GET',
    headers,
    timeout: 15000,
    rejectUnauthorized: false,
  };

  console.log(`[IPTV API] ${targetUrl.substring(0, 100)}...`);

  const proxyReq = client.request(options, (proxyRes) => {
    const chunks = [];
    
    proxyRes.on('data', chunk => chunks.push(chunk));
    
    proxyRes.on('end', () => {
      const data = Buffer.concat(chunks);
      const contentType = proxyRes.headers['content-type'] || 'application/json';
      
      console.log(`[IPTV API Response] ${proxyRes.statusCode} - ${data.length} bytes`);
      
      res.writeHead(proxyRes.statusCode, {
        'Content-Type': contentType,
        'Content-Length': data.length,
        'Access-Control-Allow-Origin': '*',
      });
      res.end(data);
    });
  });

  proxyReq.on('error', (err) => {
    console.error(`[IPTV API Error] ${err.message}`);
    res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: 'IPTV API proxy error', details: err.message }));
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    res.writeHead(504, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: 'IPTV API timeout' }));
  });

  proxyReq.end();
}

/**
 * IPTV Stream proxy - streams raw MPEG-TS data with STB headers
 * This is for Stalker portal streams that need residential IP
 * Follows redirects automatically (IPTV servers often return 302)
 */
function proxyIPTVStream(targetUrl, mac, token, res, redirectCount = 0) {
  // Prevent infinite redirect loops
  if (redirectCount > 5) {
    console.error(`[IPTV Error] Too many redirects`);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Too many redirects' }));
    return;
  }

  const url = new URL(targetUrl);
  const client = url.protocol === 'https:' ? https : http;
  
  // STB Device Headers - Required for Stalker Portal authentication
  // Must match exactly what works from Vercel
  const encodedMac = mac ? encodeURIComponent(mac) : '';
  const headers = {
    'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3',
    'X-User-Agent': 'Model: MAG250; Link: WiFi',
    'Accept': '*/*',
    'Accept-Encoding': 'gzip, deflate',
    'Accept-Language': 'en-US,en;q=0.9',
    'Connection': 'keep-alive',
    'Referer': `${url.protocol}//${url.host}/`,
  };
  
  if (mac) {
    headers['Cookie'] = `mac=${encodedMac}; stb_lang=en; timezone=GMT`;
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    method: 'GET',
    headers,
    timeout: 30000,
    rejectUnauthorized: false, // Some IPTV CDNs have bad certs
  };

  console.log(`[IPTV Stream] ${targetUrl.substring(0, 80)}...`);
  console.log(`[IPTV Stream] Headers:`, JSON.stringify(headers, null, 2));

  const proxyReq = client.request(options, (proxyRes) => {
    const contentType = proxyRes.headers['content-type'] || 'video/mp2t';
    
    console.log(`[IPTV Response] ${proxyRes.statusCode} - ${contentType}`);
    
    // Handle redirects (301, 302, 303, 307, 308)
    if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers.location) {
      const redirectUrl = proxyRes.headers.location;
      console.log(`[IPTV Redirect] Following redirect to: ${redirectUrl.substring(0, 80)}...`);
      
      // Resolve relative URLs
      const absoluteUrl = redirectUrl.startsWith('http') 
        ? redirectUrl 
        : new URL(redirectUrl, targetUrl).toString();
      
      // Follow the redirect
      proxyIPTVStream(absoluteUrl, mac, token, res, redirectCount + 1);
      return;
    }
    
    // Stream directly - don't buffer (these can be huge/infinite)
    res.writeHead(proxyRes.statusCode, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
      'Cache-Control': 'no-store',
    });
    
    proxyRes.pipe(res);
    
    proxyRes.on('error', (err) => {
      console.error(`[IPTV Stream Error] ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(502);
      }
      res.end();
    });
  });

  proxyReq.on('error', (err) => {
    console.error(`[IPTV Error] ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'IPTV proxy error', details: err.message }));
    }
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.writeHead(504, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'IPTV stream timeout' }));
    }
  });

  // Handle client disconnect (user closes player)
  res.on('close', () => {
    proxyReq.destroy();
  });

  proxyReq.end();
}

/**
 * AnimeKai/Flixer/DLHD stream proxy - fetches CDN streams from residential IP
 * 
 * MegaUp CDN (AnimeKai) blocks:
 *   1. Datacenter IPs (Cloudflare, AWS, etc.)
 *   2. Requests with Origin header
 *   3. Requests with Referer header (sometimes)
 * 
 * Flixer CDN (p.XXXXX.workers.dev) blocks:
 *   1. Datacenter IPs (Cloudflare, AWS, etc.)
 *   2. Requests WITHOUT Referer header (requires https://flixer.su/)
 * 
 * dvalna.ru/soyspace.cyou/adsfadfds.cfd (DLHD) blocks:
 *   1. Datacenter IPs (Cloudflare, AWS, etc.)
 *   2. Requests WITHOUT proper Referer AND Origin headers
 *   3. M3U8 requests WITHOUT Authorization: Bearer <JWT> header (returns E9 error)
 * 
 * This proxy fetches from a residential IP with appropriate headers.
 * 
 * IMPORTANT: The User-Agent MUST be consistent with what's sent to enc-dec.app
 * for decryption. Pass ?ua=<user-agent> to use a custom User-Agent.
 * Pass ?referer=<url> to include a Referer header (needed for Flixer CDN and DLHD CDN).
 * Pass ?origin=<url> to include an Origin header (needed for DLHD CDN).
 * Pass ?auth=<value> to include an Authorization header (needed for DLHD M3U8).
 */
function proxyAnimeKaiStream(targetUrl, customUserAgent, customReferer, customOrigin, customAuth, res) {
  // NO CACHING - always fetch fresh

  const url = new URL(targetUrl);
  
  // Check if this is MegaCloud CDN (uses /_v7/ or /_v8/ paths)
  // These CDNs use Cloudflare TLS fingerprinting — Node's https module gets 403.
  // However, fetch() (undici) defaults to IPv6 which gets BLOCKED by Cloudflare.
  // Solution: Use https.request with family:4 (IPv4) to bypass both issues.
  const isMegaCloudCdn = url.pathname.startsWith('/_v');
  
  if (isMegaCloudCdn) {
    const fetchUA = customUserAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
    console.log(`[AnimeKai] MegaCloud CDN detected — using fetch with Referer: ${targetUrl.substring(0, 100)}...`);
    
    // MegaCloud CDN requires Referer+Origin from megacloud.blog — without them → 403
    // Simple fetch() with correct headers works from any IP.
    const megaHeaders = {
      'User-Agent': fetchUA,
      'Accept': '*/*',
      'Accept-Encoding': 'identity',
      'Referer': 'https://megacloud.blog/',
      'Origin': 'https://megacloud.blog',
    };
    
    fetch(targetUrl, {
      headers: megaHeaders,
      signal: AbortSignal.timeout(30000),
    }).then(async (fetchRes) => {
      console.log(`[AnimeKai CDN] ← ${fetchRes.status} ${fetchRes.headers.get('content-type') || 'unknown'}`);
      if (!fetchRes.ok) {
        const errText = await fetchRes.text();
        console.log(`[AnimeKai CDN] Error: ${errText.substring(0, 200)}`);
        if (!res.headersSent) {
          res.writeHead(fetchRes.status, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
          res.end(errText);
        }
        return;
      }
      const ct = fetchRes.headers.get('content-type') || 'application/octet-stream';
      const respHeaders = {
        'Content-Type': ct,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
        'X-Proxied-By': 'rpi-megacloud-referer',
      };
      if (fetchRes.headers.get('content-length')) respHeaders['Content-Length'] = fetchRes.headers.get('content-length');
      if (!res.headersSent) res.writeHead(200, respHeaders);
      const reader = fetchRes.body.getReader();
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) { res.end(); return; }
          res.write(Buffer.from(value));
        }
      };
      pump().catch(err => { console.error(`[AnimeKai CDN stream] Error: ${err.message}`); if (!res.writableEnded) res.end(); });
    }).catch(err => {
      console.error(`[AnimeKai CDN] fetch error: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'MegaCloud CDN fetch failed', details: err.message }));
      }
    });
    return;
  }

  const client = url.protocol === 'https:' ? https : http;
  
  // Check if this is Flixer CDN (p.XXXXX.workers.dev)
  const isFlixerCdn = url.hostname.match(/^p\.\d+\.workers\.dev$/);
  
  // Check if this is VidLink CDN (storm.vodvidl.site, videostr.net)
  const isVidLinkCdn = url.hostname.includes('vodvidl.site') || url.hostname.includes('videostr.net');
  
  // Check if this is DLHD CDN
  const isDlhdCdn = url.hostname.includes('dvalna.ru') || url.hostname.includes('soyspace.cyou') || url.hostname.includes('adsfadfds.cfd') || url.hostname.includes('ksohls.ru') || url.hostname.includes('vovlacosa.sbs') || url.hostname.includes('ai-chatx.site') || url.hostname.includes('adffdafdsafds.sbs');
  
  // IMPORTANT: User-Agent MUST match the keystream used for decryption
  // Use the SHORT UA that matches MEGAUP_USER_AGENT constant
  const defaultUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
  const userAgent = customUserAgent || defaultUserAgent;
  
  // Build headers based on CDN type
  const headers = {
    'User-Agent': userAgent,
    'Accept': '*/*',
    'Accept-Encoding': 'identity', // Don't request compression for video
    'Connection': 'keep-alive',
  };
  
  // DLHD CDN REQUIRES Referer, Origin, AND Authorization headers for M3U8
  if (isDlhdCdn) {
    headers['Referer'] = customReferer || 'https://www.ksohls.ru/';
    headers['Origin'] = customOrigin || 'https://www.ksohls.ru';
    // Add Authorization header if provided (required for M3U8 requests)
    if (customAuth) {
      headers['Authorization'] = customAuth;
      console.log(`[AnimeKai] DLHD CDN - adding Auth header: ${customAuth.substring(0, 30)}...`);
    }
    console.log(`[AnimeKai] DLHD CDN detected - Referer: ${headers['Referer']}, Origin: ${headers['Origin']}, Auth: ${customAuth ? 'YES' : 'NO'}`);
  }
  // Flixer CDN REQUIRES Referer header, MegaUp CDN BLOCKS it
  else if (isFlixerCdn) {
    // Flixer CDN needs Referer header
    headers['Referer'] = customReferer || 'https://hexa.su/';
    console.log(`[AnimeKai] Flixer CDN detected - adding Referer: ${headers['Referer']}`);
  } else if (isVidLinkCdn) {
    // VidLink CDN (storm.vodvidl.site) — the m3u8 URL has embedded headers as query params
    // e.g. ?headers={"referer":"https://videostr.net/","origin":"https://videostr.net"}&host=...
    // Extract and use those headers if present, otherwise use defaults
    const headersParam = url.searchParams.get('headers');
    if (headersParam) {
      try {
        const parsedHeaders = JSON.parse(headersParam);
        if (parsedHeaders.referer) headers['Referer'] = parsedHeaders.referer;
        if (parsedHeaders.origin) headers['Origin'] = parsedHeaders.origin;
        console.log(`[AnimeKai] VidLink CDN - using embedded headers: Referer=${headers['Referer']}, Origin=${headers['Origin']}`);
      } catch {
        headers['Referer'] = customReferer || 'https://videostr.net/';
        headers['Origin'] = 'https://videostr.net';
        console.log(`[AnimeKai] VidLink CDN - failed to parse embedded headers, using defaults`);
      }
    } else {
      headers['Referer'] = customReferer || 'https://videostr.net/';
      headers['Origin'] = customOrigin || 'https://videostr.net';
      console.log(`[AnimeKai] VidLink CDN detected - Referer: ${headers['Referer']}, Origin: ${headers['Origin']}`);
    }
  } else if (customReferer) {
    // Only add Referer if explicitly provided for non-Flixer CDNs
    headers['Referer'] = customReferer;
    if (customOrigin) {
      headers['Origin'] = customOrigin;
    }
  }
  // For MegaUp CDN (AnimeKai), do NOT send Origin or Referer headers
  
  const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    method: 'GET',
    headers,
    timeout: 60000, // 60 second timeout for video segments (increased from 30s)
    rejectUnauthorized: false, // Some CDNs have cert issues
  };

  console.log(`[AnimeKai] ${targetUrl.substring(0, 100)}...`);
  console.log(`[AnimeKai] Headers:`, JSON.stringify(headers, null, 2));

  const proxyReq = client.request(options, (proxyRes) => {
    const contentType = proxyRes.headers['content-type'] || 'application/octet-stream';
    
    console.log(`[AnimeKai Response] ${proxyRes.statusCode} - ${contentType}`);
    
    // Handle redirects
    if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers.location) {
      const redirectUrl = proxyRes.headers.location;
      console.log(`[AnimeKai Redirect] Following to: ${redirectUrl.substring(0, 80)}...`);
      
      // Resolve relative URLs
      const absoluteUrl = redirectUrl.startsWith('http') 
        ? redirectUrl 
        : new URL(redirectUrl, targetUrl).toString();
      
      // Follow the redirect (preserve custom User-Agent, Referer, Origin, and Auth)
      proxyAnimeKaiStream(absoluteUrl, customUserAgent, customReferer, customOrigin, customAuth, res);
      return;
    }
    
    // STREAM directly instead of buffering - much faster for video segments!
    res.writeHead(proxyRes.statusCode, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
      'X-Proxied-By': 'rpi-residential',
    });
    
    // Pipe the response directly to client
    proxyRes.pipe(res);
    
    proxyRes.on('error', (err) => {
      console.error(`[AnimeKai Stream Error] ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(502);
      }
      res.end();
    });
  });

  proxyReq.on('error', (err) => {
    console.error(`[AnimeKai Error] ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'AnimeKai proxy error', details: err.message }));
    }
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.writeHead(504, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'AnimeKai stream timeout' }));
    }
  });
  
  // Handle client disconnect
  res.on('close', () => {
    proxyReq.destroy();
  });

  proxyReq.end();
}

// ============================================================================
// DEDICATED PROVIDER PROXY FUNCTIONS
// Each provider gets its own handler with provider-specific header logic.
// This replaces the monolithic proxyAnimeKaiStream domain-sniffing approach.
// ============================================================================

/**
 * Flixer CDN proxy — p.XXXXX.workers.dev
 * Requires: Referer: https://hexa.su/, Origin: https://hexa.su
 */
function proxyFlixerStream(targetUrl, customUserAgent, res) {
  const url = new URL(targetUrl);
  const { spawn } = require('child_process');

  // Build headers JSON for rust-fetch
  const hdrs = {
    'User-Agent': customUserAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Encoding': 'identity',
    'Referer': 'https://hexa.su/',
    'Origin': 'https://hexa.su',
  };

  console.log(`[Flixer] rust-fetch → ${targetUrl.substring(0, 100)}...`);

  const args = ['--url', targetUrl, '--timeout', '30', '--mode', 'fetch-bin', '--headers', JSON.stringify(hdrs)];
  const rust = spawn('rust-fetch', args);
  const chunks = [];
  let stderr = '';
  let spawned = true;

  rust.stdout.on('data', (chunk) => { chunks.push(chunk); });
  rust.stderr.on('data', (data) => { stderr += data.toString(); });

  rust.on('error', (err) => {
    spawned = false;
    console.warn(`[Flixer] rust-fetch not available (${err.message}), falling back to Node https`);
    // Fallback to Node.js https (original behavior)
    const client = url.protocol === 'https:' ? https : http;
    _proxyWithHeaders(client, url, hdrs, targetUrl, customUserAgent, 'https://hexa.su/', 'https://hexa.su', null, res, 'Flixer');
  });

  rust.on('close', (code) => {
    if (!spawned) return; // Already handled by error fallback
    if (code !== 0) {
      console.warn(`[Flixer] rust-fetch exit ${code}, falling back to Node https`);
      if (!res.headersSent) {
        const client = url.protocol === 'https:' ? https : http;
        _proxyWithHeaders(client, url, hdrs, targetUrl, customUserAgent, 'https://hexa.su/', 'https://hexa.su', null, res, 'Flixer');
      }
      return;
    }

    const body = Buffer.concat(chunks);
    console.log(`[Flixer] rust-fetch ← ${body.length}b`);

    // Detect content type from response data
    let contentType = 'application/octet-stream';
    const preview = body.toString('utf8', 0, Math.min(200, body.length));
    if (targetUrl.includes('.m3u8') || preview.includes('#EXTM3U')) {
      contentType = 'application/vnd.apple.mpegurl';
    } else if (body[0] === 0x47) { // MPEG-TS sync byte
      contentType = 'video/mp2t';
    } else if (body.length >= 4 && body[0] === 0x00 && body[1] === 0x00 && body[2] === 0x00) {
      contentType = 'video/mp4'; // fMP4
    }

    if (!res.headersSent) {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': body.length,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
        'X-Proxied-By': 'rpi-flixer-rust',
        'Cache-Control': contentType.includes('mpegurl') ? 'public, max-age=5' : 'public, max-age=3600',
      });
      res.end(body);
    }
  });

  res.on('close', () => { rust.kill(); });
}

/**
 * HiAnime/MegaCloud CDN proxy — /_v paths on rotating domains
 * Requires: Referer: https://megacloud.blog/, Origin: https://megacloud.blog
 * Uses fetch() for MegaCloud CDN (Node https gets 403 due to TLS fingerprinting)
 */
function proxyHiAnimeStream(targetUrl, customUserAgent, res) {
  const url = new URL(targetUrl);
  const isMegaCloudCdn = url.pathname.startsWith('/_v');

  if (isMegaCloudCdn) {
    // MegaCloud CDN — use fetch() (undici) which has different TLS fingerprint
    const fetchUA = customUserAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
    const megaHeaders = {
      'User-Agent': fetchUA,
      'Accept': '*/*',
      'Accept-Encoding': 'identity',
      'Referer': 'https://megacloud.blog/',
      'Origin': 'https://megacloud.blog',
    };
    console.log(`[HiAnime] MegaCloud CDN: ${targetUrl.substring(0, 100)}...`);
    fetch(targetUrl, { headers: megaHeaders, signal: AbortSignal.timeout(30000) })
      .then(async (fetchRes) => {
        console.log(`[HiAnime CDN] ← ${fetchRes.status} ${fetchRes.headers.get('content-type') || 'unknown'}`);
        if (!fetchRes.ok) {
          const errText = await fetchRes.text();
          if (!res.headersSent) {
            res.writeHead(fetchRes.status, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
            res.end(errText);
          }
          return;
        }
        const ct = fetchRes.headers.get('content-type') || 'application/octet-stream';
        const respHeaders = {
          'Content-Type': ct,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
          'X-Proxied-By': 'rpi-hianime',
        };
        if (fetchRes.headers.get('content-length')) respHeaders['Content-Length'] = fetchRes.headers.get('content-length');
        if (!res.headersSent) res.writeHead(200, respHeaders);
        const reader = fetchRes.body.getReader();
        const pump = async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) { res.end(); return; }
            res.write(Buffer.from(value));
          }
        };
        pump().catch(err => { console.error(`[HiAnime CDN stream] Error: ${err.message}`); if (!res.writableEnded) res.end(); });
      })
      .catch(err => {
        console.error(`[HiAnime CDN] fetch error: ${err.message}`);
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'HiAnime CDN fetch failed', details: err.message }));
        }
      });
    return;
  }

  // Non-MegaCloud HiAnime URLs — use https with megacloud.blog referer
  const client = url.protocol === 'https:' ? https : http;
  const headers = {
    'User-Agent': customUserAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': '*/*',
    'Accept-Encoding': 'identity',
    'Connection': 'keep-alive',
    'Referer': 'https://megacloud.blog/',
    'Origin': 'https://megacloud.blog',
  };
  console.log(`[HiAnime] ${targetUrl.substring(0, 100)}...`);
  _proxyWithHeaders(client, url, headers, targetUrl, customUserAgent, 'https://megacloud.blog/', 'https://megacloud.blog', null, res, 'HiAnime');
}

/**
 * VidLink CDN proxy — storm.vodvidl.site, videostr.net
 * Requires: Referer/Origin from embedded headers or videostr.net defaults
 */
function proxyVidLinkStream(targetUrl, customUserAgent, res) {
  const url = new URL(targetUrl);
  const { spawn } = require('child_process');

  const hdrs = {
    'User-Agent': customUserAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Encoding': 'identity',
  };

  // VidLink CDN embeds headers as query params
  const headersParam = url.searchParams.get('headers');
  if (headersParam) {
    try {
      const parsed = JSON.parse(headersParam);
      if (parsed.referer) hdrs['Referer'] = parsed.referer;
      if (parsed.origin) hdrs['Origin'] = parsed.origin;
      console.log(`[VidLink] Using embedded headers: Referer=${hdrs['Referer']}, Origin=${hdrs['Origin']}`);
    } catch {
      hdrs['Referer'] = 'https://videostr.net/';
      hdrs['Origin'] = 'https://videostr.net';
    }
  } else {
    hdrs['Referer'] = 'https://videostr.net/';
    hdrs['Origin'] = 'https://videostr.net';
  }

  console.log(`[VidLink] rust-fetch → ${targetUrl.substring(0, 100)}...`);

  const args = ['--url', targetUrl, '--timeout', '30', '--mode', 'fetch-bin', '--headers', JSON.stringify(hdrs)];
  const rust = spawn('rust-fetch', args);
  const chunks = [];
  let stderr = '';
  let spawned = true;

  rust.stdout.on('data', (chunk) => { chunks.push(chunk); });
  rust.stderr.on('data', (data) => { stderr += data.toString(); });

  rust.on('error', (err) => {
    spawned = false;
    console.warn(`[VidLink] rust-fetch not available (${err.message}), falling back to Node https`);
    const client = url.protocol === 'https:' ? https : http;
    _proxyWithHeaders(client, url, hdrs, targetUrl, customUserAgent, hdrs['Referer'], hdrs['Origin'], null, res, 'VidLink');
  });

  rust.on('close', (code) => {
    if (!spawned) return;
    if (code !== 0) {
      console.warn(`[VidLink] rust-fetch exit ${code}, falling back to Node https`);
      if (!res.headersSent) {
        const client = url.protocol === 'https:' ? https : http;
        _proxyWithHeaders(client, url, hdrs, targetUrl, customUserAgent, hdrs['Referer'], hdrs['Origin'], null, res, 'VidLink');
      }
      return;
    }

    const body = Buffer.concat(chunks);
    console.log(`[VidLink] rust-fetch ← ${body.length}b`);

    let contentType = 'application/octet-stream';
    const preview = body.toString('utf8', 0, Math.min(200, body.length));
    if (targetUrl.includes('.m3u8') || preview.includes('#EXTM3U')) {
      contentType = 'application/vnd.apple.mpegurl';
    } else if (body[0] === 0x47) {
      contentType = 'video/mp2t';
    } else if (body.length >= 4 && body[0] === 0x00 && body[1] === 0x00 && body[2] === 0x00) {
      contentType = 'video/mp4';
    }

    if (!res.headersSent) {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': body.length,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
        'X-Proxied-By': 'rpi-vidlink-rust',
        'Cache-Control': contentType.includes('mpegurl') ? 'public, max-age=5' : 'public, max-age=3600',
      });
      res.end(body);
    }
  });

  res.on('close', () => { rust.kill(); });
}

/**
 * DLHD CDN proxy — dvalna.ru, soyspace.cyou, adsfadfds.cfd, ksohls.ru
 * Requires: Referer + Origin (ksohls.ru) + Authorization: Bearer JWT for M3U8
 */
function proxyDlhdStream(targetUrl, customUserAgent, customReferer, customOrigin, customAuth, res) {
  const url = new URL(targetUrl);
  const client = url.protocol === 'https:' ? https : http;
  const headers = {
    'User-Agent': customUserAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': '*/*',
    'Accept-Encoding': 'identity',
    'Connection': 'keep-alive',
    'Referer': customReferer || 'https://www.ksohls.ru/',
    'Origin': customOrigin || 'https://www.ksohls.ru',
  };
  if (customAuth) {
    headers['Authorization'] = customAuth;
    console.log(`[DLHD] Auth header: ${customAuth.substring(0, 30)}...`);
  }
  console.log(`[DLHD] ${targetUrl.substring(0, 100)}... Referer: ${headers['Referer']}, Auth: ${customAuth ? 'YES' : 'NO'}`);
  _proxyWithHeaders(client, url, headers, targetUrl, customUserAgent, headers['Referer'], headers['Origin'], customAuth, res, 'DLHD');
}

/**
 * VidSrc/2embed CDN proxy — vidsrc.*, 2embed.*, cloudnestra.*
 * Requires: Referer from the embed domain
 */
function proxyVidSrcStream(targetUrl, customUserAgent, customReferer, res) {
  const url = new URL(targetUrl);
  const { spawn } = require('child_process');

  const hdrs = {
    'User-Agent': customUserAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Encoding': 'identity',
  };
  if (customReferer) {
    hdrs['Referer'] = customReferer;
  }

  console.log(`[VidSrc] rust-fetch → ${targetUrl.substring(0, 100)}...`);

  const args = ['--url', targetUrl, '--timeout', '30', '--mode', 'fetch-bin', '--headers', JSON.stringify(hdrs)];
  const rust = spawn('rust-fetch', args);
  const chunks = [];
  let stderr = '';
  let spawned = true;

  rust.stdout.on('data', (chunk) => { chunks.push(chunk); });
  rust.stderr.on('data', (data) => { stderr += data.toString(); });

  rust.on('error', (err) => {
    spawned = false;
    console.warn(`[VidSrc] rust-fetch not available (${err.message}), falling back to Node https`);
    const client = url.protocol === 'https:' ? https : http;
    _proxyWithHeaders(client, url, hdrs, targetUrl, customUserAgent, customReferer, null, null, res, 'VidSrc');
  });

  rust.on('close', (code) => {
    if (!spawned) return;
    if (code !== 0) {
      console.warn(`[VidSrc] rust-fetch exit ${code}, falling back to Node https`);
      if (!res.headersSent) {
        const client = url.protocol === 'https:' ? https : http;
        _proxyWithHeaders(client, url, hdrs, targetUrl, customUserAgent, customReferer, null, null, res, 'VidSrc');
      }
      return;
    }

    const body = Buffer.concat(chunks);
    console.log(`[VidSrc] rust-fetch ← ${body.length}b`);

    let contentType = 'application/octet-stream';
    const preview = body.toString('utf8', 0, Math.min(200, body.length));
    if (targetUrl.includes('.m3u8') || preview.includes('#EXTM3U')) {
      contentType = 'application/vnd.apple.mpegurl';
    } else if (body[0] === 0x47) {
      contentType = 'video/mp2t';
    } else if (body.length >= 4 && body[0] === 0x00 && body[1] === 0x00 && body[2] === 0x00) {
      contentType = 'video/mp4';
    }

    if (!res.headersSent) {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': body.length,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
        'X-Proxied-By': 'rpi-vidsrc-rust',
        'Cache-Control': contentType.includes('mpegurl') ? 'public, max-age=5' : 'public, max-age=3600',
      });
      res.end(body);
    }
  });

  res.on('close', () => { rust.kill(); });
}

/**
 * 1movies CDN proxy — p.XXXXX.workers.dev (same CDN as Flixer but different referer)
 * Requires: Referer: https://111movies.com/
 */
function proxy1moviesStream(targetUrl, customUserAgent, res) {
  const url = new URL(targetUrl);
  const client = url.protocol === 'https:' ? https : http;
  const headers = {
    'User-Agent': customUserAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': '*/*',
    'Accept-Encoding': 'identity',
    'Connection': 'keep-alive',
    'Referer': 'https://111movies.com/',
  };
  console.log(`[1movies] ${targetUrl.substring(0, 100)}...`);
  _proxyWithHeaders(client, url, headers, targetUrl, customUserAgent, 'https://111movies.com/', null, null, res, '1movies');
}

/**
 * Shared https proxy helper — used by all dedicated provider handlers.
 * Handles redirects, streaming, timeouts, and client disconnect.
 */
function _proxyWithHeaders(client, url, headers, targetUrl, customUserAgent, customReferer, customOrigin, customAuth, res, providerTag) {
  const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    method: 'GET',
    headers,
    timeout: 60000,
    rejectUnauthorized: false,
  };

  const proxyReq = client.request(options, (proxyRes) => {
    const contentType = proxyRes.headers['content-type'] || 'application/octet-stream';
    console.log(`[${providerTag} Response] ${proxyRes.statusCode} - ${contentType}`);

    if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers.location) {
      const redirectUrl = proxyRes.headers.location;
      const absoluteUrl = redirectUrl.startsWith('http') ? redirectUrl : new URL(redirectUrl, targetUrl).toString();
      console.log(`[${providerTag} Redirect] → ${absoluteUrl.substring(0, 80)}...`);
      _proxyWithHeaders(client, new URL(absoluteUrl), headers, absoluteUrl, customUserAgent, customReferer, customOrigin, customAuth, res, providerTag);
      return;
    }

    res.writeHead(proxyRes.statusCode, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
      'X-Proxied-By': `rpi-${providerTag.toLowerCase()}`,
    });
    proxyRes.pipe(res);
    proxyRes.on('error', (err) => {
      console.error(`[${providerTag} Stream Error] ${err.message}`);
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
  });

  proxyReq.on('error', (err) => {
    console.error(`[${providerTag} Error] ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: `${providerTag} proxy error`, details: err.message }));
    }
  });
  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.writeHead(504, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: `${providerTag} stream timeout` }));
    }
  });
  res.on('close', () => { proxyReq.destroy(); });
  proxyReq.end();
}

/**
 * Simple proxy - uses curl for key requests, Node https for others
 */
function proxyRequest(targetUrl, res) {
  // NO CACHING for proxy requests - always fetch fresh

  // Key URLs: wmsxx.php, .key, or new format like /key/premium39/5885913
  const isKeyRequest = targetUrl.includes('wmsxx.php') || targetUrl.includes('.key') || targetUrl.includes('/key/premium');
  
  // For key requests, use Authorization header method (discovered via reverse engineering)
  // The key server requires: Authorization: Bearer <token>
  if (isKeyRequest) {
    console.log(`[Key Request] Using Authorization header method`);
    return fetchKeyWithAuth(targetUrl, res);
  }

  // Use Node https for everything else
  const url = new URL(targetUrl);
  const client = url.protocol === 'https:' ? https : http;
  
  const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': '*/*',
    },
    timeout: 30000,
  };

  console.log(`[Fetch] ${targetUrl.substring(0, 80)}...`);

  const proxyReq = client.request(options, (proxyRes) => {
    const contentType = proxyRes.headers['content-type'] || 'application/octet-stream';
    const chunks = [];
    
    proxyRes.on('data', chunk => chunks.push(chunk));
    
    proxyRes.on('end', () => {
      const data = Buffer.concat(chunks);
      
      console.log(`[Response] ${proxyRes.statusCode} - ${data.length} bytes`);
      
      // NO CACHING
      res.writeHead(proxyRes.statusCode, {
        'Content-Type': contentType,
        'Content-Length': data.length,
        'Access-Control-Allow-Origin': '*',
      });
      res.end(data);
    });
  });

  proxyReq.on('error', (err) => {
    console.error(`[Error] ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Proxy error', details: err.message }));
    }
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.writeHead(504, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Timeout' }));
    }
  });

  proxyReq.end();
}

/**
 * PPV.to stream proxy - fetches poocloud.in streams from residential IP
 * 
 * poocloud.in blocks:
 *   1. Datacenter IPs (Cloudflare, AWS, etc.)
 *   2. IPv6 requests (Cloudflare returns 403 for IPv6!)
 * 
 * Requires:
 *   - Referer: https://modistreams.org/
 *   - Origin: https://modistreams.org
 *   - IPv4 connection (family: 4)
 * 
 * This proxy fetches from a residential IP with the required headers.
 */
function proxyPPVStream(targetUrl, res) {
  const url = new URL(targetUrl);
  const client = url.protocol === 'https:' ? https : http;
  
  // Validate domain - only allow poocloud.in
  if (!url.hostname.endsWith('poocloud.in')) {
    console.log(`[PPV] Invalid domain: ${url.hostname}`);
    res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ error: 'Invalid domain - only poocloud.in allowed' }));
  }
  
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://modistreams.org/',
    'Origin': 'https://modistreams.org',
    'Connection': 'keep-alive',
  };

  const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    method: 'GET',
    headers,
    timeout: 30000,
    family: 4, // CRITICAL: Force IPv4 - poocloud.in blocks IPv6 via Cloudflare!
  };

  console.log(`[PPV] Proxying: ${targetUrl.substring(0, 80)}...`);

  const proxyReq = client.request(options, (proxyRes) => {
    const contentType = proxyRes.headers['content-type'] || 'application/octet-stream';
    
    console.log(`[PPV] Response: ${proxyRes.statusCode} - ${contentType}`);
    
    // For m3u8 playlists, we need to rewrite URLs
    if (contentType.includes('mpegurl') || targetUrl.endsWith('.m3u8') || targetUrl.includes('.m3u8?')) {
      const chunks = [];
      
      proxyRes.on('data', chunk => chunks.push(chunk));
      
      proxyRes.on('end', () => {
        const data = Buffer.concat(chunks);
        const text = data.toString('utf8');
        
        console.log(`[PPV] M3U8 content: ${data.length} bytes`);
        
        // Get base URL for relative paths
        const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
        
        // Rewrite URLs in the playlist to go through this proxy
        // Note: The CF worker will call this endpoint, so we return relative URLs
        // that the CF worker will then rewrite to its own /ppv/stream endpoint
        const rewritten = text.split('\n').map(line => {
          const trimmed = line.trim();
          
          // Skip empty lines
          if (trimmed === '') return line;
          
          // Handle EXT-X-KEY URI
          if (trimmed.includes('URI="')) {
            return trimmed.replace(/URI="([^"]+)"/, (_, uri) => {
              const fullUrl = uri.startsWith('http') ? uri : baseUrl + uri;
              // Return the full URL - CF worker will rewrite it
              return `URI="${fullUrl}"`;
            });
          }
          
          // Skip other comments
          if (trimmed.startsWith('#')) return line;
          
          // Rewrite segment URLs to full URLs
          if (trimmed.startsWith('http')) {
            return trimmed; // Already absolute
          } else if (trimmed.endsWith('.ts') || trimmed.endsWith('.m3u8') || 
                     trimmed.includes('.ts?') || trimmed.includes('.m3u8?')) {
            return baseUrl + trimmed;
          }
          
          return line;
        }).join('\n');

        res.writeHead(proxyRes.statusCode, {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Content-Length': Buffer.byteLength(rewritten),
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache',
        });
        res.end(rewritten);
      });
    } else {
      // For binary content (ts segments), stream directly
      const chunks = [];
      
      proxyRes.on('data', chunk => chunks.push(chunk));
      
      proxyRes.on('end', () => {
        const data = Buffer.concat(chunks);
        
        console.log(`[PPV] Binary content: ${data.length} bytes`);
        
        res.writeHead(proxyRes.statusCode, {
          'Content-Type': contentType,
          'Content-Length': data.length,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache',
        });
        res.end(data);
      });
    }
  });

  proxyReq.on('error', (err) => {
    console.error(`[PPV Error] ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'PPV proxy error', details: err.message }));
    }
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.writeHead(504, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'PPV proxy timeout' }));
    }
  });

  proxyReq.end();
}

// ============================================================================
// CDN-LIVE HELPERS
// cdn-live.tv, edge.cdn-live.ru, cdn-live-tv.cfd, edge.cdn-google.ru
// All resolve to 195.128.27.233 but block Cloudflare/datacenter IPs
// ============================================================================

const CDN_LIVE_DOMAINS = [
  'cdn-live.tv',
  'cdn-live-tv.ru', 'cdn-live-tv.cfd',
  'edge.cdn-live.ru', 'edge.cdn-live-tv.ru', 'edge.cdn-live-tv.cfd',
  'edge.cdn-google.ru',
];

function isCdnLiveDomain(urlStr) {
  try {
    const h = new URL(urlStr).hostname.toLowerCase();
    return CDN_LIVE_DOMAINS.some(d => h === d || h.endsWith('.' + d));
  } catch {
    return false;
  }
}

/** Decode HUNTER obfuscation: eval(function(h,u,n,t,e,r){...}) */
function cdnLiveDecodeHunter(encodedData, charset, base, offset) {
  let result = '', i = 0;
  const delimiter = charset[base];
  if (!delimiter) return '';
  while (i < encodedData.length) {
    let s = '';
    while (i < encodedData.length && encodedData[i] !== delimiter) { s += encodedData[i]; i++; }
    i++;
    if (!s) continue;
    let numStr = '', valid = true;
    for (const c of s) {
      const idx = charset.indexOf(c);
      if (idx === -1) { valid = false; break; }
      numStr += idx.toString();
    }
    if (!valid || !numStr) continue;
    const charCode = parseInt(numStr, base) - offset;
    if (!isNaN(charCode) && charCode > 0 && charCode < 65536) result += String.fromCharCode(charCode);
  }
  return result;
}

/** Extract HUNTER params from HTML */
function cdnLiveGetHunterParams(html) {
  const evalIdx = html.indexOf('eval(function(h,u,n,t,e,r)');
  if (evalIdx === -1) return null;
  const evalBlock = html.substring(evalIdx);

  let pd = 0, ee = -1;
  const maxScan = Math.min(evalBlock.length, 500000);
  for (let i = 0; i < maxScan; i++) {
    if (evalBlock[i] === '(') pd++;
    if (evalBlock[i] === ')') { pd--; if (pd === 0) { ee = i; break; } }
  }
  if (ee === -1) return null;

  const tail = evalBlock.substring(Math.max(0, ee - 500), ee + 5);
  let pm = tail.match(/",(\d+),"(\w+)",(\d+),(\d+),(\d+)\)\)/);
  if (!pm) pm = tail.match(/",\s*(\d+)\s*,\s*"(\w+)"\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)\s*\)/);
  if (!pm) return null;

  const charset = pm[2], offset = parseInt(pm[3]), base = parseInt(pm[4]);
  const fullEval = evalBlock.substring(0, ee + 1);
  const dsi = fullEval.lastIndexOf('}("');
  if (dsi === -1) return null;
  const afterMarker = fullEval.substring(dsi + 3);
  const dei = afterMarker.indexOf('",');
  if (dei === -1) return null;

  return { encodedData: afterMarker.substring(0, dei), charset, offset, base };
}

/** Extract base64-concatenated URLs from decoded HUNTER script */
function cdnLiveExtractUrls(decoded) {
  let fnMatch = decoded.match(/function\s+(\w+)\s*\(\s*str\s*\)/);
  if (!fnMatch) fnMatch = decoded.match(/function\s+(\w+)\s*\(\s*\w+\s*\)\s*\{[^}]*atob/);
  if (!fnMatch) return [];
  const fn = fnMatch[1];

  const b64Vars = {};
  let m;
  const bp = /(?:const|let|var)\s+(\w+)\s*=\s*'([A-Za-z0-9+\/_-]+={0,2})'/g;
  while ((m = bp.exec(decoded)) !== null) b64Vars[m[1]] = m[2];

  const cp = new RegExp('(?:const|let|var)\\s+\\w+\\s*=\\s*(' + fn + '\\s*\\(\\s*\\w+\\s*\\)(?:\\s*\\+\\s*' + fn + '\\s*\\(\\s*\\w+\\s*\\))*)', 'g');
  const pp = new RegExp(fn + '\\s*\\(\\s*(\\w+)\\s*\\)', 'g');
  const urls = [];
  while ((m = cp.exec(decoded)) !== null) {
    pp.lastIndex = 0;
    let rm, url = '';
    while ((rm = pp.exec(m[1])) !== null) {
      if (b64Vars[rm[1]]) {
        let b64 = b64Vars[rm[1]].replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4) b64 += '=';
        try { url += Buffer.from(b64, 'base64').toString(); } catch {}
      }
    }
    if (url) urls.push(url);
  }
  return urls;
}

/** Full extraction pipeline: HTML → HUNTER decode → M3U8 URL */
function cdnLiveExtractM3U8(html) {
  const params = cdnLiveGetHunterParams(html);
  if (!params) { console.log('[CDN-Live] No HUNTER params found'); return null; }

  console.log(`[CDN-Live] HUNTER: charset="${params.charset}" base=${params.base} offset=${params.offset} dataLen=${params.encodedData.length}`);
  const decoded = cdnLiveDecodeHunter(params.encodedData, params.charset, params.base, params.offset);
  if (!decoded || decoded.length < 50) { console.log(`[CDN-Live] Decode too short: ${decoded?.length || 0}`); return null; }

  console.log(`[CDN-Live] Decoded ${decoded.length} chars`);
  const urls = cdnLiveExtractUrls(decoded);
  if (urls.length > 0) {
    console.log(`[CDN-Live] Found ${urls.length} URLs`);
    return urls.find(u => u.includes('token=')) || urls.find(u => u.includes('.m3u8')) || urls[0];
  }

  const m3u8Match = decoded.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/);
  if (m3u8Match) { console.log('[CDN-Live] Fallback regex match'); return m3u8Match[0]; }

  console.log('[CDN-Live] No URLs found');
  return null;
}

/** Proxy a cdn-live CDN request (M3U8, segments, keys) from residential IP */
function proxyCdnLiveRequest(targetUrl, res) {
  const url = new URL(targetUrl);

  const options = {
    hostname: url.hostname,
    port: url.port || 443,
    path: url.pathname + url.search,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Referer': 'https://cdn-live.tv/',
      'Origin': 'https://cdn-live.tv',
    },
    timeout: 15000,
    rejectUnauthorized: false,
    agent: cdnLiveAgent,
  };

  console.log(`[CDN-Live Proxy] → ${url.hostname}${url.pathname.substring(0, 60)}`);

  const proxyReq = https.request(options, (proxyRes) => {
    const ct = proxyRes.headers['content-type'] || 'application/octet-stream';
    console.log(`[CDN-Live Proxy] ← ${proxyRes.statusCode} ${ct}`);

    res.writeHead(proxyRes.statusCode, {
      'Content-Type': ct,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
      'Cache-Control': ct.includes('mpegurl') ? 'no-cache' : 'max-age=5',
      'X-Proxied-By': 'rpi-cdnlive',
    });
    proxyRes.pipe(res);

    proxyRes.on('error', (err) => {
      console.error(`[CDN-Live Proxy] Stream error: ${err.message}`);
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
  });

  proxyReq.on('error', (err) => {
    console.error(`[CDN-Live Proxy] Error: ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'CDN-Live proxy error', details: err.message }));
    }
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.writeHead(504, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'CDN-Live proxy timeout' }));
    }
  });

  proxyReq.end();
}

// Keep-alive HTTPS agent for cdn-live — reuses TCP/TLS connections
// Saves ~200-400ms per request by skipping TLS handshake
const cdnLiveAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 10,
  rejectUnauthorized: false,
});

const CDN_LIVE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Fetch a URL from cdn-live and return the body as a string (uses keep-alive) */
function cdnLiveFetchContent(targetUrl) {
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: 'GET',
      headers: {
        'User-Agent': CDN_LIVE_UA,
        'Accept': '*/*',
        'Referer': 'https://cdn-live.tv/',
        'Origin': 'https://cdn-live.tv',
      },
      timeout: 10000,
      agent: cdnLiveAgent,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`CDN HTTP ${res.statusCode}`));
        } else {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('CDN fetch timeout')); });
    req.end();
  });
}

/** Fetch player page + decode HUNTER → return { success, m3u8Url } */
async function cdnLiveFetchAndExtract(name, code) {
  const playerUrl = `https://cdn-live.tv/api/v1/channels/player/?name=${encodeURIComponent(name)}&code=${code}&user=cdnlivetv&plan=free`;

  const html = await new Promise((resolve, reject) => {
    const u = new URL(playerUrl);
    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: 'GET',
      headers: {
        'User-Agent': CDN_LIVE_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://cdn-live.tv/',
      },
      timeout: 10000,
      agent: cdnLiveAgent,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Player page HTTP ${res.statusCode}`));
        } else {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Player page timeout')); });
    req.end();
  });

  console.log(`[CDN-Live Extract] HTML ${html.length}b`);

  const m3u8Url = cdnLiveExtractM3U8(html);
  if (!m3u8Url) {
    return { success: false, error: 'No M3U8 URL found in player page', htmlLength: html.length };
  }

  console.log(`[CDN-Live Extract] OK: ${m3u8Url.substring(0, 80)}...`);
  return { success: true, m3u8Url };
}

// ============================================================================
// DLHD reCAPTCHA v3 IP Whitelist — ON-DEMAND per-channel whitelisting
// 
// CRITICAL CONSTRAINT (discovered Mar 9 2026):
//   DLHD limits to 13 unique channels per 30 minutes per IP.
//   Exceeding this returns: {"error":"channel_limit_exceeded"}
//
// Strategy:
//   - NO background daemon (wastes slots)
//   - Whitelist ONLY on-demand when a key request gets a poison key
//   - Track channel budget with a 30-min sliding window
//   - Per-channel cooldown: don't re-whitelist same channel within 25 min
// ============================================================================
const WHITELIST_BUDGET = 13;          // max unique channels per window
const WHITELIST_WINDOW_MS = 30 * 60 * 1000;  // 30 minutes
const WHITELIST_CHANNEL_COOLDOWN_MS = 25 * 60 * 1000; // 25 min per-channel cooldown

const dlhdWhitelistState = {
  lastSuccess: 0,
  lastAttempt: 0,
  lastError: null,
  consecutiveFailures: 0,
  isWhitelisted: false,
  // Sliding window: array of { channel, timestamp }
  recentWhitelists: [],
  // Per-channel last success: channel -> timestamp
  perChannelSuccess: {},
};

/**
 * Get how many budget slots are available in the current 30-min window
 */
function getWhitelistBudget() {
  const now = Date.now();
  // Prune expired entries
  dlhdWhitelistState.recentWhitelists = dlhdWhitelistState.recentWhitelists.filter(
    e => (now - e.timestamp) < WHITELIST_WINDOW_MS
  );
  // Count unique channels in window
  const uniqueChannels = new Set(dlhdWhitelistState.recentWhitelists.map(e => e.channel));
  return {
    used: uniqueChannels.size,
    remaining: Math.max(0, WHITELIST_BUDGET - uniqueChannels.size),
    channels: [...uniqueChannels],
    oldestExpiry: dlhdWhitelistState.recentWhitelists.length > 0
      ? Math.round((WHITELIST_WINDOW_MS - (now - dlhdWhitelistState.recentWhitelists[0].timestamp)) / 1000)
      : null,
  };
}

/**
 * Check if a channel is already whitelisted (within cooldown period)
 */
function isChannelWhitelisted(channel) {
  const lastSuccess = dlhdWhitelistState.perChannelSuccess[channel];
  if (!lastSuccess) return false;
  return (Date.now() - lastSuccess) < WHITELIST_CHANNEL_COOLDOWN_MS;
}

/**
 * Record a successful whitelist
 */
function recordWhitelistSuccess(channel) {
  const now = Date.now();
  dlhdWhitelistState.perChannelSuccess[channel] = now;
  dlhdWhitelistState.recentWhitelists.push({ channel, timestamp: now });
  dlhdWhitelistState.lastSuccess = now;
  dlhdWhitelistState.isWhitelisted = true;
  dlhdWhitelistState.consecutiveFailures = 0;
  dlhdWhitelistState.lastError = null;
}

// ============================================================================
// DLHD Key Cache — cache real (non-poison) keys to avoid burning whitelist slots
//
// Key numbers stay the same for minutes at a time. Caching a valid key means
// unlimited clients can watch the same channel without each needing a whitelist.
// Only 1 whitelist slot is burned per channel per key rotation (~every few min).
// ============================================================================
const KEY_CACHE_TTL_V6 = 5 * 60 * 1000; // 5 minutes
const dlhdKeyCache = new Map(); // "premium{ch}/{keyNum}" -> { key: Buffer, expires: number }

function getCachedKey(keyPath) {
  const cached = dlhdKeyCache.get(keyPath);
  if (cached && cached.expires > Date.now()) return cached.key;
  if (cached) dlhdKeyCache.delete(keyPath);
  return null;
}

function setCachedKey(keyPath, keyBuf) {
  dlhdKeyCache.set(keyPath, { key: keyBuf, expires: Date.now() + KEY_CACHE_TTL_V6 });
  // Evict old entries if cache grows too large
  if (dlhdKeyCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of dlhdKeyCache.entries()) {
      if (v.expires < now) dlhdKeyCache.delete(k);
    }
  }
}

function getKeyCacheStats() {
  const now = Date.now();
  let active = 0;
  for (const v of dlhdKeyCache.values()) {
    if (v.expires > now) active++;
  }
  return { total: dlhdKeyCache.size, active };
}

async function whitelistRPIViaRecaptcha(channel = 'premium44') {
  dlhdWhitelistState.lastAttempt = Date.now();
  
  try {
    // =========================================================================
    // Puppeteer-based reCAPTCHA v3 (gets score 0.9 — actually whitelists IP)
    // The HTTP-only rust-fetch bypass gets score 0.1-0.3 which does NOT whitelist.
    // =========================================================================
    let puppeteer;
    try { puppeteer = require('puppeteer-core'); } catch {
      try { puppeteer = require('puppeteer'); } catch { puppeteer = null; }
    }
    
    if (!puppeteer) {
      console.log(`[DLHD-Whitelist] ⚠️ Puppeteer not installed — falling back to rust-fetch (LOW score, may not whitelist)`);
      return await whitelistViaRustFetch(channel);
    }

    console.log(`[DLHD-Whitelist] Solving reCAPTCHA v3 via Puppeteer (real browser)...`);
    
    const SITE_KEY = '6LfJv4AsAAAAALTLEHKaQ7LN_VYfFqhLPrB2Tvgj';
    const chromePaths = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'];
    let chromePath = null;
    for (const p of chromePaths) {
      try { require('fs').accessSync(p); chromePath = p; break; } catch {}
    }
    
    if (!chromePath) {
      console.log(`[DLHD-Whitelist] ⚠️ No Chromium found — falling back to rust-fetch`);
      return await whitelistViaRustFetch();
    }

    const browser = await puppeteer.launch({
      headless: 'new',
      executablePath: chromePath,
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
        '--disable-gpu', '--no-first-run', '--no-zygote', '--single-process',
        '--disable-extensions', '--disable-blink-features=AutomationControlled',
      ],
    });

    try {
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36');
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      });

      // Intercept navigation — serve minimal HTML that loads reCAPTCHA
      // (The real player page has window===window.top redirect that blocks headless)
      await page.setRequestInterception(true);
      let intercepted = false;
      page.on('request', req => {
        if (!intercepted && req.isNavigationRequest()) {
          intercepted = true;
          req.respond({
            status: 200,
            contentType: 'text/html',
            body: `<!DOCTYPE html><html><head>
              <script src="https://www.google.com/recaptcha/api.js?render=${SITE_KEY}"></script>
            </head><body><script>
              window.__recaptchaReady = false;
              (function check() {
                if (typeof grecaptcha !== 'undefined' && typeof grecaptcha.execute === 'function') {
                  window.__recaptchaReady = true; return;
                }
                setTimeout(check, 200);
              })();
            </script></body></html>`,
          });
        } else {
          req.continue();
        }
      });

      const channelNum = channel.replace('premium', '');
      await page.goto(`https://www.ksohls.ru/premiumtv/daddyhd.php?id=${channelNum}`, {
        waitUntil: 'networkidle2', timeout: 30000,
      });

      await page.waitForFunction(() => window.__recaptchaReady === true, { timeout: 20000 });
      await new Promise(r => setTimeout(r, 1500));

      // Execute reCAPTCHA v3
      const token = await page.evaluate((sk) => {
        return new Promise((resolve, reject) => {
          grecaptcha.ready(() => {
            grecaptcha.execute(sk, { action: 'player_access' }).then(resolve).catch(reject);
          });
        });
      }, SITE_KEY);

      console.log(`[DLHD-Whitelist] Puppeteer token: ${token.length} chars`);

      // POST to verify from browser context (same IP)
      const verifyResult = await page.evaluate(async (url, tok, ch) => {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 'recaptcha-token': tok, 'channel_id': ch }),
        });
        return r.json();
      }, 'https://chevy.soyspace.cyou/verify', token, channel);

      console.log(`[DLHD-Whitelist] Verify response:`, verifyResult);

      if (verifyResult.success) {
        recordWhitelistSuccess(channel);
        dlhdWhitelistState.lastScore = verifyResult.score || null;
        dlhdWhitelistState.lastVerifyResponse = verifyResult;
        console.log(`[DLHD-Whitelist] ✅ IP whitelisted via Puppeteer for ${channel}! Score: ${verifyResult.score || 'N/A'}`);
      } else {
        dlhdWhitelistState.consecutiveFailures++;
        dlhdWhitelistState.lastError = `Verify failed: ${JSON.stringify(verifyResult)}`;
        dlhdWhitelistState.lastScore = verifyResult.score || null;
        dlhdWhitelistState.lastVerifyResponse = verifyResult;
        console.log(`[DLHD-Whitelist] ❌ Verify failed for ${channel}:`, verifyResult);
      }
    } finally {
      await browser.close();
    }
  } catch (err) {
    dlhdWhitelistState.consecutiveFailures++;
    dlhdWhitelistState.lastError = err.message;
    console.error(`[DLHD-Whitelist] ❌ Puppeteer error: ${err.message}`);
    // Fallback to rust-fetch on Puppeteer failure
    console.log(`[DLHD-Whitelist] Falling back to rust-fetch...`);
    try { await whitelistViaRustFetch(channel); } catch (e2) {
      console.error(`[DLHD-Whitelist] ❌ rust-fetch fallback also failed: ${e2.message}`);
    }
  }
}

// Legacy rust-fetch based whitelist (LOW score — usually doesn't actually whitelist)
async function whitelistViaRustFetch(channel = 'premium44') {
  console.log(`[DLHD-Whitelist] Solving reCAPTCHA v3 via rust-fetch for ${channel}...`);
  const token = await new Promise((resolve, reject) => {
    const args = [
      '--mode', 'recaptcha-v3',
      '--url', 'https://www.ksohls.ru/',
      '--site-key', '6LfJv4AsAAAAALTLEHKaQ7LN_VYfFqhLPrB2Tvgj',
      '--action', 'player_access',
      '--timeout', '30',
    ];
    const rust = spawn('rust-fetch', args);
    let stdout = '', stderr = '';
    rust.stdout.on('data', (d) => { stdout += d.toString(); });
    rust.stderr.on('data', (d) => { stderr += d.toString(); });
    rust.on('error', (err) => reject(new Error(`spawn error: ${err.message}`)));
    rust.on('close', (code) => {
      if (code !== 0) { reject(new Error(`rust-fetch exit ${code}: ${stderr.substring(0, 500)}`)); return; }
      const trimmed = stdout.trim();
      if (!trimmed || trimmed.length < 20) { reject(new Error(`Invalid token: ${trimmed.substring(0, 100)}`)); return; }
      resolve(trimmed);
    });
  });

  console.log(`[DLHD-Whitelist] rust-fetch token: ${token.length} chars`);

  const verifyResult = await new Promise((resolve, reject) => {
    const postData = JSON.stringify({ 'recaptcha-token': token, 'channel_id': channel });
    const verifyReq = require('https').request({
      hostname: 'chevy.soyspace.cyou', path: '/verify', method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
        'Origin': 'https://www.ksohls.ru', 'Referer': 'https://www.ksohls.ru/',
      },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error(`Not JSON: ${data.substring(0, 200)}`)); } });
    });
    verifyReq.on('error', (err) => reject(new Error(`Verify error: ${err.message}`)));
    verifyReq.on('timeout', () => { verifyReq.destroy(); reject(new Error('Verify timeout')); });
    verifyReq.write(postData);
    verifyReq.end();
  });

  console.log(`[DLHD-Whitelist] rust-fetch verify:`, verifyResult);
  if (verifyResult.success) {
    recordWhitelistSuccess(channel);
    dlhdWhitelistState.lastScore = verifyResult.score || null;
    dlhdWhitelistState.lastVerifyResponse = verifyResult;
    console.log(`[DLHD-Whitelist] ✅ rust-fetch whitelist done for ${channel}. Score: ${verifyResult.score || 'N/A'}`);
  } else {
    dlhdWhitelistState.consecutiveFailures++;
    dlhdWhitelistState.lastError = `rust-fetch verify failed: ${JSON.stringify(verifyResult)}`;
    dlhdWhitelistState.lastScore = verifyResult.score || null;
    dlhdWhitelistState.lastVerifyResponse = verifyResult;
  }
}

const server = http.createServer(async (req, res) => {
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'X-API-Key, Content-Type',
    });
    return res.end();
  }

  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  const reqUrl = new URL(req.url, `http://${req.headers.host}`);

  // Health check - no auth required
  if (reqUrl.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ 
      status: 'ok', 
      timestamp: Date.now(),
      method: 'FRESH-AUTH-EVERY-REQUEST',
      caching: 'DISABLED for keys/auth/m3u8',
    }));
  }

  // Whitelist status - no auth required (informational)
  if (reqUrl.pathname === '/whitelist-status') {
    const now = Date.now();
    const budget = getWhitelistBudget();
    
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({
      whitelisted: dlhdWhitelistState.isWhitelisted,
      lastSuccess: dlhdWhitelistState.lastSuccess || null,
      lastAttempt: dlhdWhitelistState.lastAttempt || null,
      consecutiveFailures: dlhdWhitelistState.consecutiveFailures,
      lastError: dlhdWhitelistState.lastError,
      lastScore: dlhdWhitelistState.lastScore || null,
      lastVerifyResponse: dlhdWhitelistState.lastVerifyResponse || null,
      budget,
      whitelistedChannels: Object.entries(dlhdWhitelistState.perChannelSuccess)
        .filter(([_, ts]) => (now - ts) < WHITELIST_CHANNEL_COOLDOWN_MS)
        .map(([ch, ts]) => ({ channel: ch, expiresInSecs: Math.round((WHITELIST_CHANNEL_COOLDOWN_MS - (now - ts)) / 1000) })),
      keyCache: getKeyCacheStats(),
    }));
  }

  // Check API key (header or query param) for all other endpoints
  // SECURITY: Use timing-safe comparison to prevent timing attacks
  const apiKey = req.headers['x-api-key'] || reqUrl.searchParams.get('key');
  if (!timingSafeApiKeyCheck(apiKey, API_KEY)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Unauthorized' }));
  }

  // SECURITY: Validate origin for non-health endpoints
  // CF Worker should send X-Forwarded-Origin header
  const origin = req.headers['origin'];
  const referer = req.headers['referer'];
  const forwardedOrigin = req.headers['x-forwarded-origin'];
  
  let originAllowed = isAllowedOrigin(origin) || isAllowedOrigin(forwardedOrigin);
  if (!originAllowed && referer) {
    try {
      originAllowed = isAllowedOrigin(new URL(referer).origin);
    } catch {}
  }
  
  // Allow requests without origin header if they have valid API key
  // (for server-to-server calls from CF Worker)
  // But log for monitoring
  if (!originAllowed && !origin && !forwardedOrigin) {
    console.log(`[Security] Request without origin from ${clientIp} - allowed via API key`);
    originAllowed = true; // Allow server-to-server with valid API key
  }
  
  if (!originAllowed) {
    console.log(`[Security] Blocked request from unauthorized origin: ${origin || forwardedOrigin || referer}`);
    res.writeHead(403, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Origin not allowed' }));
  }

  // Rate limiting — skip for authenticated requests (valid API key)
  // Only rate-limit unauthenticated requests by client IP
  if (!checkRateLimit(clientIp, !!apiKey)) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Rate limited', retryAfter: 60 }));
  }

  // DLHD Heartbeat endpoint - establishes session for key fetching
  // This is needed because heartbeat endpoint blocks datacenter IPs
  // CF Worker calls this BEFORE fetching keys
  if (reqUrl.pathname === '/heartbeat') {
    const channel = reqUrl.searchParams.get('channel');
    const server = reqUrl.searchParams.get('server');
    const domain = reqUrl.searchParams.get('domain') || 'soyspace.cyou';
    
    if (!channel || !server) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ 
        error: 'Missing channel or server parameter',
        usage: '/heartbeat?channel=51&server=zeko&domain=soyspace.cyou'
      }));
    }
    
    // Get auth data first (token, country, timestamp)
    const authData = await fetchAuthToken(channel);
    if (!authData || !authData.token) {
      res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: 'Failed to get auth token' }));
    }
    
    // Establish heartbeat session with CLIENT_TOKEN
    const result = await establishHeartbeatSession(channel, server, domain, authData.token, authData.country, authData.timestamp);
    
    res.writeHead(result.success ? 200 : 502, { 
      'Content-Type': 'application/json', 
      'Access-Control-Allow-Origin': '*' 
    });
    res.end(JSON.stringify({
      success: result.success,
      channel,
      server,
      domain,
      expiry: result.expiry,
      error: result.error,
    }));
    return;
  }

  // ============================================================================
  // /vidsrc-extract — Full VidSrc extraction chain done locally on RPI
  // Does the entire 4-step flow: embed → RCP → prorcp → m3u8
  // Uses SOCKS5 for cloudnestra steps (Turnstile bypass), residential for embed
  // CF Worker calls this ONE endpoint instead of 4 separate /fetch-socks5 calls
  // ============================================================================
  if (reqUrl.pathname === '/vidsrc-extract') {
    const tmdbId = reqUrl.searchParams.get('tmdbId');
    const type = reqUrl.searchParams.get('type') || 'movie';
    const season = reqUrl.searchParams.get('season');
    const episode = reqUrl.searchParams.get('episode');

    if (!tmdbId) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: 'Missing tmdbId parameter' }));
    }

    const startTime = Date.now();
    console.log(`[VidSrc-Extract] Starting extraction for ${type}/${tmdbId}${season ? ` S${season}E${episode}` : ''}`);

    const embedDomains = ['vsembed.ru', 'vidsrc-embed.ru'];
    const cdnDomains = ['cloudnestra.com', 'cloudnestra.net', 'shadowlandschronicles.com', 'shadowlandschronicles.net', 'shadowlandschronicles.org', 'embedsito.com'];

    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    // Race N proxies in parallel — first success wins, losers get trashed
    const PARALLEL_PROXY_COUNT = 6;
    const SOCKS5_ATTEMPT_TIMEOUT = 8000;

    function singleSocks5Attempt(target, targetPort, useTls, customHeaders, proxy) {
      return new Promise((resolve) => {
        let done = false;
        const finish = (result) => { if (!done) { done = true; clearTimeout(timer); resolve(result); } };

        const timer = setTimeout(() => {
          markProxyFailed(proxy.str);
          finish({ success: false, error: 'timeout', proxyStr: proxy.str });
        }, SOCKS5_ATTEMPT_TIMEOUT);

        try {
          const socket = net.connect(proxy.port, proxy.host, () => {
            socket.write(Buffer.from([0x05, 0x01, 0x00]));
          });
          let step = 'greeting';

          socket.on('error', () => { try { socket.destroy(); } catch {} markProxyFailed(proxy.str); finish({ success: false, error: 'socket error', proxyStr: proxy.str }); });
          socket.setTimeout(SOCKS5_ATTEMPT_TIMEOUT - 1000, () => { try { socket.destroy(); } catch {} markProxyFailed(proxy.str); finish({ success: false, error: 'socket timeout', proxyStr: proxy.str }); });

          socket.on('data', (data) => {
            if (done) return;
            if (step === 'greeting') {
              if (data[0] !== 0x05 || data[1] !== 0x00) { try { socket.destroy(); } catch {} markProxyFailed(proxy.str); finish({ success: false, proxyStr: proxy.str }); return; }
              step = 'connect';
              const hostBuf = Buffer.from(target.hostname);
              const portBuf = Buffer.alloc(2);
              portBuf.writeUInt16BE(targetPort);
              socket.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]), hostBuf, portBuf]));
            } else if (step === 'connect') {
              if (data[0] !== 0x05 || data[1] !== 0x00) { try { socket.destroy(); } catch {} markProxyFailed(proxy.str); finish({ success: false, proxyStr: proxy.str }); return; }
              step = 'connected';
              if (useTls) {
                const tlsSocket = tls.connect({ socket, servername: target.hostname, rejectUnauthorized: false }, () => { doRequest(tlsSocket); });
                tlsSocket.on('error', () => { markProxyFailed(proxy.str); finish({ success: false, proxyStr: proxy.str }); });
              } else {
                doRequest(socket);
              }
            }
          });

          function decodeChunked(buf) {
            // Decode HTTP chunked transfer encoding from raw buffer
            const parts = [];
            let pos = 0;
            const str = buf.toString('latin1');
            while (pos < str.length) {
              const lineEnd = str.indexOf('\r\n', pos);
              if (lineEnd === -1) break;
              const chunkSize = parseInt(str.substring(pos, lineEnd), 16);
              if (isNaN(chunkSize) || chunkSize === 0) break;
              const dataStart = lineEnd + 2;
              const dataEnd = dataStart + chunkSize;
              if (dataEnd > buf.length) break;
              parts.push(buf.slice(dataStart, dataEnd));
              pos = dataEnd + 2; // skip trailing \r\n
            }
            return Buffer.concat(parts);
          }

          function doRequest(sock) {
            const path = target.pathname + target.search;
            let reqStr = `GET ${path} HTTP/1.1\r\nHost: ${target.hostname}\r\nConnection: close\r\n`;
            for (const [k, v] of Object.entries(customHeaders)) reqStr += `${k}: ${v}\r\n`;
            reqStr += '\r\n';
            sock.write(reqStr);
            const chunks = [];
            sock.on('data', c => chunks.push(c));
            sock.on('end', () => {
              if (done) return;
              try {
                const raw = Buffer.concat(chunks);
                const rawStr = raw.toString('latin1');
                const headerEnd = rawStr.indexOf('\r\n\r\n');
                if (headerEnd === -1) { finish({ success: false, error: 'no header boundary', proxyStr: proxy.str }); return; }
                const headerPart = rawStr.substring(0, headerEnd).toLowerCase();
                const statusLine = rawStr.substring(0, rawStr.indexOf('\r\n'));
                const statusMatch = statusLine.match(/HTTP\/[\d.]+ (\d+)/i);
                const status = statusMatch ? parseInt(statusMatch[1]) : 502;
                const bodyOffset = Buffer.byteLength(rawStr.substring(0, headerEnd + 4), 'latin1');
                let bodyBuf = raw.slice(bodyOffset);
                // Handle chunked transfer encoding
                if (headerPart.includes('transfer-encoding: chunked')) {
                  bodyBuf = decodeChunked(bodyBuf);
                }
                const body = bodyBuf.toString('utf-8');
                if (status >= 200 && status < 400) {
                  finish({ success: true, status, body, proxy: proxy.str });
                } else {
                  markProxyFailed(proxy.str);
                  finish({ success: false, status, error: `HTTP ${status}`, proxyStr: proxy.str });
                }
              } catch (e) {
                finish({ success: false, error: 'parse error: ' + e.message, proxyStr: proxy.str });
              }
            });
          }
        } catch (e) {
          finish({ success: false, error: 'exception: ' + e.message, proxyStr: proxy.str });
        }
      });
    }

    function localSocks5Fetch(targetUrl, referer) {
      const target = new URL(targetUrl);
      const targetPort = target.protocol === 'https:' ? 443 : 80;
      const useTls = target.protocol === 'https:';

      const customHeaders = {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      };
      if (referer) {
        customHeaders['Referer'] = referer;
        try { customHeaders['Origin'] = new URL(referer).origin; } catch {}
      }

      // Grab N unique proxies from the pool
      const proxies = [];
      const seen = new Set();
      for (let i = 0; i < PARALLEL_PROXY_COUNT * 3 && proxies.length < PARALLEL_PROXY_COUNT; i++) {
        const p = getNextProxy();
        if (!seen.has(p.str)) { seen.add(p.str); proxies.push(p); }
      }

      console.log(`[VidSrc-Extract] Racing ${proxies.length} SOCKS5 proxies for ${target.hostname}${target.pathname.substring(0, 40)}`);

      // Launch all in parallel, use Promise.allSettled-style manual tracking
      return new Promise((resolve) => {
        let resolved = false;
        let failCount = 0;

        const safeResolve = (result) => {
          if (!resolved) { resolved = true; resolve(result); }
        };

        for (const proxy of proxies) {
          singleSocks5Attempt(target, targetPort, useTls, customHeaders, proxy)
            .then((result) => {
              if (resolved) return;
              if (result.success) {
                console.log(`[VidSrc-Extract] ✓ SOCKS5 winner: ${result.proxy} for ${target.hostname}`);
                safeResolve(result);
              } else {
                failCount++;
                if (failCount >= proxies.length) {
                  console.log(`[VidSrc-Extract] ✗ All ${proxies.length} SOCKS5 proxies failed for ${target.hostname}`);
                  safeResolve({ success: false, error: `All ${proxies.length} parallel proxies failed` });
                }
              }
            })
            .catch(() => {
              failCount++;
              if (failCount >= proxies.length && !resolved) {
                safeResolve({ success: false, error: 'All proxies threw errors' });
              }
            });
        }

        // Safety net
        setTimeout(() => safeResolve({ success: false, error: 'Parallel SOCKS5 race timeout' }), SOCKS5_ATTEMPT_TIMEOUT + 2000);
      });
    }

    // Helper: fetch via RPI residential IP (for embed page — no Turnstile)
    function localResidentialFetch(targetUrl, referer) {
      return new Promise((resolve) => {
        const u = new URL(targetUrl);
        const headers = {
          'User-Agent': UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        };
        if (referer) headers['Referer'] = referer;

        const proxyReq = https.request({
          hostname: u.hostname,
          port: u.port || 443,
          path: u.pathname + u.search,
          method: 'GET',
          headers,
          family: 4,
          timeout: 8000,
          rejectUnauthorized: false,
        }, (proxyRes) => {
          const chunks = [];
          proxyRes.on('data', c => chunks.push(c));
          proxyRes.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf-8');
            resolve({ success: proxyRes.statusCode >= 200 && proxyRes.statusCode < 400, status: proxyRes.statusCode, body });
          });
        });
        proxyReq.on('error', (err) => resolve({ success: false, error: err.message }));
        proxyReq.on('timeout', () => { proxyReq.destroy(); resolve({ success: false, error: 'timeout' }); });
        proxyReq.end();
      });
    }

    let lastError = 'All embed domains failed';

    for (const embedDomain of embedDomains) {
      try {
        // Step 1: Fetch embed page via residential IP (fast, no Turnstile)
        const embedPath = type === 'tv' && season && episode
          ? `/embed/tv/${tmdbId}/${season}/${episode}`
          : `/embed/movie/${tmdbId}`;
        const embedUrl = `https://${embedDomain}${embedPath}`;
        console.log(`[VidSrc-Extract] Step 1: ${embedUrl}`);

        const embedResp = await localResidentialFetch(embedUrl);
        if (!embedResp.success) {
          console.log(`[VidSrc-Extract] Embed failed from ${embedDomain}: ${embedResp.status || embedResp.error}`);
          lastError = `Embed ${embedDomain}: ${embedResp.error || embedResp.status}`;
          continue;
        }

        // Step 2: Extract RCP iframe
        const iframePatterns = [
          /<iframe[^>]*src=["']([^"']*\/rcp\/([^"']+))["']/i,
          /src=["']((?:https?:)?\/\/[^"']+\/rcp\/([^"']+))["']/i,
        ];
        let rcpHash = null, rcpDomain = 'cloudnestra.com';
        for (const pat of iframePatterns) {
          const m = embedResp.body.match(pat);
          if (m) {
            rcpHash = m[2];
            const full = m[1].startsWith('//') ? 'https:' + m[1] : m[1];
            try { rcpDomain = new URL(full).hostname; } catch {}
            break;
          }
        }
        if (!rcpHash) {
          console.log(`[VidSrc-Extract] No RCP iframe in ${embedDomain}`);
          lastError = `No RCP iframe in ${embedDomain}`;
          continue;
        }
        console.log(`[VidSrc-Extract] Step 2: RCP on ${rcpDomain} (hash: ${rcpHash.substring(0, 30)}...)`);

        // Step 3: Fetch RCP page via SOCKS5 (cloudnestra has Turnstile)
        const rcpUrl = `https://${rcpDomain}/rcp/${rcpHash}`;
        const rcpResp = await localSocks5Fetch(rcpUrl, `https://${embedDomain}/`);
        if (!rcpResp.success) {
          console.log(`[VidSrc-Extract] RCP failed: ${rcpResp.error}`);
          lastError = `RCP: ${rcpResp.error}`;
          continue;
        }
        if (rcpResp.body.includes('cf-turnstile') || rcpResp.body.includes('challenges.cloudflare.com')) {
          console.log(`[VidSrc-Extract] Turnstile on RCP even via SOCKS5`);
          lastError = 'Turnstile on RCP';
          continue;
        }

        // Step 4: Extract prorcp/srcrcp path
        const rcpPatterns = [
          { regex: /src:\s*['"]\/prorcp\/([^'"]+)['"]/i, t: 'prorcp' },
          { regex: /src:\s*['"]\/srcrcp\/([^'"]+)['"]/i, t: 'srcrcp' },
          { regex: /['"]\/prorcp\/([A-Za-z0-9+\/=\-_]+)['"]/i, t: 'prorcp' },
          { regex: /['"]\/srcrcp\/([A-Za-z0-9+\/=\-_]+)['"]/i, t: 'srcrcp' },
          { regex: /prorcp\/([A-Za-z0-9+\/=\-_]+)/i, t: 'prorcp' },
          { regex: /srcrcp\/([A-Za-z0-9+\/=\-_]+)/i, t: 'srcrcp' },
        ];
        let endpointPath = null, endpointType = 'prorcp';
        for (const { regex, t } of rcpPatterns) {
          const m = rcpResp.body.match(regex);
          if (m) { endpointPath = m[1]; endpointType = t; break; }
        }
        if (!endpointPath) {
          console.log(`[VidSrc-Extract] No prorcp/srcrcp in RCP page`);
          lastError = 'No prorcp in RCP';
          continue;
        }
        console.log(`[VidSrc-Extract] Step 3: ${endpointType}`);

        // Step 5: Fetch prorcp page via SOCKS5 (same cloudnestra domain)
        const prorcpUrl = `https://${rcpDomain}/${endpointType}/${endpointPath}`;
        const prorcpResp = await localSocks5Fetch(prorcpUrl, `https://${rcpDomain}/`);
        if (!prorcpResp.success) {
          console.log(`[VidSrc-Extract] Prorcp failed: ${prorcpResp.error}`);
          lastError = `Prorcp: ${prorcpResp.error}`;
          continue;
        }

        // Step 6: Extract m3u8 URL
        const filePatterns = [
          /file:\s*["']([^"']+)["']/,
          /file\s*=\s*["']([^"']+)["']/,
          /"file"\s*:\s*"([^"]+)"/,
          /sources\s*:\s*\[\s*\{\s*file\s*:\s*["']([^"']+)["']/,
          /src\s*:\s*["']([^"']+\.m3u8[^"']*)["']/,
        ];
        let fileUrl = null;
        for (const pat of filePatterns) {
          const m = prorcpResp.body.match(pat);
          if (m?.[1]) { fileUrl = m[1]; break; }
        }
        if (!fileUrl) {
          const m3u8Match = prorcpResp.body.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/);
          if (m3u8Match) fileUrl = m3u8Match[0];
        }
        if (!fileUrl) {
          console.log(`[VidSrc-Extract] No file URL in prorcp`);
          lastError = 'No file URL in prorcp';
          continue;
        }

        // Resolve URL alternatives (some have {v1}/{v2} placeholders)
        const alts = fileUrl.split(' or ');
        let resolvedUrl = null;
        for (const alt of alts) {
          if (alt.includes('{v')) {
            for (const domain of cdnDomains) {
              const resolved = alt.replace(/\{v\d+\}/g, domain);
              if (resolved.includes('.m3u8')) { resolvedUrl = resolved; break; }
            }
            if (resolvedUrl) break;
          } else if (alt.includes('.m3u8')) {
            resolvedUrl = alt;
            break;
          }
        }

        if (!resolvedUrl) {
          console.log(`[VidSrc-Extract] No valid m3u8 resolved from file URL`);
          lastError = 'No valid m3u8 resolved';
          continue;
        }

        const elapsed = Date.now() - startTime;
        console.log(`[VidSrc-Extract] ✅ Success in ${elapsed}ms via ${embedDomain}`);

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({
          success: true,
          m3u8_url: resolvedUrl,
          source: `rpi-vidsrc-${embedDomain}`,
          duration_ms: elapsed,
          embed_domain: embedDomain,
          rcp_domain: rcpDomain,
        }));
      } catch (e) {
        console.log(`[VidSrc-Extract] Error with ${embedDomain}: ${e.message}`);
        lastError = e.message;
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[VidSrc-Extract] ❌ All domains failed in ${elapsed}ms`);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({
      success: false,
      error: lastError,
      duration_ms: elapsed,
    }));
  }

  // DLHD Key V4 endpoint - simple passthrough with pre-computed auth headers
  // CF Worker computes PoW using WASM and passes JWT, timestamp, nonce
  // This endpoint just forwards the request from residential IP
  // ============================================================================
  // GENERIC FETCH — dumb pipe, no domain-specific logic
  // CF Worker computes all auth headers and tells RPI exactly what to fetch
  // ============================================================================
  // /fetch?url=<target>&headers=<json-encoded-headers>
  // Returns: raw response body with original status code and content-type
  if (reqUrl.pathname === '/fetch') {
    const targetUrl = reqUrl.searchParams.get('url');
    const headersJson = reqUrl.searchParams.get('headers');

    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: 'Missing url parameter' }));
    }

    let customHeaders = {};
    if (headersJson) {
      try { customHeaders = JSON.parse(headersJson); } catch {
        // Fallback: try decoding in case of legacy double-encoded callers
        try { customHeaders = JSON.parse(decodeURIComponent(headersJson)); } catch {}
      }
    }

    try {
      const decoded = decodeURIComponent(targetUrl);

      // SECURITY: domain allowlist
      if (!isAllowedProxyDomain(decoded)) {
        console.log(`[Fetch] Blocked: ${decoded.substring(0, 80)}`);
        res.writeHead(403, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ error: 'Domain not allowed' }));
      }

      const u = new URL(decoded);
      const client = u.protocol === 'https:' ? https : http;

      console.log(`[Fetch] → ${u.hostname}${u.pathname.substring(0, 60)}`);
      if (Object.keys(customHeaders).length > 0) {
        console.log(`[Fetch] Custom headers: ${Object.keys(customHeaders).join(', ')}`);
      }
      // Use Node.js built-in fetch() instead of https.request()
      // fetch() handles TLS/HTTP2 negotiation better and matches browser behavior
      // For DLHD key servers, use IPv6 (reCAPTCHA whitelist is per-IPv6 address)
      // For other domains, force IPv4 to avoid Cloudflare IPv6 issues
      const dlhdKeyDomains = ['go.ai-chatx.site', 'ai-chatx.site', 'chevy.vovlacosa.sbs', 'chevy.soyspace.cyou', 'arbitrageai.cc', 'vovlacosa.sbs', 'soyspace.cyou'];
      const isDlhdKey = dlhdKeyDomains.some(d => u.hostname === d || u.hostname.endsWith('.' + d));
      const ipFamily = isDlhdKey ? 6 : 4;
      console.log(`[Fetch] Using Node.js https.request (IPv${ipFamily}) for ${u.hostname}${isDlhdKey ? ' (DLHD key server — IPv6 whitelisted)' : ''}`);
      const proxyReq = https.request({
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*',
          ...customHeaders,
        },
        family: ipFamily, // IPv6 for DLHD key servers (whitelist is IPv6), IPv4 for others
        timeout: 15000,
        rejectUnauthorized: false,
      }, (proxyRes) => {
        const ct = proxyRes.headers['content-type'] || 'application/octet-stream';
        const cl = proxyRes.headers['content-length'];
        console.log(`[Fetch] ← ${proxyRes.statusCode} ${ct}${cl ? ` ${cl}b` : ''} from ${u.hostname}`);

        const responseHeaders = {
          'Content-Type': ct,
          'Access-Control-Allow-Origin': '*',
          'X-Proxied-By': 'rpi-fetch',
          'X-Upstream-Status': String(proxyRes.statusCode),
        };
        if (cl) responseHeaders['Content-Length'] = cl;

        res.writeHead(proxyRes.statusCode, responseHeaders);
        proxyRes.pipe(res);

        proxyRes.on('error', (err) => {
          console.error(`[Fetch] Stream error: ${err.message}`);
          if (!res.headersSent) res.writeHead(502);
          res.end();
        });
      });

      proxyReq.on('error', (err) => {
        console.error(`[Fetch] Error: ${err.message}`);
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      proxyReq.on('timeout', () => {
        proxyReq.destroy();
        if (!res.headersSent) {
          res.writeHead(504, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'Upstream timeout' }));
        }
      });

      proxyReq.end();
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Invalid URL' }));
    }
    return;
  }

  // ============================================================================
  // /debug/socks5-pool — Check SOCKS5 proxy pool status
  // ============================================================================
  if (reqUrl.pathname === '/debug/socks5-pool') {
    const pool = {
      poolSize: PROXY_POOL.validated.length,
      minRequired: PROXY_POOL_CONFIG.minPoolSize,
      isRefreshing: PROXY_POOL.validating,
      lastRefresh: PROXY_POOL.lastRefresh ? new Date(PROXY_POOL.lastRefresh).toISOString() : 'never',
      lastRefreshAgo: PROXY_POOL.lastRefresh ? `${Math.round((Date.now() - PROXY_POOL.lastRefresh) / 1000)}s ago` : 'never',
      nextRefresh: PROXY_POOL.lastRefresh ? `in ${Math.max(0, Math.round((PROXY_POOL.lastRefresh + PROXY_POOL_CONFIG.refreshIntervalMs - Date.now()) / 1000))}s` : 'pending',
      stats: {
        totalFetched: PROXY_POOL.totalFetched,
        totalValidated: PROXY_POOL.totalValidated,
        totalFailed: PROXY_POOL.totalFailed,
      },
      proxies: PROXY_POOL.validated.map(p => ({
        proxy: p.str,
        failures: p.failures,
        lastValidated: new Date(p.lastValidated).toISOString(),
      })),
    };
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify(pool, null, 2));
  }

  // ============================================================================
  // /fetch-socks5 — Fetch a URL through a SOCKS5 proxy with AUTO-RETRY
  // CF Worker calls this because it can't do SOCKS5+TLS directly (startTls SNI issue)
  // RPI acts as a bridge: CF Worker → RPI → SOCKS5 proxy → target
  // The RPI's own IP is banned, but the SOCKS5 proxy's IP isn't!
  //
  // AUTO-RETRY: If a proxy fails, automatically tries another proxy up to
  // MAX_SOCKS5_RETRIES times. Never returns a failure if there are proxies left.
  //
  // Query params:
  //   url=<target URL>
  //   headers=<JSON-encoded headers>
  //   proxy=<host:port> (optional, picks from built-in list if omitted)
  // ============================================================================
  if (reqUrl.pathname === '/fetch-socks5') {
    const targetUrl = reqUrl.searchParams.get('url');
    const headersJson = reqUrl.searchParams.get('headers');
    const proxyParam = reqUrl.searchParams.get('proxy');

    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: 'Missing url parameter' }));
    }

    // SECURITY: domain allowlist
    if (!isAllowedProxyDomain(decodeURIComponent(targetUrl))) {
      res.writeHead(403, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: 'Domain not allowed' }));
    }

    let customHeaders = {};
    if (headersJson) {
      try { customHeaders = JSON.parse(headersJson); } catch {
        try { customHeaders = JSON.parse(decodeURIComponent(headersJson)); } catch {}
      }
    }

    const target = new URL(decodeURIComponent(targetUrl));
    const targetPort = target.protocol === 'https:' ? 443 : 80;
    const useTls = target.protocol === 'https:';

    const MAX_SOCKS5_RETRIES = 5;
    const triedProxies = new Set();

    /**
     * Attempt a single SOCKS5 fetch through a given proxy.
     * Returns a Promise that resolves with { success, status, body, ct, proxyStr }
     * or { success: false, error, proxyStr }.
     */
    function attemptSocks5Fetch(proxyHost, proxyPort, proxyStr) {
      return new Promise((resolve) => {
        const attemptTimeout = setTimeout(() => {
          console.log(`[Fetch-SOCKS5] Timeout on ${proxyStr}`);
          markProxyFailed(proxyStr);
          resolve({ success: false, error: 'SOCKS5 proxy timeout', proxyStr });
        }, 12000);

        try {
          const socket = net.connect(proxyPort, proxyHost, () => {
            socket.write(Buffer.from([0x05, 0x01, 0x00]));
          });

          let step = 'greeting';

          socket.on('error', (err) => {
            clearTimeout(attemptTimeout);
            console.log(`[Fetch-SOCKS5] Socket error on ${proxyStr}: ${err.message}`);
            markProxyFailed(proxyStr);
            socket.destroy();
            resolve({ success: false, error: `SOCKS5 error: ${err.message}`, proxyStr });
          });

          socket.setTimeout(10000, () => {
            clearTimeout(attemptTimeout);
            socket.destroy();
            markProxyFailed(proxyStr);
            resolve({ success: false, error: 'SOCKS5 socket timeout', proxyStr });
          });

          socket.on('data', (data) => {
            if (step === 'greeting') {
              if (data[0] !== 0x05 || data[1] !== 0x00) {
                clearTimeout(attemptTimeout);
                socket.destroy();
                markProxyFailed(proxyStr);
                resolve({ success: false, error: 'SOCKS5 auth rejected', proxyStr });
                return;
              }
              step = 'connect';
              const hostBuf = Buffer.from(target.hostname);
              const portBuf = Buffer.alloc(2);
              portBuf.writeUInt16BE(targetPort);
              socket.write(Buffer.concat([
                Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
                hostBuf, portBuf,
              ]));
            } else if (step === 'connect') {
              if (data[0] !== 0x05 || data[1] !== 0x00) {
                clearTimeout(attemptTimeout);
                socket.destroy();
                markProxyFailed(proxyStr);
                resolve({ success: false, error: `SOCKS5 connect failed: ${data[1]}`, proxyStr });
                return;
              }
              step = 'connected';

              if (useTls) {
                const tlsSocket = tls.connect({
                  socket: socket,
                  servername: target.hostname,
                  rejectUnauthorized: false,
                }, () => {
                  sendRequest(tlsSocket);
                });
                tlsSocket.on('error', (err) => {
                  clearTimeout(attemptTimeout);
                  console.log(`[Fetch-SOCKS5] TLS error on ${proxyStr}: ${err.message}`);
                  markProxyFailed(proxyStr);
                  resolve({ success: false, error: `TLS error: ${err.message}`, proxyStr });
                });
              } else {
                sendRequest(socket);
              }
            }
          });

          function sendRequest(sock) {
            const path = target.pathname + target.search;
            const allHeaders = {
              'Host': target.hostname,
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': '*/*',
              'Connection': 'close',
              ...customHeaders,
            };
            let reqStr = `GET ${path} HTTP/1.1\r\n`;
            for (const [k, v] of Object.entries(allHeaders)) {
              reqStr += `${k}: ${v}\r\n`;
            }
            reqStr += '\r\n';
            sock.write(reqStr);

            const chunks = [];
            sock.on('data', (c) => chunks.push(c));
            sock.on('end', () => {
              clearTimeout(attemptTimeout);
              const raw = Buffer.concat(chunks);
              const rawStr = raw.toString('latin1');
              const headerEnd = rawStr.indexOf('\r\n\r\n');
              if (headerEnd === -1) {
                resolve({ success: false, error: 'No HTTP header boundary in response', proxyStr });
                return;
              }
              const headerPart = rawStr.substring(0, headerEnd);
              const statusMatch = headerPart.match(/HTTP\/[\d.]+ (\d+)/);
              const status = statusMatch ? parseInt(statusMatch[1]) : 502;
              const bodyOffset = Buffer.byteLength(rawStr.substring(0, headerEnd + 4), 'latin1');
              const body = raw.slice(bodyOffset);
              const ctMatch = headerPart.match(/content-type:\s*([^\r\n]+)/i);
              const ct = ctMatch ? ctMatch[1].trim() : 'application/octet-stream';

              console.log(`[Fetch-SOCKS5] ← ${status} ${ct} ${body.length}b via ${proxyStr}`);
              resolve({ success: true, status, body, ct, proxyStr });
            });
          }
        } catch (err) {
          clearTimeout(attemptTimeout);
          console.log(`[Fetch-SOCKS5] Error on ${proxyStr}: ${err.message}`);
          resolve({ success: false, error: err.message, proxyStr });
        }
      });
    }

    // Auto-retry loop: keep trying different proxies until success or max retries
    let lastError = 'All SOCKS5 proxies failed';
    for (let attempt = 0; attempt < MAX_SOCKS5_RETRIES; attempt++) {
      let proxyHost, proxyPort, proxyStr;

      if (attempt === 0 && proxyParam) {
        // First attempt uses the explicitly requested proxy if provided
        const parts = proxyParam.split(':');
        proxyHost = parts[0];
        proxyPort = parseInt(parts[1]);
        proxyStr = proxyParam;
      } else {
        // Subsequent attempts (or first attempt without proxyParam) use pool rotation
        const proxy = getNextProxy();
        proxyHost = proxy.host;
        proxyPort = proxy.port;
        proxyStr = proxy.str;
      }

      // Skip proxies we already tried this request
      if (triedProxies.has(proxyStr)) {
        // If we've exhausted unique proxies, stop
        if (triedProxies.size >= Math.min(MAX_SOCKS5_RETRIES, PROXY_POOL.validated.length + FALLBACK_SOCKS5_PROXIES.length)) break;
        continue;
      }
      triedProxies.add(proxyStr);

      console.log(`[Fetch-SOCKS5] Attempt ${attempt + 1}/${MAX_SOCKS5_RETRIES}: ${proxyHost}:${proxyPort} → ${target.hostname}:${targetPort} ${target.pathname.substring(0, 60)}`);

      const result = await attemptSocks5Fetch(proxyHost, proxyPort, proxyStr);

      if (result.success) {
        // Success — return the response immediately
        res.writeHead(result.status, {
          'Content-Type': result.ct,
          'Content-Length': result.body.length.toString(),
          'Access-Control-Allow-Origin': '*',
          'X-Proxied-By': 'rpi-socks5',
          'X-Socks5-Proxy': `${proxyHost}:${proxyPort}`,
          'X-Socks5-Attempts': String(attempt + 1),
        });
        res.end(result.body);
        return;
      }

      // Failed — log and try next proxy
      lastError = result.error;
      console.log(`[Fetch-SOCKS5] Attempt ${attempt + 1} failed (${result.error}), trying next proxy...`);
    }

    // All retries exhausted
    console.log(`[Fetch-SOCKS5] ❌ All ${triedProxies.size} proxy attempts failed for ${target.pathname.substring(0, 60)}`);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: lastError, attempts: triedProxies.size, maxRetries: MAX_SOCKS5_RETRIES }));
    }
    return;
  }

  // ============================================================================
  // /fetch-rust — Uses Rust-based browser-like fetch with JS execution
  // Lightweight alternative to Puppeteer (10MB vs 2.5GB, <50ms vs 5s startup)
  // Mimics Chrome TLS fingerprint + executes JS challenges with Boa engine
  // Install: cd rust-fetch && bash build.sh && sudo cp target/release/rust-fetch /usr/local/bin/
  // ============================================================================
  if (reqUrl.pathname === '/fetch-rust') {
    const targetUrl = reqUrl.searchParams.get('url');
    const headersJson = reqUrl.searchParams.get('headers');
    const timeout = reqUrl.searchParams.get('timeout') || '30';
    const solveChallenges = reqUrl.searchParams.get('solve') !== 'false';

    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: 'Missing url parameter' }));
    }

    try {
      const decoded = decodeURIComponent(targetUrl);

      if (!isAllowedProxyDomain(decoded)) {
        console.log(`[FetchRust] Blocked: ${decoded.substring(0, 80)}`);
        res.writeHead(403, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ error: 'Domain not allowed' }));
      }

      console.log(`[FetchRust] → ${decoded.substring(0, 80)}`);

      const { spawn } = require('child_process');
      
      const args = [
        '--url', decoded,
        '--timeout', timeout,
      ];
      
      if (!solveChallenges) {
        args.push('--solve-challenges', 'false');
      }
      
      if (headersJson) {
        args.push('--headers', headersJson);
      }
      
      console.log(`[FetchRust] Executing: rust-fetch ${args.slice(0, 4).join(' ')}...`);
      
      const rust = spawn('rust-fetch', args);
      const chunks = [];
      let stderr = '';
      
      rust.stdout.on('data', (chunk) => {
        chunks.push(chunk);
      });
      
      rust.stderr.on('data', (data) => {
        const msg = data.toString();
        stderr += msg;
        console.log(`[FetchRust] ${msg.trim()}`);
      });
      
      rust.on('error', (err) => {
        console.error(`[FetchRust] Error: ${err.message}`);
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ 
            error: 'rust-fetch not installed', 
            hint: 'Run: cd rust-fetch && bash build.sh && sudo cp target/release/rust-fetch /usr/local/bin/',
            details: err.message 
          }));
        }
      });
      
      rust.on('close', (code) => {
        if (code !== 0) {
          console.error(`[FetchRust] Exit code ${code}`);
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: `rust-fetch failed with code ${code}`, stderr }));
          }
          return;
        }
        
        const body = Buffer.concat(chunks);
        console.log(`[FetchRust] ← Success ${body.length}b`);
        
        // Detect content type
        let contentType = 'application/octet-stream';
        const bodyStr = body.toString('utf8', 0, Math.min(200, body.length));
        
        if (decoded.includes('.m3u8') || bodyStr.includes('#EXTM3U')) {
          contentType = 'application/vnd.apple.mpegurl';
        } else if (bodyStr.includes('<!DOCTYPE') || bodyStr.includes('<html')) {
          contentType = 'text/html';
        } else if (bodyStr.trim().startsWith('{') || bodyStr.trim().startsWith('[')) {
          contentType = 'application/json';
        } else if (body[0] === 0x47) { // MPEG-TS
          contentType = 'video/mp2t';
        } else if (body.slice(0, 4).toString('hex') === '00000018' || body.slice(0, 4).toString('hex') === '00000020') {
          contentType = 'video/mp4';
        }
        
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': body.length,
          'Access-Control-Allow-Origin': '*',
          'X-Proxied-By': 'rpi-rust-fetch',
          'Cache-Control': contentType.includes('mpegurl') ? 'public, max-age=5' : 'public, max-age=3600',
        });
        res.end(body);
      });
    } catch (err) {
      console.error(`[FetchRust] Error: ${err.message || err}`);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: err.message || 'Fetch failed' }));
      }
    }
    return;
  }

  // ============================================================================
  // /fetch-curl — Uses curl-impersonate to bypass Cloudflare TLS fingerprinting
  // curl-impersonate mimics Chrome's EXACT TLS fingerprint (JA3, ALPN, ciphers)
  // This bypasses even the most aggressive Cloudflare protection
  // Install: bash install-curl-impersonate.sh
  // ============================================================================
  if (reqUrl.pathname === '/fetch-curl') {
    const targetUrl = reqUrl.searchParams.get('url');
    const headersJson = reqUrl.searchParams.get('headers');

    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: 'Missing url parameter' }));
    }

    let customHeaders = {};
    if (headersJson) {
      try { customHeaders = JSON.parse(headersJson); } catch {
        try { customHeaders = JSON.parse(decodeURIComponent(headersJson)); } catch {}
      }
    }

    try {
      const decoded = decodeURIComponent(targetUrl);

      if (!isAllowedProxyDomain(decoded)) {
        console.log(`[FetchCurl] Blocked: ${decoded.substring(0, 80)}`);
        res.writeHead(403, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ error: 'Domain not allowed' }));
      }

      console.log(`[FetchCurl] → ${decoded.substring(0, 80)}`);

      const { spawn } = require('child_process');
      
      // Try different curl-impersonate binaries (in order of preference)
      const curlBinaries = ['curl_chrome116', 'curl_chrome110', 'curl-impersonate-chrome'];
      let curlBinary = curlBinaries[0];
      
      // Build curl arguments
      const curlArgs = [
        '-s', // Silent
        '-L', // Follow redirects
        '--compressed', // Accept gzip/deflate
        '--max-time', '30', // 30s timeout
      ];
      
      // Add custom headers
      const defaultHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        ...customHeaders,
      };
      
      for (const [key, value] of Object.entries(defaultHeaders)) {
        curlArgs.push('-H', `${key}: ${value}`);
      }
      
      curlArgs.push(decoded);
      
      console.log(`[FetchCurl] Executing: ${curlBinary} ${curlArgs.slice(0, 6).join(' ')}...`);
      
      const curl = spawn(curlBinary, curlArgs);
      const chunks = [];
      let stderr = '';
      
      curl.stdout.on('data', (chunk) => {
        chunks.push(chunk);
      });
      
      curl.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      curl.on('error', (err) => {
        console.error(`[FetchCurl] Error: ${err.message}`);
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ 
            error: 'curl-impersonate not installed', 
            hint: 'Run: bash install-curl-impersonate.sh',
            details: err.message 
          }));
        }
      });
      
      curl.on('close', (code) => {
        if (code !== 0) {
          console.error(`[FetchCurl] Exit code ${code}: ${stderr}`);
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: `curl failed with code ${code}`, stderr }));
          }
          return;
        }
        
        const body = Buffer.concat(chunks);
        console.log(`[FetchCurl] ← 200 ${body.length}b`);
        
        // Detect content type
        let contentType = 'application/octet-stream';
        if (decoded.includes('.m3u8') || body.toString('utf8', 0, 100).includes('#EXTM3U')) {
          contentType = 'application/vnd.apple.mpegurl';
        } else if (body[0] === 0x47) { // MPEG-TS
          contentType = 'video/mp2t';
        } else if (body.slice(0, 4).toString('hex') === '00000018' || body.slice(0, 4).toString('hex') === '00000020') {
          contentType = 'video/mp4';
        }
        
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': body.length,
          'Access-Control-Allow-Origin': '*',
          'X-Proxied-By': 'rpi-curl-impersonate',
          'Cache-Control': contentType.includes('mpegurl') ? 'public, max-age=5' : 'public, max-age=3600',
        });
        res.end(body);
      });
    } catch (err) {
      console.error(`[FetchCurl] Error: ${err.message || err}`);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: err.message || 'Fetch failed' }));
      }
    }
    return;
  }

  // ============================================================================
  // /fetch-impersonate — Uses Node.js native fetch() for upstream requests
  // Native fetch() handles HTTP/2 and TLS negotiation properly, matching
  // browser behavior better than https.request().
  // ============================================================================
  if (reqUrl.pathname === '/fetch-impersonate') {
    const targetUrl = reqUrl.searchParams.get('url');
    const headersJson = reqUrl.searchParams.get('headers');

    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: 'Missing url parameter' }));
    }

    let customHeaders = {};
    if (headersJson) {
      try { customHeaders = JSON.parse(headersJson); } catch {
        try { customHeaders = JSON.parse(decodeURIComponent(headersJson)); } catch {}
      }
    }

    try {
      const decoded = decodeURIComponent(targetUrl);

      if (!isAllowedProxyDomain(decoded)) {
        console.log(`[FetchImp] Blocked: ${decoded.substring(0, 80)}`);
        res.writeHead(403, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ error: 'Domain not allowed' }));
      }

      console.log(`[FetchImp] → ${decoded.substring(0, 80)}`);

      // Force IPv4 via https.request — IPv6 gets poison-pill keys from Cloudflare
      const u = new URL(decoded);
      const impReq = https.request({
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: 'GET',
        headers: { ...customHeaders },
        family: 4, // Force IPv4
        timeout: 15000,
        rejectUnauthorized: false,
      }, (proxyRes) => {
        const ct = proxyRes.headers['content-type'] || 'application/octet-stream';
        const cl = proxyRes.headers['content-length'];
        console.log(`[FetchImp] ← ${proxyRes.statusCode} ${ct}${cl ? ` ${cl}b` : ''} from ${u.hostname} (IPv4)`);

        const responseHeaders = {
          'Content-Type': ct,
          'Access-Control-Allow-Origin': '*',
          'X-Proxied-By': 'rpi-fetch-ipv4',
          'X-Upstream-Status': String(proxyRes.statusCode),
        };
        if (cl) responseHeaders['Content-Length'] = cl;

        res.writeHead(proxyRes.statusCode, responseHeaders);
        proxyRes.pipe(res);

        proxyRes.on('error', (err) => {
          console.error(`[FetchImp] Stream error: ${err.message}`);
          if (!res.headersSent) res.writeHead(502);
          res.end();
        });
      });

      impReq.on('error', (err) => {
        console.error(`[FetchImp] Error: ${err.message}`);
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      impReq.on('timeout', () => {
        impReq.destroy();
        if (!res.headersSent) {
          res.writeHead(504, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'Upstream timeout' }));
        }
      });

      impReq.end();
    } catch (err) {
      console.error(`[FetchImp] Error: ${err.message || err}`);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: err.message || 'Fetch failed' }));
      }
    }
    return;
  }

  // DLHD Key V4 endpoint (LEGACY — kept for backwards compat, use /fetch instead)
  if (reqUrl.pathname === '/dlhd-key-v4') {
    const targetUrl = reqUrl.searchParams.get('url');
    const jwt = reqUrl.searchParams.get('jwt');
    const timestamp = reqUrl.searchParams.get('timestamp');
    const nonce = reqUrl.searchParams.get('nonce');
    
    if (!targetUrl || !jwt || !timestamp || !nonce) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ 
        error: 'Missing parameters',
        usage: '/dlhd-key-v4?url=<key_url>&jwt=<token>&timestamp=<ts>&nonce=<n>'
      }));
    }
    
    console.log(`[DLHD-Key-V4] Fetching with pre-computed auth: ${targetUrl.substring(0, 60)}...`);
    console.log(`[DLHD-Key-V4] ts=${timestamp} nonce=${nonce}`);
    
    // Simple fetch with the provided auth headers
    // CRITICAL: Use www.ksohls.ru as Origin/Referer (new player domain Mar 2026)
    const url = new URL(targetUrl);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Origin': 'https://www.ksohls.ru',
        'Referer': 'https://www.ksohls.ru/',
        'Authorization': `Bearer ${jwt}`,
        'X-Key-Timestamp': timestamp,
        'X-Key-Nonce': nonce,
      },
      timeout: 15000,
    };
    
    const proxyReq = https.request(options, (proxyRes) => {
      const chunks = [];
      proxyRes.on('data', chunk => chunks.push(chunk));
      proxyRes.on('end', () => {
        const data = Buffer.concat(chunks);
        const text = data.toString('utf8');
        
        console.log(`[DLHD-Key-V4] Response: ${proxyRes.statusCode}, ${data.length} bytes`);
        
        // Check for valid 16-byte key
        if (data.length === 16 && !text.startsWith('{') && !text.startsWith('E')) {
          console.log(`[DLHD-Key-V4] ✅ Valid key: ${data.toString('hex')}`);
          res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Length': data.length,
            'Access-Control-Allow-Origin': '*',
            'X-Fetched-By': 'rpi-v4-passthrough',
          });
          res.end(data);
        } else {
          console.log(`[DLHD-Key-V4] ❌ Invalid response: ${text.substring(0, 100)}`);
          res.writeHead(proxyRes.statusCode || 502, { 
            'Content-Type': 'application/json', 
            'Access-Control-Allow-Origin': '*' 
          });
          res.end(JSON.stringify({ 
            error: 'Invalid key response',
            status: proxyRes.statusCode,
            size: data.length,
            preview: text.substring(0, 200),
          }));
        }
      });
    });
    
    proxyReq.on('error', (err) => {
      console.error(`[DLHD-Key-V4] Error: ${err.message}`);
      res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: err.message }));
    });
    
    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      res.writeHead(504, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Timeout' }));
    });
    
    proxyReq.end();
    return;
  }

  // DLHD Key endpoint - fetches encryption key from residential IP
  // The key server (chevy.soyspace.cyou) blocks Cloudflare IPs
  // CF Worker calls this when direct key fetch fails
  // Updated January 2026: Uses v3 auth module for full PoW authentication
  if (reqUrl.pathname === '/dlhd-key') {
    const targetUrl = reqUrl.searchParams.get('url');
    
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ 
        error: 'Missing url parameter',
        usage: '/dlhd-key?url=<key_url>'
      }));
    }
    
    // SECURITY: Validate target domain is a known DLHD key server
    const decoded = decodeURIComponent(targetUrl);
    if (!isAllowedProxyDomain(decoded)) {
      console.log(`[Security] Blocked DLHD key request to unauthorized domain: ${decoded.substring(0, 80)}`);
      res.writeHead(403, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: 'Domain not allowed' }));
    }
    
    console.log(`[DLHD-Key] Fetching key via V5 auth: ${targetUrl.substring(0, 80)}...`);
    
    // Use V5 auth module (February 2026 - EPlayerAuth with MD5 PoW)
    const result = await dlhdAuthV5.fetchDLHDKeyV5(targetUrl);
    
    if (result.success && result.data) {
      console.log(`[DLHD-Key] ✅ Valid key via V5 auth: ${result.data.toString('hex')}`);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': result.data.length,
        'Access-Control-Allow-Origin': '*',
        'X-Fetched-By': 'rpi-v5-auth',
      });
      res.end(result.data);
    } else {
      console.log(`[DLHD-Key] ❌ V5 auth failed: ${result.error}`);
      res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ 
        error: result.error || 'Key fetch failed',
        code: result.code,
        response: result.response?.substring(0, 200),
      }));
    }
    return;
  }

  // ============================================================================
  // /whitelist-refresh — Trigger immediate reCAPTCHA v3 IP whitelist refresh
  // Called by CF worker when all key servers return fake keys.
  // ============================================================================
  if (reqUrl.pathname === '/whitelist-refresh' || reqUrl.pathname === '/dlhd-whitelist') {
    const channel = reqUrl.searchParams.get('channel') || 'premium44';
    
    // Check if channel is already whitelisted (within cooldown)
    if (isChannelWhitelisted(channel)) {
      const lastSuccess = dlhdWhitelistState.perChannelSuccess[channel];
      const secsAgo = Math.round((Date.now() - lastSuccess) / 1000);
      console.log(`[Whitelist-Refresh] Skipped ${channel} — already whitelisted ${secsAgo}s ago`);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ 
        success: true,
        status: 'already-whitelisted',
        channel,
        lastSuccessSecsAgo: secsAgo,
        budget: getWhitelistBudget(),
      }));
    }
    
    // Check budget — don't exceed 13 channels / 30 min
    const budget = getWhitelistBudget();
    if (budget.remaining <= 0) {
      console.log(`[Whitelist-Refresh] BUDGET EXHAUSTED for ${channel} — ${budget.used}/${WHITELIST_BUDGET} channels used. Next slot in ${budget.oldestExpiry}s`);
      res.writeHead(429, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ 
        success: false,
        status: 'budget-exhausted',
        channel,
        error: `Channel whitelist budget exhausted (${budget.used}/${WHITELIST_BUDGET}). Next slot in ${budget.oldestExpiry}s`,
        budget,
      }));
    }
    
    console.log(`[Whitelist-Refresh] Triggered for ${channel} — budget: ${budget.remaining}/${WHITELIST_BUDGET} remaining`);
    
    try {
      dlhdWhitelistState.lastAttempt = Date.now();
      await whitelistRPIViaRecaptcha(channel);
      console.log(`[Whitelist-Refresh] Completed ${channel}. isWhitelisted=${dlhdWhitelistState.isWhitelisted}`);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ 
        success: dlhdWhitelistState.isWhitelisted,
        channel,
        score: dlhdWhitelistState.lastScore,
        verifyResponse: dlhdWhitelistState.lastVerifyResponse,
        budget: getWhitelistBudget(),
      }));
    } catch (err) {
      console.error(`[Whitelist-Refresh] Error for ${channel}: ${err.message}`);
      res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ 
        success: false,
        channel,
        error: err.message,
        budget: getWhitelistBudget(),
      }));
    }
  }

  // ============================================================================
  // /dlhd-key-v6 — Server-side key fetching via rust-fetch (residential IP)
  // 
  // March 2026: DLHD switched to reCAPTCHA v3 IP whitelist for key access.
  // Without whitelist, key servers return FAKE 16-byte keys that don't decrypt.
  // 
  // This endpoint:
  //   1. Fetches key from upstream using rust-fetch (Chrome TLS from residential IP)
  //   2. Validates key by decrypting a segment and checking for 0x47 TS sync byte
  //   3. Returns validated key to CF worker / HLS.js player
  //
  // Key servers: chevy.soyspace.cyou, go.ai-chatx.site, chevy.vovlacosa.sbs
  // All return CORS: * so browser can fetch, but keys are FAKE without whitelist.
  // ============================================================================
  if (reqUrl.pathname === '/dlhd-key-v6') {
    const targetUrl = reqUrl.searchParams.get('url');
    
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ 
        error: 'Missing url parameter',
        usage: '/dlhd-key-v6?url=<key_url>'
      }));
    }

    const decoded = decodeURIComponent(targetUrl);
    
    if (!isAllowedProxyDomain(decoded)) {
      res.writeHead(403, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: 'Domain not allowed' }));
    }

    console.log(`[DLHD-Key-V6] Fetching key: ${decoded.substring(0, 80)}...`);

    // Try multiple key servers — the key path is the same across all
    const keyPathMatch = decoded.match(/(\/key\/[^?]+)/);
    const keyPath = keyPathMatch ? keyPathMatch[1] : new URL(decoded).pathname;
    
    // Check key cache FIRST — serves unlimited clients without burning whitelist slots
    const cachedKey = getCachedKey(keyPath);
    if (cachedKey) {
      console.log(`[DLHD-Key-V6] ✅ Cache HIT: ${keyPath} → ${cachedKey.toString('hex')}`);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': cachedKey.length,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'X-Fetched-By': 'rpi-v6-cache',
        'X-Key-Hex': cachedKey.toString('hex'),
        'X-Cache': 'HIT',
      });
      res.end(cachedKey);
      return;
    }
    
    const keyServers = [
      decoded, // Original URL first
      `https://chevy.vmvmv.shop${keyPath}`,
      `https://chevy.vovlacosa.sbs${keyPath}`,
      `https://chevy.soyspace.cyou${keyPath}`,
      // go.ai-chatx.site removed — SSL cert invalid (ERR_TLS_CERT_ALTNAME_INVALID)
    ];
    // Deduplicate
    const uniqueServers = [...new Set(keyServers)];

    // Known fake key patterns — skip immediately
    const FAKE_KEYS_V6 = new Set([
      '45db13cfa0ed393fdb7da4dfe9b5ac81',
      '455806f8bc592fdacb6ed5e071a517b1',
      '4542956ed8680eaccb615f7faad4da8f',
    ]);

    let validKey = null;
    
    for (const keyUrl of uniqueServers) {
      try {
        console.log(`[DLHD-Key-V6] Trying: ${keyUrl.substring(0, 80)}`);
        
        // Use rust-fetch fetch-bin mode for binary key data (not text mode which corrupts bytes)
        const keyBuf = await new Promise((resolve, reject) => {
          const args = [
            '--url', keyUrl,
            '--timeout', '10',
            '--mode', 'fetch-bin',
            '--headers', JSON.stringify({
              'Referer': 'https://www.ksohls.ru/',
              'Origin': 'https://www.ksohls.ru',
            }),
          ];
          
          const rust = spawn('rust-fetch', args);
          const chunks = [];
          let stderr = '';
          
          rust.stdout.on('data', (chunk) => chunks.push(chunk));
          rust.stderr.on('data', (data) => { stderr += data.toString(); });
          
          rust.on('error', (err) => reject(err));
          rust.on('close', (code) => {
            if (code !== 0) {
              reject(new Error(`rust-fetch exit ${code}: ${stderr}`));
              return;
            }
            resolve(Buffer.concat(chunks));
          });
        });

        // Key must be exactly 16 bytes
        if (!keyBuf || keyBuf.length !== 16) {
          const text = keyBuf ? keyBuf.toString('utf8').substring(0, 100) : 'empty';
          console.log(`[DLHD-Key-V6] ❌ Not 16 bytes (${keyBuf?.length || 0}): ${text}`);
          continue;
        }

        const keyHex = keyBuf.toString('hex');
        console.log(`[DLHD-Key-V6] Got 16-byte key: ${keyHex}`);
        
        if (FAKE_KEYS_V6.has(keyHex)) {
          console.log(`[DLHD-Key-V6] ❌ Known fake key (${keyHex.substring(0,8)}...), skipping`);
          continue;
        }

        validKey = keyBuf;
        setCachedKey(keyPath, keyBuf);
        console.log(`[DLHD-Key-V6] ✅ Key accepted + cached: ${keyHex} (path: ${keyPath})`);
        break;
      } catch (e) {
        console.log(`[DLHD-Key-V6] Error from ${keyUrl.substring(0, 60)}: ${e.message}`);
        continue;
      }
    }

    if (validKey) {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': validKey.length,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'X-Fetched-By': 'rpi-v6-rustfetch',
        'X-Key-Hex': validKey.toString('hex'),
      });
      res.end(validKey);
    } else {
      console.log(`[DLHD-Key-V6] ❌ All key servers returned fake/invalid keys — checking whitelist budget`);
      // Auto-trigger whitelist refresh when all keys are fake
      // Extract channel from key path for per-channel whitelist
      const channelMatch = keyPath.match(/\/(premium\d+)\//);
      const whitelistChannel = channelMatch ? channelMatch[1] : 'premium44';
      
      // Check if already whitelisted recently (no point retrying)
      if (isChannelWhitelisted(whitelistChannel)) {
        console.log(`[DLHD-Key-V6] ${whitelistChannel} already whitelisted recently — key server may be returning stale poison keys`);
      } else {
        // Check budget before attempting whitelist
        const budget = getWhitelistBudget();
        if (budget.remaining > 0) {
          console.log(`[DLHD-Key-V6] Whitelisting ${whitelistChannel} on-demand (budget: ${budget.remaining}/${WHITELIST_BUDGET} remaining)`);
          try {
            await whitelistRPIViaRecaptcha(whitelistChannel);
            
            // If whitelist succeeded, retry key fetch immediately
            if (isChannelWhitelisted(whitelistChannel)) {
              console.log(`[DLHD-Key-V6] Whitelist OK — retrying key fetch for ${whitelistChannel}...`);
              for (const keyUrl of uniqueServers) {
                try {
                  const retryBuf = await new Promise((resolve, reject) => {
                    const args = [
                      '--url', keyUrl, '--timeout', '10', '--mode', 'fetch-bin',
                      '--headers', JSON.stringify({ 'Referer': 'https://www.ksohls.ru/', 'Origin': 'https://www.ksohls.ru' }),
                    ];
                    const rust = spawn('rust-fetch', args);
                    const chunks = [];
                    let stderr = '';
                    rust.stdout.on('data', (chunk) => chunks.push(chunk));
                    rust.stderr.on('data', (data) => { stderr += data.toString(); });
                    rust.on('error', (err) => reject(err));
                    rust.on('close', (code) => {
                      if (code !== 0) { reject(new Error(`rust-fetch exit ${code}: ${stderr}`)); return; }
                      resolve(Buffer.concat(chunks));
                    });
                  });
                  if (retryBuf && retryBuf.length === 16) {
                    const retryHex = retryBuf.toString('hex');
                    if (!FAKE_KEYS_V6.has(retryHex)) {
                      console.log(`[DLHD-Key-V6] ✅ Got real key after whitelist + cached: ${retryHex}`);
                      setCachedKey(keyPath, retryBuf);
                      res.writeHead(200, {
                        'Content-Type': 'application/octet-stream',
                        'Content-Length': retryBuf.length,
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'GET, OPTIONS',
                        'Access-Control-Allow-Headers': '*',
                        'X-Fetched-By': 'rpi-v6-after-whitelist',
                        'X-Key-Hex': retryHex,
                      });
                      res.end(retryBuf);
                      return;
                    }
                  }
                } catch (e) {
                  console.log(`[DLHD-Key-V6] Retry error: ${e.message}`);
                }
              }
            }
          } catch (e) {
            console.error(`[DLHD-Key-V6] Whitelist error: ${e.message}`);
          }
        } else {
          console.log(`[DLHD-Key-V6] Budget exhausted (${budget.used}/${WHITELIST_BUDGET}) — cannot whitelist ${whitelistChannel}. Next slot in ${budget.oldestExpiry}s`);
        }
      }
      res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ 
        error: 'All key servers returned fake keys — RPI IP may not be whitelisted for this channel',
        hint: 'Channel whitelist is on-demand. Budget: 13 unique channels per 30 min.',
        channel: whitelistChannel,
        budget: getWhitelistBudget(),
        whitelistState: {
          isWhitelisted: isChannelWhitelisted(whitelistChannel),
          lastSuccess: dlhdWhitelistState.perChannelSuccess[whitelistChannel] 
            ? new Date(dlhdWhitelistState.perChannelSuccess[whitelistChannel]).toISOString() 
            : null,
        },
      }));
    }
    return;
  }

  // IPTV API proxy - makes Stalker portal API calls from residential IP
  // This is needed because stream tokens are bound to the requesting IP
  if (reqUrl.pathname === '/iptv/api') {
    const targetUrl = reqUrl.searchParams.get('url');
    const mac = reqUrl.searchParams.get('mac');
    const token = reqUrl.searchParams.get('token');
    
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: 'Missing url parameter' }));
    }

    try {
      const decoded = decodeURIComponent(targetUrl);
      proxyIPTVApi(decoded, mac, token, res);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Invalid URL' }));
    }
    return;
  }

  // IPTV Stream endpoint - streams raw TS data
  if (reqUrl.pathname === '/iptv/stream') {
    const targetUrl = reqUrl.searchParams.get('url');
    const mac = reqUrl.searchParams.get('mac');
    const token = reqUrl.searchParams.get('token');
    
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing url parameter' }));
    }

    try {
      const decoded = decodeURIComponent(targetUrl);
      proxyIPTVStream(decoded, mac, token, res);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid URL' }));
    }
    return;
  }

  // PPV proxy endpoint - proxies poocloud.in streams from residential IP
  // poocloud.in blocks datacenter IPs (Cloudflare, AWS, etc.)
  // Requires Referer: https://pooembed.top/ header
  if (reqUrl.pathname === '/ppv') {
    const targetUrl = reqUrl.searchParams.get('url');
    
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: 'Missing url parameter' }));
    }

    try {
      const decoded = decodeURIComponent(targetUrl);
      proxyPPVStream(decoded, res);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Invalid URL' }));
    }
    return;
  }

  // Proxy endpoint
  if (reqUrl.pathname === '/proxy') {
    const targetUrl = reqUrl.searchParams.get('url');
    
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing url parameter' }));
    }

    try {
      const decoded = decodeURIComponent(targetUrl);
      
      // SECURITY: Validate target domain is in allowlist
      if (!isAllowedProxyDomain(decoded)) {
        console.log(`[Security] Blocked proxy to unauthorized domain: ${decoded.substring(0, 80)}`);
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Domain not allowed' }));
      }
      
      proxyRequest(decoded, res);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid URL' }));
    }
    return;
  }

  // ============================================================================
  // CDN-LIVE DEDICATED ROUTES
  // cdn-live.tv blocks Cloudflare/datacenter IPs — must use residential IP
  // All cdn-live domains (cdn-live.tv, edge.cdn-live.ru, cdn-live-tv.cfd, etc.)
  // resolve to 195.128.27.233 but reject requests from CF Worker IPs
  // ============================================================================

  // /cdn-live/extract — Fetch player page, decode HUNTER, return M3U8 URL
  // Input: ?name=espn&code=us
  // Output: { success: true, m3u8Url: "https://edge.cdn-live.ru/..." }
  if (reqUrl.pathname === '/cdn-live/extract') {
    const name = reqUrl.searchParams.get('name');
    const code = reqUrl.searchParams.get('code') || 'us';

    if (!name) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: 'Missing name parameter' }));
    }

    console.log(`[CDN-Live Extract] ${name}/${code}`);

    try {
      const result = await cdnLiveFetchAndExtract(name, code);
      if (!result.success) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify(result));
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify(result));
    } catch (err) {
      console.error(`[CDN-Live Extract] Error: ${err.message}`);
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ success: false, error: err.message }));
    }
  }

  // /cdn-live/stream — FAST PATH: Extract + fetch M3U8 in ONE call
  // Eliminates a full round-trip vs separate /extract + /proxy calls
  // Input: ?name=espn&code=us
  // Output: raw M3U8 playlist text (application/vnd.apple.mpegurl)
  //   + X-M3U8-Url header with the original M3U8 URL for caching
  if (reqUrl.pathname === '/cdn-live/stream') {
    const name = reqUrl.searchParams.get('name');
    const code = reqUrl.searchParams.get('code') || 'us';
    // Optional: caller can pass a cached M3U8 URL to skip extraction
    const cachedUrl = reqUrl.searchParams.get('m3u8url');

    if (!name && !cachedUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: 'Missing name or m3u8url parameter' }));
    }

    const t0 = Date.now();

    try {
      let m3u8Url = cachedUrl ? decodeURIComponent(cachedUrl) : null;

      // Step 1: Extract if no cached URL provided
      if (!m3u8Url) {
        const result = await cdnLiveFetchAndExtract(name, code);
        if (!result.success) {
          res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          return res.end(JSON.stringify(result));
        }
        m3u8Url = result.m3u8Url;
      }

      const t1 = Date.now();

      // Step 2: Fetch the M3U8 playlist immediately (same process, no extra hop)
      const playlist = await cdnLiveFetchContent(m3u8Url);
      const t2 = Date.now();

      console.log(`[CDN-Live Stream] ${name || 'cached'}/${code} — extract: ${t1 - t0}ms, m3u8: ${t2 - t1}ms, total: ${t2 - t0}ms`);

      res.writeHead(200, {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'X-M3U8-Url, X-Timing',
        'Cache-Control': 'no-cache',
        'X-M3U8-Url': m3u8Url,
        'X-Timing': `extract=${t1 - t0}ms,m3u8=${t2 - t1}ms,total=${t2 - t0}ms`,
      });
      return res.end(playlist);
    } catch (err) {
      console.error(`[CDN-Live Stream] Error: ${err.message}`);
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ success: false, error: err.message }));
    }
  }

  // /cdn-live/proxy — Proxy M3U8 playlists, segments, and keys from cdn-live CDN
  // Input: ?url=<encoded cdn-live URL>
  // Output: raw proxied content (M3U8 text, .ts binary, etc.)
  if (reqUrl.pathname === '/cdn-live/proxy') {
    const targetUrl = reqUrl.searchParams.get('url');

    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: 'Missing url parameter' }));
    }

    try {
      const decoded = decodeURIComponent(targetUrl);

      // Validate domain
      if (!isCdnLiveDomain(decoded)) {
        console.log(`[CDN-Live Proxy] Blocked non-CDN-Live domain: ${decoded.substring(0, 80)}`);
        res.writeHead(403, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ error: 'Domain not allowed — must be a cdn-live domain' }));
      }

      console.log(`[CDN-Live Proxy] ${decoded.substring(0, 100)}`);
      proxyCdnLiveRequest(decoded, res);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: 'Invalid URL' }));
    }
    return;
  }

  // =========================================================================
  // DEDICATED PROVIDER STREAM ENDPOINTS
  // Each provider gets its own route with provider-specific header logic.
  // =========================================================================

  // Flixer CDN stream proxy — p.XXXXX.workers.dev
  if (reqUrl.pathname === '/flixer/stream') {
    const targetUrl = reqUrl.searchParams.get('url');
    const customUserAgent = reqUrl.searchParams.get('ua');
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: 'Missing url parameter' }));
    }
    try {
      const decoded = decodeURIComponent(targetUrl);
      if (!isAllowedProxyDomain(decoded)) {
        res.writeHead(403, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ error: 'Domain not allowed' }));
      }
      proxyFlixerStream(decoded, customUserAgent ? decodeURIComponent(customUserAgent) : null, res);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Invalid URL' }));
    }
    return;
  }

  // HiAnime/MegaCloud CDN stream proxy
  if (reqUrl.pathname === '/hianime/stream') {
    const targetUrl = reqUrl.searchParams.get('url');
    const customUserAgent = reqUrl.searchParams.get('ua');
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: 'Missing url parameter' }));
    }
    try {
      const decoded = decodeURIComponent(targetUrl);
      if (!isAllowedProxyDomain(decoded)) {
        res.writeHead(403, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ error: 'Domain not allowed' }));
      }
      proxyHiAnimeStream(decoded, customUserAgent ? decodeURIComponent(customUserAgent) : null, res);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Invalid URL' }));
    }
    return;
  }

  // VidLink CDN stream proxy — vodvidl.site, videostr.net
  if (reqUrl.pathname === '/vidlink/stream') {
    const targetUrl = reqUrl.searchParams.get('url');
    const customUserAgent = reqUrl.searchParams.get('ua');
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: 'Missing url parameter' }));
    }
    try {
      const decoded = decodeURIComponent(targetUrl);
      if (!isAllowedProxyDomain(decoded)) {
        res.writeHead(403, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ error: 'Domain not allowed' }));
      }
      proxyVidLinkStream(decoded, customUserAgent ? decodeURIComponent(customUserAgent) : null, res);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Invalid URL' }));
    }
    return;
  }

  // DLHD CDN stream proxy — dvalna.ru, soyspace.cyou, adsfadfds.cfd, ksohls.ru
  if (reqUrl.pathname === '/dlhd/stream') {
    const targetUrl = reqUrl.searchParams.get('url');
    const customUserAgent = reqUrl.searchParams.get('ua');
    const customReferer = reqUrl.searchParams.get('referer');
    const customOrigin = reqUrl.searchParams.get('origin');
    const customAuth = reqUrl.searchParams.get('auth');
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: 'Missing url parameter' }));
    }
    try {
      const decoded = decodeURIComponent(targetUrl);
      if (!isAllowedProxyDomain(decoded)) {
        res.writeHead(403, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ error: 'Domain not allowed' }));
      }
      proxyDlhdStream(
        decoded,
        customUserAgent ? decodeURIComponent(customUserAgent) : null,
        customReferer ? decodeURIComponent(customReferer) : null,
        customOrigin ? decodeURIComponent(customOrigin) : null,
        customAuth ? decodeURIComponent(customAuth) : null,
        res
      );
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Invalid URL' }));
    }
    return;
  }

  // VidSrc/2embed CDN stream proxy
  if (reqUrl.pathname === '/vidsrc/stream') {
    const targetUrl = reqUrl.searchParams.get('url');
    const customUserAgent = reqUrl.searchParams.get('ua');
    const customReferer = reqUrl.searchParams.get('referer');
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: 'Missing url parameter' }));
    }
    try {
      const decoded = decodeURIComponent(targetUrl);
      if (!isAllowedProxyDomain(decoded)) {
        res.writeHead(403, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ error: 'Domain not allowed' }));
      }
      proxyVidSrcStream(decoded, customUserAgent ? decodeURIComponent(customUserAgent) : null, customReferer ? decodeURIComponent(customReferer) : null, res);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Invalid URL' }));
    }
    return;
  }

  // 1movies CDN stream proxy — p.XXXXX.workers.dev with 111movies.com referer
  if (reqUrl.pathname === '/1movies/stream') {
    const targetUrl = reqUrl.searchParams.get('url');
    const customUserAgent = reqUrl.searchParams.get('ua');
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: 'Missing url parameter' }));
    }
    try {
      const decoded = decodeURIComponent(targetUrl);
      if (!isAllowedProxyDomain(decoded)) {
        res.writeHead(403, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ error: 'Domain not allowed' }));
      }
      proxy1moviesStream(decoded, customUserAgent ? decodeURIComponent(customUserAgent) : null, res);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Invalid URL' }));
    }
    return;
  }

  // AnimeKai proxy endpoint — NOW ONLY for actual AnimeKai/MegaUp CDN streams
  // MegaUp blocks datacenter IPs and requests with Origin/Referer headers
  if (reqUrl.pathname === '/animekai') {
    const targetUrl = reqUrl.searchParams.get('url');
    const customUserAgent = reqUrl.searchParams.get('ua');
    const customReferer = reqUrl.searchParams.get('referer');
    const customOrigin = reqUrl.searchParams.get('origin');
    const customAuth = reqUrl.searchParams.get('auth');
    
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: 'Missing url parameter' }));
    }

    try {
      const decoded = decodeURIComponent(targetUrl);
      
      // SECURITY: Validate target domain is in allowlist
      if (!isAllowedProxyDomain(decoded)) {
        console.log(`[Security] Blocked animekai proxy to unauthorized domain: ${decoded.substring(0, 80)}`);
        res.writeHead(403, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ error: 'Domain not allowed' }));
      }
      
      const decodedUa = customUserAgent ? decodeURIComponent(customUserAgent) : null;
      const decodedReferer = customReferer ? decodeURIComponent(customReferer) : null;
      const decodedOrigin = customOrigin ? decodeURIComponent(customOrigin) : null;
      const decodedAuth = customAuth ? decodeURIComponent(customAuth) : null;
      proxyAnimeKaiStream(decoded, decodedUa, decodedReferer, decodedOrigin, decodedAuth, res);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Invalid URL' }));
    }
    return;
  }

  // AnimeKai FULL extraction endpoint V2 - RPI does EVERYTHING
  // Input: kai_id (anime ID) and episode number
  // Output: { success: true, streamUrl: "https://...", skip: {...} }
  // 
  // Flow: Client → CF Worker → RPI (this endpoint)
  //   1. Fetch episodes list from AnimeKai
  //   2. Get episode token
  //   3. Fetch servers list
  //   4. Get server lid
  //   5. Fetch encrypted embed
  //   6. Decrypt AnimeKai embed
  //   7. Fetch MegaUp /media/
  //   8. Decrypt MegaUp response
  //   9. Return HLS stream URL
  if (reqUrl.pathname === '/animekai/full-extract') {
    const kaiId = reqUrl.searchParams.get('kai_id');
    const episode = reqUrl.searchParams.get('episode');
    
    if (!kaiId || !episode) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ 
        error: 'Missing parameters',
        usage: '/animekai/full-extract?kai_id=<anime_id>&episode=<episode_number>'
      }));
    }

    try {
      await fullAnimeKaiExtraction(kaiId, parseInt(episode, 10), res);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Extraction failed', details: err.message }));
    }
    return;
  }

  // ============================================================================
  // VIPRow Stream Extraction - RPI does EVERYTHING
  // boanki.net blocks Cloudflare Workers, so we do extraction from residential IP
  // ============================================================================
  
  // VIPRow stream extraction endpoint
  // Input: url (VIPRow event path like /nba/event-online-stream) and link number
  // Output: m3u8 manifest with URLs rewritten through CF proxy
  if (reqUrl.pathname === '/viprow/stream') {
    const eventUrl = reqUrl.searchParams.get('url');
    const linkNum = reqUrl.searchParams.get('link') || '1';
    const cfProxy = reqUrl.searchParams.get('cf_proxy'); // CF proxy base URL for rewriting
    
    if (!eventUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ 
        error: 'Missing url parameter',
        usage: '/viprow/stream?url=/nba/event-online-stream&link=1&cf_proxy=https://media-proxy.example.com'
      }));
    }

    try {
      await extractVIPRowStream(eventUrl, linkNum, cfProxy, res);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'VIPRow extraction failed', details: err.message }));
    }
    return;
  }

  // VIPRow manifest proxy - proxies manifest with URL rewriting
  if (reqUrl.pathname === '/viprow/manifest') {
    const manifestUrl = reqUrl.searchParams.get('url');
    const cfProxy = reqUrl.searchParams.get('cf_proxy');
    
    if (!manifestUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: 'Missing url parameter' }));
    }

    try {
      const decoded = decodeURIComponent(manifestUrl);
      await proxyVIPRowManifest(decoded, cfProxy, res);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Invalid URL' }));
    }
    return;
  }

  // VIPRow key proxy - proxies AES-128 decryption keys
  if (reqUrl.pathname === '/viprow/key') {
    const keyUrl = reqUrl.searchParams.get('url');
    
    if (!keyUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: 'Missing url parameter' }));
    }

    try {
      const decoded = decodeURIComponent(keyUrl);
      await proxyVIPRowKey(decoded, res);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Invalid URL' }));
    }
    return;
  }

  // VIPRow segment proxy - proxies video segments
  if (reqUrl.pathname === '/viprow/segment') {
    const segmentUrl = reqUrl.searchParams.get('url');
    
    if (!segmentUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: 'Missing url parameter' }));
    }

    try {
      const decoded = decodeURIComponent(segmentUrl);
      await proxyVIPRowSegment(decoded, res);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Invalid URL' }));
    }
    return;
  }

  // AnimeKai FULL extraction endpoint - does ALL the work from residential IP
  // Input: encrypted embed response from AnimeKai /ajax/links/view
  // Output: { success: true, streamUrl: "https://...", skip: {...} }
  // 
  // Flow: Client → CF Worker → RPI (this endpoint)
  //   1. Decrypt AnimeKai embed response
  //   2. Decode }XX hex format  
  //   3. Parse JSON to get MegaUp embed URL
  //   4. Fetch MegaUp /media/{videoId} from residential IP
  //   5. Decrypt MegaUp response
  //   6. Return HLS stream URL
  if (reqUrl.pathname === '/animekai/extract') {
    const encryptedEmbed = reqUrl.searchParams.get('embed');
    
    if (!encryptedEmbed) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ 
        error: 'Missing embed parameter',
        usage: '/animekai/extract?embed=<encrypted_embed_response>'
      }));
    }

    try {
      const decoded = decodeURIComponent(encryptedEmbed);
      await extractAnimeKaiStream(decoded, res);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Invalid embed data', details: err.message }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// ============================================================================
// AnimeKai Crypto Implementation (Native)
// Decrypts AnimeKai embed responses without external API
// ============================================================================

// URL-safe Base64 decode
function urlSafeBase64Decode(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
  return Buffer.from(padded, 'base64');
}

// AnimeKai cipher position mapping
function getCipherPosition(plainPos) {
  if (plainPos === 0) return 0;
  if (plainPos === 1) return 7;
  if (plainPos === 2) return 11;
  if (plainPos === 3) return 13;
  if (plainPos === 4) return 15;
  if (plainPos === 5) return 17;
  if (plainPos === 6) return 19;
  return 20 + (plainPos - 7);
}

// Load AnimeKai decrypt tables from file (lazy loaded)
let ANIMEKAI_DECRYPT_TABLES = null;

function loadAnimeKaiTables() {
  if (ANIMEKAI_DECRYPT_TABLES) return ANIMEKAI_DECRYPT_TABLES;
  
  try {
    // Try to load from the tables file
    const fs = require('fs');
    const path = require('path');
    const tablesPath = path.join(__dirname, 'animekai-tables.json');
    
    if (fs.existsSync(tablesPath)) {
      ANIMEKAI_DECRYPT_TABLES = JSON.parse(fs.readFileSync(tablesPath, 'utf8'));
      console.log(`[AnimeKai] Loaded ${Object.keys(ANIMEKAI_DECRYPT_TABLES).length} decrypt tables`);
      return ANIMEKAI_DECRYPT_TABLES;
    }
  } catch (e) {
    console.log(`[AnimeKai] Could not load tables file: ${e.message}`);
  }
  
  return null;
}

// AnimeKai decryption
function decryptAnimeKai(ciphertext) {
  const tables = loadAnimeKaiTables();
  if (!tables) {
    throw new Error('AnimeKai decrypt tables not loaded');
  }
  
  const HEADER_LEN = 21;
  const cipher = urlSafeBase64Decode(ciphertext);
  
  const hasHeader = cipher.length > HEADER_LEN;
  const dataOffset = hasHeader ? HEADER_LEN : 0;
  const dataLen = cipher.length - dataOffset;
  
  // Calculate plaintext length
  let plaintextLen = 0;
  if (dataLen > 20) {
    plaintextLen = 7 + (dataLen - 20);
  } else if (dataLen > 19) {
    plaintextLen = 7;
  } else if (dataLen > 17) {
    plaintextLen = 6;
  } else if (dataLen > 15) {
    plaintextLen = 5;
  } else if (dataLen > 13) {
    plaintextLen = 4;
  } else if (dataLen > 11) {
    plaintextLen = 3;
  } else if (dataLen > 7) {
    plaintextLen = 2;
  } else if (dataLen > 0) {
    plaintextLen = 1;
  }
  
  let plaintext = '';
  
  for (let i = 0; i < plaintextLen; i++) {
    const cipherPos = getCipherPosition(i);
    const actualPos = dataOffset + cipherPos;
    if (actualPos >= cipher.length) break;
    
    const byte = cipher[actualPos];
    const table = tables[i];
    
    if (table && byte in table) {
      plaintext += table[byte];
    } else {
      plaintext += String.fromCharCode(byte);
    }
  }
  
  return plaintext;
}

// Decode AnimeKai }XX hex format
function decodeAnimeKaiHex(str) {
  return str.replace(/}([0-9A-Fa-f]{2})/g, (_, hex) => 
    String.fromCharCode(parseInt(hex, 16))
  );
}

// URL-safe Base64 encode
function urlSafeBase64Encode(buffer) {
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// Build encrypt tables from decrypt tables (reverse mapping)
let ANIMEKAI_ENCRYPT_TABLES = null;

function loadAnimeKaiEncryptTables() {
  if (ANIMEKAI_ENCRYPT_TABLES) return ANIMEKAI_ENCRYPT_TABLES;
  
  const decryptTables = loadAnimeKaiTables();
  if (!decryptTables) return null;
  
  // Reverse the decrypt tables: byte -> char becomes char -> byte
  ANIMEKAI_ENCRYPT_TABLES = {};
  for (const [pos, table] of Object.entries(decryptTables)) {
    ANIMEKAI_ENCRYPT_TABLES[pos] = {};
    for (const [byte, char] of Object.entries(table)) {
      ANIMEKAI_ENCRYPT_TABLES[pos][char] = parseInt(byte);
    }
  }
  
  console.log(`[AnimeKai] Built ${Object.keys(ANIMEKAI_ENCRYPT_TABLES).length} encrypt tables`);
  return ANIMEKAI_ENCRYPT_TABLES;
}

// Constant padding bytes in the cipher structure
const CONSTANT_BYTES = {
  1: 0xf2, 2: 0xdf, 3: 0x9b, 4: 0x9d, 5: 0x16, 6: 0xe5,
  8: 0x67, 9: 0xc9, 10: 0xdd,
  12: 0x9c,
  14: 0x29,
  16: 0x35,
  18: 0xc8,
};

// Header for encrypted output
const ANIMEKAI_HEADER = Buffer.from('c509bdb497cbc06873ff412af12fd8007624c29faa', 'hex');
const ANIMEKAI_HEADER_LEN = 21;

// AnimeKai encryption
function encryptAnimeKai(plaintext) {
  const tables = loadAnimeKaiEncryptTables();
  if (!tables) {
    throw new Error('AnimeKai encrypt tables not loaded');
  }
  
  // Calculate cipher length
  const plaintextLen = plaintext.length;
  let cipherDataLen;
  if (plaintextLen <= 1) cipherDataLen = 1;
  else if (plaintextLen <= 2) cipherDataLen = 8;
  else if (plaintextLen <= 3) cipherDataLen = 12;
  else if (plaintextLen <= 4) cipherDataLen = 14;
  else if (plaintextLen <= 5) cipherDataLen = 16;
  else if (plaintextLen <= 6) cipherDataLen = 18;
  else if (plaintextLen <= 7) cipherDataLen = 20;
  else cipherDataLen = 20 + (plaintextLen - 7);
  
  // Create cipher buffer with header
  const cipher = Buffer.alloc(ANIMEKAI_HEADER_LEN + cipherDataLen);
  ANIMEKAI_HEADER.copy(cipher, 0);
  
  // Fill constant bytes
  for (const [pos, byte] of Object.entries(CONSTANT_BYTES)) {
    const idx = ANIMEKAI_HEADER_LEN + parseInt(pos);
    if (idx < cipher.length) {
      cipher[idx] = byte;
    }
  }
  
  // Encrypt each character
  for (let i = 0; i < plaintextLen; i++) {
    const char = plaintext[i];
    const cipherPos = getCipherPosition(i);
    const table = tables[i];
    
    if (table && char in table) {
      cipher[ANIMEKAI_HEADER_LEN + cipherPos] = table[char];
    } else {
      // Fallback: use char code
      cipher[ANIMEKAI_HEADER_LEN + cipherPos] = char.charCodeAt(0);
    }
  }
  
  return urlSafeBase64Encode(cipher);
}

// ============================================================================
// MegaUp Crypto Implementation
// Uses enc-dec.app API for decryption (video-specific keystream)
// ============================================================================

const MEGAUP_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

/**
 * Decrypt MegaUp encrypted data using enc-dec.app API
 * 
 * The MegaUp encryption uses a video-specific keystream that depends on
 * the plaintext content (plaintext feedback cipher). We cannot reverse
 * engineer this without the obfuscated JavaScript, so we use the
 * enc-dec.app API which provides the decryption service.
 * 
 * @param {string} encryptedBase64 - URL-safe base64 encoded encrypted data
 * @returns {Promise<string>} - Decrypted JSON string
 */
async function decryptMegaUpViaAPI(encryptedBase64) {
  console.log(`[MegaUp Decrypt] Using enc-dec.app API...`);
  console.log(`[MegaUp Decrypt] Encrypted length: ${encryptedBase64.length} chars`);
  
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      text: encryptedBase64,
      agent: MEGAUP_USER_AGENT,
    });
    
    const req = https.request({
      hostname: 'enc-dec.app',
      path: '/api/dec-mega',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': MEGAUP_USER_AGENT,
      },
      timeout: 15000,
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf8');
        console.log(`[MegaUp Decrypt] API response: ${res.statusCode}`);
        
        try {
          const result = JSON.parse(data);
          
          if (result.status !== 200) {
            console.log(`[MegaUp Decrypt] API error: ${JSON.stringify(result)}`);
            reject(new Error(`enc-dec.app API error: ${result.message || JSON.stringify(result)}`));
            return;
          }
          
          // Result can be string or object
          const decrypted = typeof result.result === 'string' 
            ? result.result 
            : JSON.stringify(result.result);
          
          console.log(`[MegaUp Decrypt] Decrypted (first 100): ${decrypted.substring(0, 100)}...`);
          resolve(decrypted);
        } catch (e) {
          console.log(`[MegaUp Decrypt] API response parse error: ${e.message}`);
          console.log(`[MegaUp Decrypt] Raw response: ${data.substring(0, 200)}`);
          reject(new Error(`Failed to parse enc-dec.app response: ${e.message}`));
        }
      });
    });
    
    req.on('error', (err) => {
      console.log(`[MegaUp Decrypt] API request error: ${err.message}`);
      reject(new Error(`enc-dec.app request failed: ${err.message}`));
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('enc-dec.app request timeout'));
    });
    
    req.write(postData);
    req.end();
  });
}

// ============================================================================
// AnimeKai Full Extraction - RPI does EVERYTHING
// Fetches from AnimeKai, decrypts, fetches MegaUp, decrypts, returns stream
// ============================================================================

const KAI_DOMAINS = ['https://animekai.to', 'https://anikai.to'];
let KAI_BASE = KAI_DOMAINS[0];
function getKaiAjax() { return `${KAI_BASE}/ajax`; }
const KAI_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  'Accept': '*/*',
};

/**
 * Fetch JSON from AnimeKai
 */
async function fetchAnimeKaiJson(url) {
  const result = await _fetchAnimeKaiJson(url);
  if (result.status === 0 || result.error) {
    // Try fallback domain
    if (url.includes(KAI_DOMAINS[0]) && KAI_DOMAINS.length > 1) {
      const fallbackUrl = url.replace(KAI_DOMAINS[0], KAI_DOMAINS[1]);
      console.log(`[AnimeKai] Primary domain failed, trying fallback: ${KAI_DOMAINS[1]}`);
      const fallbackResult = await _fetchAnimeKaiJson(fallbackUrl);
      if (fallbackResult.data) {
        KAI_BASE = KAI_DOMAINS[1];
        console.log(`[AnimeKai] Switched to fallback domain: ${KAI_BASE}`);
        return fallbackResult;
      }
    }
  }
  return result;
}

async function _fetchAnimeKaiJson(url) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    https.get({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: KAI_HEADERS,
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, error: 'Invalid JSON', raw: data.substring(0, 200) });
        }
      });
    }).on('error', (e) => {
      resolve({ status: 0, error: e.message });
    });
  });
}

/**
 * Full AnimeKai extraction - RPI does EVERYTHING
 * 
 * Input: kai_id (anime ID) and episode number
 * Output: { success: true, streamUrl: "https://...", skip: {...} }
 */
async function fullAnimeKaiExtraction(kaiId, episodeNum, res) {
  console.log(`[AnimeKai Full] Starting extraction for kai_id=${kaiId}, episode=${episodeNum}`);
  
  try {
    // Step 1: Encrypt kai_id and fetch episodes
    const encKaiId = encryptAnimeKai(kaiId);
    const episodesUrl = `${getKaiAjax()}/episodes/list?ani_id=${kaiId}&_=${encKaiId}`;
    console.log(`[AnimeKai Full] Fetching episodes...`);
    
    const episodesResult = await fetchAnimeKaiJson(episodesUrl);
    if (!episodesResult.data?.result) {
      console.log(`[AnimeKai Full] Failed to get episodes:`, episodesResult);
      res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ success: false, error: 'Failed to fetch episodes', details: episodesResult }));
    }
    
    // Step 2: Parse episode token
    const episodeRegex = new RegExp(`<a[^>]*\\bnum="${episodeNum}"[^>]*\\btoken="([^"]+)"[^>]*>`, 'i');
    const episodeMatch = episodesResult.data.result.match(episodeRegex);
    
    if (!episodeMatch) {
      // Try alternate order
      const altRegex = new RegExp(`<a[^>]*\\btoken="([^"]+)"[^>]*\\bnum="${episodeNum}"[^>]*>`, 'i');
      const altMatch = episodesResult.data.result.match(altRegex);
      if (!altMatch) {
        console.log(`[AnimeKai Full] Episode ${episodeNum} not found`);
        res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ success: false, error: `Episode ${episodeNum} not found` }));
      }
      var episodeToken = altMatch[1];
    } else {
      var episodeToken = episodeMatch[1];
    }
    
    console.log(`[AnimeKai Full] Episode token: ${episodeToken}`);
    
    // Step 3: Encrypt token and fetch servers
    const encToken = encryptAnimeKai(episodeToken);
    const serversUrl = `${getKaiAjax()}/links/list?token=${episodeToken}&_=${encToken}`;
    console.log(`[AnimeKai Full] Fetching servers...`);
    
    const serversResult = await fetchAnimeKaiJson(serversUrl);
    if (!serversResult.data?.result) {
      console.log(`[AnimeKai Full] Failed to get servers:`, serversResult);
      res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ success: false, error: 'Failed to fetch servers', details: serversResult }));
    }
    
    // Step 4: Parse first server lid
    const serverRegex = /<span[^>]*class="server"[^>]*data-lid="([^"]+)"[^>]*>/i;
    const serverMatch = serversResult.data.result.match(serverRegex);
    
    if (!serverMatch) {
      console.log(`[AnimeKai Full] No servers found`);
      res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ success: false, error: 'No servers found' }));
    }
    
    const lid = serverMatch[1];
    console.log(`[AnimeKai Full] Server lid: ${lid}`);
    
    // Step 5: Encrypt lid and fetch embed
    const encLid = encryptAnimeKai(lid);
    const embedUrl = `${getKaiAjax()}/links/view?id=${lid}&_=${encLid}`;
    console.log(`[AnimeKai Full] Fetching embed...`);
    
    const embedResult = await fetchAnimeKaiJson(embedUrl);
    if (!embedResult.data?.result) {
      console.log(`[AnimeKai Full] Failed to get embed:`, embedResult);
      res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ success: false, error: 'Failed to fetch embed', details: embedResult }));
    }
    
    const encryptedEmbed = embedResult.data.result;
    console.log(`[AnimeKai Full] Got encrypted embed (${encryptedEmbed.length} chars)`);
    
    // Step 6-9: Use existing extractAnimeKaiStream function
    await extractAnimeKaiStream(encryptedEmbed, res);
    
  } catch (error) {
    console.error(`[AnimeKai Full] Unexpected error:`, error);
    res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ success: false, error: 'Extraction failed', details: error.message }));
  }
}

// ============================================================================
// AnimeKai Full Extraction Endpoint
// Does ALL the work: decrypt embed → fetch MegaUp /media/ → decrypt → return HLS
// ============================================================================

/**
 * Full AnimeKai extraction from encrypted embed response
 * 
 * Input: encrypted embed response from AnimeKai /ajax/links/view
 * Output: { success: true, streamUrl: "https://...", skip: {...} }
 * 
 * Flow:
 * 1. Decrypt AnimeKai embed response
 * 2. Decode }XX hex format
 * 3. Parse JSON to get MegaUp embed URL
 * 4. Extract video ID from embed URL
 * 5. Fetch MegaUp /media/{videoId} from residential IP
 * 6. Decrypt MegaUp response
 * 7. Return HLS stream URL
 */
async function extractAnimeKaiStream(encryptedEmbed, res) {
  console.log(`[AnimeKai Extract] Starting extraction...`);
  console.log(`[AnimeKai Extract] Encrypted embed length: ${encryptedEmbed.length}`);
  
  try {
    // Step 1: Decrypt AnimeKai embed
    let decrypted;
    try {
      decrypted = decryptAnimeKai(encryptedEmbed);
      console.log(`[AnimeKai Extract] Decrypted: ${decrypted.substring(0, 100)}...`);
    } catch (e) {
      console.log(`[AnimeKai Extract] Decrypt error: ${e.message}`);
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ success: false, error: 'AnimeKai decryption failed', details: e.message }));
    }
    
    // Step 2: Decode }XX hex format
    const decoded = decodeAnimeKaiHex(decrypted);
    console.log(`[AnimeKai Extract] Decoded: ${decoded.substring(0, 100)}...`);
    
    // Step 3: Parse JSON
    let embedData;
    try {
      embedData = JSON.parse(decoded);
    } catch (e) {
      console.log(`[AnimeKai Extract] JSON parse error: ${e.message}`);
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ success: false, error: 'Invalid embed JSON', details: decoded.substring(0, 200) }));
    }
    
    const embedUrl = embedData.url;
    const skip = embedData.skip || {};
    
    if (!embedUrl) {
      console.log(`[AnimeKai Extract] No URL in embed data`);
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ success: false, error: 'No URL in embed data', data: embedData }));
    }
    
    console.log(`[AnimeKai Extract] Embed URL: ${embedUrl}`);
    
    // Step 4: Extract video ID from embed URL
    const urlMatch = embedUrl.match(/https?:\/\/([^\/]+)\/e\/([^\/\?]+)/);
    if (!urlMatch) {
      console.log(`[AnimeKai Extract] Invalid embed URL format`);
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ success: false, error: 'Invalid MegaUp embed URL format', url: embedUrl }));
    }
    
    const [, host, videoId] = urlMatch;
    const mediaUrl = `https://${host}/media/${videoId}`;
    console.log(`[AnimeKai Extract] MegaUp /media/ URL: ${mediaUrl}`);
    
    // Step 5: Fetch MegaUp /media/ from residential IP
    const mediaResponse = await new Promise((resolve) => {
      const url = new URL(mediaUrl);
      
      const req = https.request({
        hostname: url.hostname,
        path: url.pathname,
        method: 'GET',
        headers: {
          'User-Agent': MEGAUP_USER_AGENT,
          'Accept': '*/*',
          'Accept-Encoding': 'identity',
          // NO Referer or Origin headers - MegaUp blocks them
        },
        timeout: 15000,
      }, (proxyRes) => {
        const chunks = [];
        proxyRes.on('data', chunk => chunks.push(chunk));
        proxyRes.on('end', () => {
          const data = Buffer.concat(chunks).toString('utf8');
          resolve({ status: proxyRes.statusCode, data });
        });
      });
      
      req.on('error', (err) => {
        resolve({ status: 0, error: err.message });
      });
      
      req.on('timeout', () => {
        req.destroy();
        resolve({ status: 0, error: 'Timeout' });
      });
      
      req.end();
    });
    
    console.log(`[AnimeKai Extract] MegaUp response: ${mediaResponse.status}`);
    
    if (mediaResponse.error) {
      console.log(`[AnimeKai Extract] MegaUp fetch error: ${mediaResponse.error}`);
      res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ success: false, error: 'MegaUp fetch failed', details: mediaResponse.error }));
    }
    
    if (mediaResponse.status !== 200) {
      console.log(`[AnimeKai Extract] MegaUp HTTP error: ${mediaResponse.status}`);
      console.log(`[AnimeKai Extract] Response: ${mediaResponse.data.substring(0, 200)}`);
      res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ success: false, error: `MegaUp returned ${mediaResponse.status}`, response: mediaResponse.data.substring(0, 500) }));
    }
    
    // Parse MegaUp response
    let megaupData;
    try {
      megaupData = JSON.parse(mediaResponse.data);
    } catch (e) {
      console.log(`[AnimeKai Extract] MegaUp JSON parse error`);
      res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ success: false, error: 'Invalid MegaUp response', response: mediaResponse.data.substring(0, 500) }));
    }
    
    if (megaupData.status !== 200 || !megaupData.result) {
      console.log(`[AnimeKai Extract] MegaUp API error: ${JSON.stringify(megaupData)}`);
      res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ success: false, error: 'MegaUp API error', data: megaupData }));
    }
    
    console.log(`[AnimeKai Extract] Got encrypted MegaUp data (${megaupData.result.length} chars)`);
    console.log(`[AnimeKai Extract] Encrypted result (first 50): ${megaupData.result.substring(0, 50)}`);
    
    // Step 6: Decrypt MegaUp response using enc-dec.app API
    let streamData;
    try {
      const decryptedMegaUp = await decryptMegaUpViaAPI(megaupData.result);
      console.log(`[AnimeKai Extract] Decrypted MegaUp: ${decryptedMegaUp.substring(0, 100)}...`);
      streamData = JSON.parse(decryptedMegaUp);
    } catch (e) {
      console.log(`[AnimeKai Extract] MegaUp decrypt error: ${e.message}`);
      
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ 
        success: false, 
        error: 'MegaUp decryption failed', 
        details: e.message,
        debug: {
          mediaUrl: mediaUrl,
          encryptedLength: megaupData.result.length,
          encryptedFirst50: megaupData.result.substring(0, 50),
        }
      }));
    }
    
    // Step 7: Extract stream URL
    let streamUrl = '';
    if (streamData.sources && streamData.sources[0]) {
      streamUrl = streamData.sources[0].file || streamData.sources[0].url || '';
    } else if (streamData.file) {
      streamUrl = streamData.file;
    } else if (streamData.url) {
      streamUrl = streamData.url;
    }
    
    if (!streamUrl) {
      console.log(`[AnimeKai Extract] No stream URL in decrypted data`);
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ success: false, error: 'No stream URL in MegaUp response', data: streamData }));
    }
    
    console.log(`[AnimeKai Extract] ✅ SUCCESS! Stream URL: ${streamUrl.substring(0, 80)}...`);
    
    // Return success
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({
      success: true,
      streamUrl,
      skip,
      tracks: streamData.tracks || [],
    }));
    
  } catch (error) {
    console.error(`[AnimeKai Extract] Unexpected error:`, error);
    res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ success: false, error: 'Extraction failed', details: error.message }));
  }
}

// ============================================================================
// VIPRow/Casthill Stream Extraction
// boanki.net blocks Cloudflare Workers, so we do extraction from residential IP
// ============================================================================

const VIPROW_BASE = 'https://www.viprow.nu';
const CASTHILL_ORIGIN = 'https://casthill.net';
const CASTHILL_REFERER = 'https://casthill.net/';
const VIPROW_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Allowed domains for VIPRow proxying
const VIPROW_ALLOWED_DOMAINS = ['peulleieo.net', 'boanki.net'];

function isVIPRowAllowedUrl(url) {
  try {
    const parsed = new URL(url);
    return VIPROW_ALLOWED_DOMAINS.some(domain => parsed.hostname.endsWith(domain));
  } catch {
    return false;
  }
}

/**
 * Fetch a URL with custom headers (follows redirects)
 */
function fetchWithHeaders(url, headers = {}, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': VIPROW_USER_AGENT,
        ...headers
      },
      timeout: 30000,
    };
    
    const req = client.request(options, (res) => {
      // Handle redirects
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        if (maxRedirects <= 0) {
          reject(new Error('Too many redirects'));
          return;
        }
        const redirectUrl = res.headers.location.startsWith('http') 
          ? res.headers.location 
          : new URL(res.headers.location, url).toString();
        console.log(`[VIPRow] Redirect -> ${redirectUrl.substring(0, 80)}...`);
        fetchWithHeaders(redirectUrl, headers, maxRedirects - 1).then(resolve).catch(reject);
        return;
      }
      
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          data: Buffer.concat(chunks),
          headers: res.headers,
          url: url, // Final URL after redirects
        });
      });
    });
    
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

/**
 * Extract m3u8 from VIPRow/Casthill embed
 * Updated Jan 2026 to handle new player script format
 * 
 * New format variables:
 *   - playerId: device ID (e.g., "b4k7t7u7o1s7x2o9n9k3x7l5n1b3m7a6")
 *   - strUnqId: stream unique ID (e.g., "yeyafa6i1eputaza6u3o_pecuvoxi9a2ici6abogi_...")
 *   - sCode: initial scode via decodeSr([charCodes])
 *   - secTokenUrl: base64 encoded "https://boanki.net"
 *   - csrftoken: double base64 encoded CSRF token
 *   - videoSource: double base64 encoded manifest URL (via char codes)
 *   - edgeHostId: host ID (e.g., "s-b1")
 *   - expireTs: expiry timestamp
 */
async function extractVIPRowM3U8(streamPageUrl) {
  console.log(`[VIPRow] Extracting from: ${streamPageUrl}`);
  
  try {
    // Step 1: Fetch VIPRow stream page
    const streamRes = await fetchWithHeaders(streamPageUrl, { 'Referer': VIPROW_BASE });
    
    if (streamRes.status !== 200) {
      return { success: false, error: `Failed to fetch stream page: ${streamRes.status}` };
    }
    
    const streamHtml = streamRes.data.toString('utf8');
    
    // Extract embed parameters
    const zmidMatch = streamHtml.match(/const\s+zmid\s*=\s*["']([^"']+)["']/);
    const pidMatch = streamHtml.match(/const\s+pid\s*=\s*(\d+)/);
    const edmMatch = streamHtml.match(/const\s+edm\s*=\s*["']([^"']+)["']/);
    const configMatch = streamHtml.match(/const siteConfig = (\{[^;]+\});/);
    
    if (!zmidMatch || !pidMatch || !edmMatch) {
      return { success: false, error: 'Failed to extract embed parameters' };
    }
    
    const zmid = zmidMatch[1];
    const pid = pidMatch[1];
    const edm = edmMatch[1];
    
    let csrf = '', csrf_ip = '', category = '';
    if (configMatch) {
      try {
        const config = JSON.parse(configMatch[1]);
        csrf = config.csrf || '';
        csrf_ip = config.csrf_ip || '';
        category = config.linkAppendUri || '';
      } catch {
        csrf = streamHtml.match(/"csrf"\s*:\s*"([^"]+)"/)?.[1] || '';
        csrf_ip = streamHtml.match(/"csrf_ip"\s*:\s*"([^"]+)"/)?.[1] || '';
        category = streamHtml.match(/"linkAppendUri"\s*:\s*"([^"]+)"/)?.[1] || '';
      }
    }
    
    console.log(`[VIPRow] Embed params: zmid=${zmid}, pid=${pid}, edm=${edm}, category=${category}`);
    
    // Step 2: Fetch Casthill embed
    const embedParams = new URLSearchParams({
      pid, gacat: '', gatxt: category, v: zmid, csrf, csrf_ip,
    });
    const embedUrl = `https://${edm}/sd0embed/${category}?${embedParams}`;
    
    console.log(`[VIPRow] Fetching embed: ${embedUrl.substring(0, 80)}...`);
    
    const embedRes = await fetchWithHeaders(embedUrl, {
      'Referer': streamPageUrl,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    });
    
    if (embedRes.status !== 200) {
      return { success: false, error: `Failed to fetch embed: ${embedRes.status}` };
    }
    
    const embedHtml = embedRes.data.toString('utf8');
    
    // Find player script - look for the one with Clappr and isPlayerLoaded
    const scriptPattern = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    let playerScript = null;
    let match;
    while ((match = scriptPattern.exec(embedHtml)) !== null) {
      const script = match[1];
      // New format: contains Clappr player and isPlayerLoaded
      if (script.includes('Clappr') && script.includes('isPlayerLoaded') && script.length > 5000) {
        playerScript = script;
        break;
      }
    }
    
    if (!playerScript) {
      return { success: false, error: 'Player script not found' };
    }
    
    console.log(`[VIPRow] Found player script (${playerScript.length} chars)`);
    
    // Extract variables using new format patterns (Jan 2026)
    let deviceId, streamId, hostId, timestamp, initialScode, baseUrl, csrfAuth, manifestUrl;
    
    // New format: const playerId="..."
    const playerIdMatch = playerScript.match(/const\s+playerId\s*=\s*["']([a-z0-9]+)["']/);
    if (playerIdMatch) deviceId = playerIdMatch[1];
    
    // New format: const strUnqId="..."
    const strUnqIdMatch = playerScript.match(/const\s+strUnqId\s*=\s*["']([^"']+)["']/);
    if (strUnqIdMatch) streamId = strUnqIdMatch[1];
    
    // New format: const edgeHostId="..."
    const edgeHostIdMatch = playerScript.match(/const\s+edgeHostId\s*=\s*["']([^"']+)["']/);
    if (edgeHostIdMatch) hostId = edgeHostIdMatch[1];
    
    // New format: const expireTs=parseInt("...",10)
    const expireTsMatch = playerScript.match(/const\s+expireTs\s*=\s*parseInt\s*\(\s*["'](\d+)["']/);
    if (expireTsMatch) timestamp = expireTsMatch[1];
    
    // New format: const sCode=decodeSr([charCodes])
    const sCodeMatch = playerScript.match(/const\s+sCode\s*=\s*decodeSr\s*\(\s*\[\s*([0-9,\s]+)\s*\]\s*\)/);
    if (sCodeMatch) {
      const charCodes = JSON.parse('[' + sCodeMatch[1].replace(/\s/g, '') + ']');
      initialScode = String.fromCharCode(...charCodes);
    }
    
    // New format: const secTokenUrl=bota("base64")
    const secTokenUrlMatch = playerScript.match(/const\s+secTokenUrl\s*=\s*bota\s*\(\s*["']([^"']+)["']\s*\)/);
    if (secTokenUrlMatch) {
      baseUrl = Buffer.from(secTokenUrlMatch[1], 'base64').toString('utf8');
    }
    
    // New format: const csrftoken="double_base64"
    const csrftokenMatch = playerScript.match(/const\s+csrftoken\s*=\s*["']([^"']+)["']/);
    if (csrftokenMatch) {
      const decoded1 = Buffer.from(csrftokenMatch[1], 'base64').toString('utf8');
      csrfAuth = Buffer.from(decoded1, 'base64').toString('utf8');
    }
    
    // New format: const videoSource=bota(decodeSr([charCodes]))
    const videoSourceMatch = playerScript.match(/const\s+videoSource\s*=\s*bota\s*\(\s*decodeSr\s*\(\s*\[\s*([0-9,\s]+)\s*\]\s*\)\s*\)/);
    if (videoSourceMatch) {
      const charCodes = JSON.parse('[' + videoSourceMatch[1].replace(/\s/g, '') + ']');
      const charString = String.fromCharCode(...charCodes);
      const decoded1 = Buffer.from(charString, 'base64').toString('utf8');
      manifestUrl = Buffer.from(decoded1, 'base64').toString('utf8');
    }
    
    // Fallback: try old format patterns if new ones didn't work
    if (!deviceId || !streamId || !baseUrl || !manifestUrl) {
      console.log(`[VIPRow] New patterns incomplete, trying old format...`);
      
      // Old format patterns
      if (!deviceId) deviceId = playerScript.match(/r\s*=\s*["']([a-z0-9]+)["']/)?.[1];
      if (!streamId) streamId = playerScript.match(/s\s*=\s*["']([a-z0-9]+)["']/)?.[1];
      if (!hostId) hostId = playerScript.match(/m\s*=\s*["']([a-z0-9-]+)["']/)?.[1];
      if (!timestamp) timestamp = playerScript.match(/a\s*=\s*parseInt\s*\(\s*["'](\d+)["']/)?.[1];
      
      // Old format: i = e([charCodes])
      if (!initialScode) {
        const iMatch = playerScript.match(/i\s*=\s*e\s*\(\s*\[\s*([0-9,\s]+)\s*\]\s*\)/);
        if (iMatch) {
          const charCodes = JSON.parse('[' + iMatch[1].replace(/\s/g, '') + ']');
          initialScode = String.fromCharCode(...charCodes);
        }
      }
      
      // Old format: c = t("base64")
      if (!baseUrl) {
        const cMatch = playerScript.match(/c\s*=\s*t\s*\(\s*["']([^"']+)["']\s*\)/);
        if (cMatch) baseUrl = Buffer.from(cMatch[1], 'base64').toString('utf8');
      }
      
      // Old format: l = t("double_base64")
      if (!csrfAuth) {
        const lMatch = playerScript.match(/l\s*=\s*t\s*\(\s*["']([^"']+)["']\s*\)/);
        if (lMatch) {
          const decoded1 = Buffer.from(lMatch[1], 'base64').toString('utf8');
          csrfAuth = Buffer.from(decoded1, 'base64').toString('utf8');
        }
      }
      
      // Old format: d = t(e([charCodes]))
      if (!manifestUrl) {
        const dMatch = playerScript.match(/d\s*=\s*t\s*\(\s*e\s*\(\s*\[\s*([0-9,\s]+)\s*\]\s*\)\s*\)/);
        if (dMatch) {
          const charCodes = JSON.parse('[' + dMatch[1].replace(/\s/g, '') + ']');
          const dString = String.fromCharCode(...charCodes);
          const dDecoded = Buffer.from(dString, 'base64').toString('utf8');
          manifestUrl = Buffer.from(dDecoded, 'base64').toString('utf8');
        }
      }
    }
    
    console.log(`[VIPRow] Extracted: deviceId=${deviceId}, streamId=${streamId?.substring(0, 30)}..., hostId=${hostId}`);
    console.log(`[VIPRow] baseUrl=${baseUrl}, manifestUrl=${manifestUrl?.substring(0, 60)}...`);
    
    if (!deviceId || !streamId || !baseUrl || !manifestUrl) {
      return { success: false, error: 'Failed to extract stream variables' };
    }
    
    // Step 3: Refresh token via boanki.net
    const tokenUrl = `${baseUrl}?scode=${encodeURIComponent(initialScode || '')}&stream=${encodeURIComponent(streamId)}&expires=${encodeURIComponent(timestamp || '')}&u_id=${encodeURIComponent(deviceId)}&host_id=${encodeURIComponent(hostId || '')}`;
    
    console.log(`[VIPRow] Refreshing token: ${tokenUrl.substring(0, 80)}...`);
    
    const tokenRes = await fetchWithHeaders(tokenUrl, {
      'Accept': 'application/json',
      'X-CSRF-Auth': csrfAuth || '',
      'Origin': CASTHILL_ORIGIN,
      'Referer': CASTHILL_REFERER,
    });
    
    if (tokenRes.status !== 200) {
      return { success: false, error: `Token refresh failed: ${tokenRes.status}` };
    }
    
    let tokenData;
    try {
      tokenData = JSON.parse(tokenRes.data.toString('utf8'));
    } catch (e) {
      return { success: false, error: 'Invalid token response' };
    }
    
    console.log(`[VIPRow] Token response: success=${tokenData.success}`);
    
    if (!tokenData.success) {
      return { success: false, error: 'Token refresh unsuccessful' };
    }
    
    // Step 4: Fetch manifest (follow redirects)
    const url = new URL(manifestUrl);
    url.searchParams.set('u_id', tokenData.device_id || deviceId);
    
    console.log(`[VIPRow] Fetching manifest: ${url.toString().substring(0, 80)}...`);
    
    const manifestRes = await fetchWithHeaders(url.toString(), {
      'Origin': CASTHILL_ORIGIN,
      'Referer': CASTHILL_REFERER,
    });
    
    if (manifestRes.status !== 200) {
      return { success: false, error: `Manifest fetch failed: ${manifestRes.status}` };
    }
    
    const manifest = manifestRes.data.toString('utf8');
    
    console.log(`[VIPRow] ✅ Got manifest (${manifest.length} chars)`);
    
    return {
      success: true,
      m3u8Url: manifestRes.url || url.toString(),
      manifest,
      streamId,
      deviceId: tokenData.device_id || deviceId,
    };
    
  } catch (error) {
    console.error(`[VIPRow] Error:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Rewrite manifest URLs to go through proxy
 * Handles both master playlists (variant streams) and media playlists (segments)
 */
function rewriteVIPRowManifestUrls(manifest, baseUrl, proxyBase) {
  const lines = manifest.split('\n');
  const rewritten = [];
  
  // Detect if this is a master playlist (contains #EXT-X-STREAM-INF)
  const isMasterPlaylist = manifest.includes('#EXT-X-STREAM-INF');
  
  // Strip trailing /viprow from proxyBase if present (CF proxy passes it with /viprow suffix)
  const cleanProxyBase = proxyBase.replace(/\/viprow\/?$/, '');
  
  for (const line of lines) {
    let newLine = line;
    const trimmed = line.trim();
    
    if (trimmed === '') {
      rewritten.push(line);
      continue;
    }
    
    // Rewrite key URLs (in media playlists)
    if (trimmed.includes('URI="')) {
      newLine = trimmed.replace(/URI="([^"]+)"/, (_, url) => {
        const fullUrl = url.startsWith('http') ? url : new URL(url, baseUrl).toString();
        return `URI="${cleanProxyBase}/viprow/key?url=${encodeURIComponent(fullUrl)}"`;
      });
    }
    // Skip other comments/tags
    else if (trimmed.startsWith('#')) {
      rewritten.push(line);
      continue;
    }
    // Rewrite URLs (variant streams in master, segments in media)
    else if (trimmed.length > 0) {
      const fullUrl = trimmed.startsWith('http') ? trimmed : new URL(trimmed, baseUrl).toString();
      
      if (isMasterPlaylist) {
        // Variant stream URL - route through manifest proxy
        newLine = `${cleanProxyBase}/viprow/manifest?url=${encodeURIComponent(fullUrl)}`;
      } else if (trimmed.includes('.ts') || trimmed.includes('?') || !trimmed.includes('.')) {
        // Segment URL - route through segment proxy
        newLine = `${cleanProxyBase}/viprow/segment?url=${encodeURIComponent(fullUrl)}`;
      } else {
        // Unknown URL type - assume it's a manifest
        newLine = `${cleanProxyBase}/viprow/manifest?url=${encodeURIComponent(fullUrl)}`;
      }
    }
    
    rewritten.push(newLine);
  }
  
  return rewritten.join('\n');
}

/**
 * VIPRow stream extraction endpoint handler
 */
async function extractVIPRowStream(eventUrl, linkNum, cfProxy, res) {
  // Construct full stream page URL
  const streamPageUrl = eventUrl.startsWith('http') 
    ? eventUrl 
    : `${VIPROW_BASE}${eventUrl}-${linkNum}`;
  
  console.log(`[VIPRow] Extracting stream from: ${streamPageUrl}`);
  
  const result = await extractVIPRowM3U8(streamPageUrl);
  
  if (!result.success) {
    console.log(`[VIPRow] Extraction failed: ${result.error}`);
    res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ error: result.error }));
  }
  
  // Rewrite manifest URLs to go through CF proxy (or RPI proxy if no CF proxy)
  const baseUrl = result.m3u8Url.substring(0, result.m3u8Url.lastIndexOf('/') + 1);
  const proxyBase = cfProxy || ''; // If no CF proxy, use relative URLs
  const rewrittenManifest = rewriteVIPRowManifestUrls(result.manifest, baseUrl, proxyBase);
  
  console.log(`[VIPRow] ✅ Returning manifest (${rewrittenManifest.length} chars)`);
  
  res.writeHead(200, {
    'Content-Type': 'application/vnd.apple.mpegurl',
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(rewrittenManifest);
}

/**
 * VIPRow manifest proxy handler
 */
async function proxyVIPRowManifest(manifestUrl, cfProxy, res) {
  if (!isVIPRowAllowedUrl(manifestUrl)) {
    res.writeHead(403, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ error: 'URL not allowed' }));
  }
  
  console.log(`[VIPRow] Proxying manifest: ${manifestUrl.substring(0, 80)}...`);
  
  try {
    const response = await fetchWithHeaders(manifestUrl, {
      'Origin': CASTHILL_ORIGIN,
      'Referer': CASTHILL_REFERER,
    });
    
    if (response.status !== 200) {
      res.writeHead(response.status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: `Upstream error: ${response.status}` }));
    }
    
    const manifest = response.data.toString('utf8');
    const finalUrl = response.url || manifestUrl;
    const baseUrl = finalUrl.substring(0, finalUrl.lastIndexOf('/') + 1);
    const proxyBase = cfProxy || '';
    const rewritten = rewriteVIPRowManifestUrls(manifest, baseUrl, proxyBase);
    
    res.writeHead(200, {
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(rewritten);
  } catch (error) {
    console.error(`[VIPRow] Manifest proxy error:`, error);
    res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: 'Proxy failed' }));
  }
}

/**
 * VIPRow key proxy handler
 */
async function proxyVIPRowKey(keyUrl, res) {
  if (!isVIPRowAllowedUrl(keyUrl)) {
    res.writeHead(403, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ error: 'URL not allowed' }));
  }
  
  console.log(`[VIPRow] Proxying key: ${keyUrl.substring(0, 80)}...`);
  
  try {
    const response = await fetchWithHeaders(keyUrl, {
      'Origin': CASTHILL_ORIGIN,
      'Referer': CASTHILL_REFERER,
    });
    
    if (response.status !== 200) {
      res.writeHead(response.status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: `Upstream error: ${response.status}` }));
    }
    
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': response.data.length,
      'Cache-Control': 'max-age=300',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(response.data);
  } catch (error) {
    console.error(`[VIPRow] Key proxy error:`, error);
    res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: 'Proxy failed' }));
  }
}

/**
 * VIPRow segment proxy handler
 */
async function proxyVIPRowSegment(segmentUrl, res) {
  if (!isVIPRowAllowedUrl(segmentUrl)) {
    res.writeHead(403, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ error: 'URL not allowed' }));
  }
  
  console.log(`[VIPRow] Proxying segment: ${segmentUrl.substring(0, 80)}...`);
  
  try {
    const response = await fetchWithHeaders(segmentUrl, {
      'Origin': CASTHILL_ORIGIN,
      'Referer': CASTHILL_REFERER,
    });
    
    if (response.status !== 200) {
      res.writeHead(response.status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: `Upstream error: ${response.status}` }));
    }
    
    res.writeHead(200, {
      'Content-Type': 'video/mp2t',
      'Content-Length': response.data.length,
      'Cache-Control': 'max-age=60',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(response.data);
  } catch (error) {
    console.error(`[VIPRow] Segment proxy error:`, error);
    res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: 'Proxy failed' }));
  }
}

server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║     Raspberry Pi Proxy (DLHD Heartbeat + Auth Token)      ║
╠═══════════════════════════════════════════════════════════╣
║  Port: ${PORT.toString().padEnd(49)}║
║  API Key: ${API_KEY.substring(0, 8)}${'*'.repeat(Math.max(0, API_KEY.length - 8)).padEnd(41)}║
╠═══════════════════════════════════════════════════════════╣
║  Endpoints:                                               ║
║    GET /proxy?url=<encoded_url>  - Proxy a request        ║
║    GET /ppv?url=<encoded_url>    - PPV.to stream proxy    ║
║    GET /heartbeat?channel=&server=&domain= - DLHD session ║
║    GET /iptv/stream?url=&mac=&token= - IPTV stream proxy  ║
║    GET /animekai?url=&referer= - AnimeKai/MegaUp CDN       ║
║    GET /animekai/extract?embed=<encrypted> - Full extract ║
║    GET /flixer/stream?url= - Flixer CDN proxy             ║
║    GET /hianime/stream?url= - HiAnime/MegaCloud CDN      ║
║    GET /vidlink/stream?url= - VidLink CDN proxy           ║
║    GET /dlhd/stream?url=&referer=&auth= - DLHD CDN proxy ║
║    GET /vidsrc/stream?url=&referer= - VidSrc CDN proxy   ║
║    GET /1movies/stream?url= - 1movies CDN proxy           ║
║    GET /viprow/stream?url=&link=&cf_proxy= - VIPRow m3u8  ║
║    GET /viprow/manifest?url=&cf_proxy= - VIPRow manifest  ║
║    GET /viprow/key?url= - VIPRow AES key proxy            ║
║    GET /viprow/segment?url= - VIPRow segment proxy        ║
║    GET /health                   - Health check           ║
║    GET /whitelist-status         - DLHD whitelist status  ║
║    GET /dlhd-key-v6?url=         - DLHD key (reCAPTCHA)  ║
╠═══════════════════════════════════════════════════════════╣
║  CDN Support:                                             ║
║    - MegaUp (AnimeKai): No Referer header                 ║
║    - Flixer (p.XXXXX.workers.dev): Requires Referer       ║
║    - PPV.to (poocloud.in): Requires Referer pooembed.top  ║
║    - VIPRow (boanki.net): Requires Origin casthill.net    ║
╠═══════════════════════════════════════════════════════════╣
║  Expose with:                                             ║
║    cloudflared tunnel --url localhost:${PORT.toString().padEnd(20)}║
║    ngrok http ${PORT.toString().padEnd(43)}║
╚═══════════════════════════════════════════════════════════╝
  `);
  
  // Seed pool immediately with fallback proxies so we're usable right away
  PROXY_POOL.validated = FALLBACK_SOCKS5_PROXIES.map(p => ({
    host: p.split(':')[0],
    port: parseInt(p.split(':')[1]),
    str: p,
    lastValidated: Date.now(),
    failures: 0,
  }));
  console.log(`[ProxyPool] Seeded ${PROXY_POOL.validated.length} fallback proxies immediately`);
  
  // Start full SOCKS5 proxy pool validation in background (replaces fallbacks with bigger pool)
  console.log(`[ProxyPool] Starting background pool refresh...`);
  refreshProxyPool().then(() => {
    console.log(`[ProxyPool] Background refresh complete: ${PROXY_POOL.validated.length} proxies`);
  });
  
  // Schedule periodic refresh every 10 minutes
  setInterval(() => {
    console.log(`[ProxyPool] Scheduled refresh (pool: ${PROXY_POOL.validated.length} proxies)`);
    refreshProxyPool();
  }, PROXY_POOL_CONFIG.refreshIntervalMs);

  // ============================================================================
  // DLHD reCAPTCHA v3 IP Whitelist — ON-DEMAND ONLY
  // NO background daemon — whitelist budget is limited to 13 channels / 30 min.
  // Whitelisting happens on-demand in /dlhd-key-v6 when poison keys are detected.
  // ============================================================================
  console.log(`[DLHD-Whitelist] On-demand whitelist mode (no background daemon). Budget: ${WHITELIST_BUDGET} channels / 30 min`);
});
