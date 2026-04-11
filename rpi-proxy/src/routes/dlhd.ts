/**
 * DLHD route handlers
 * /dlhd-key-v4 — passthrough with pre-computed auth headers
 * /dlhd-key — fetches key via V5 auth module
 * /heartbeat — establishes heartbeat session
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */

import https from 'https';
import type { ServerResponse } from 'http';
import type { RPIRequest } from '../types';
import { sendJsonError, sendJson } from '../utils';
import { isAllowedProxyDomain } from '../services/domain-allowlist';

/**
 * Inject a sticky session ID into a ProxyJet SOCKS5 URL.
 * Transforms: socks5://USER:PASS@HOST:PORT → socks5://USER-ip-SESSIONID:PASS@HOST:PORT
 * This ensures the same residential IP is used for whitelist + key fetch.
 */
function injectStickySession(proxyUrl: string, sessionId: string): string {
  try {
    const url = new URL(proxyUrl);
    // Only inject if not already sticky (no "-ip-" in username)
    if (url.username && !url.username.includes('-ip-')) {
      url.username = `${url.username}-ip-${sessionId}`;
    }
    return url.toString();
  } catch {
    // Fallback: try regex replacement for non-standard URLs
    return proxyUrl.replace(
      /^(socks5:\/\/)([^:]+)(:.+@)/,
      `$1$2-ip-${sessionId}$3`
    );
  }
}

/**
 * /dlhd-key-v4 — Simple passthrough with pre-computed auth headers.
 * CF Worker computes PoW and sends jwt/timestamp/nonce.
 */
export async function handleDLHDKeyV4(req: RPIRequest, res: ServerResponse): Promise<void> {
  const targetUrl = req.url.searchParams.get('url');
  const jwt = req.url.searchParams.get('jwt');
  const timestamp = req.url.searchParams.get('timestamp');
  const nonce = req.url.searchParams.get('nonce');

  if (!targetUrl || !jwt || !timestamp || !nonce) {
    sendJsonError(res, 400, {
      error: 'Missing parameters',
      details: '/dlhd-key-v4?url=<key_url>&jwt=<token>&timestamp=<ts>&nonce=<n>',
      timestamp: Date.now(),
    });
    return;
  }

  const url = new URL(targetUrl);

  const proxyReq = https.request(
    {
      hostname: url.hostname,
      path: url.pathname,
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: '*/*',
        Origin: 'https://www.ksohls.ru',
        Referer: 'https://www.ksohls.ru/',
        Authorization: `Bearer ${jwt}`,
        'X-Key-Timestamp': timestamp,
        'X-Key-Nonce': nonce,
      },
      timeout: 15000,
    },
    (proxyRes) => {
      const chunks: Buffer[] = [];
      proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
      proxyRes.on('end', () => {
        const data = Buffer.concat(chunks);
        const text = data.toString('utf8');

        if (data.length === 16 && !text.startsWith('{') && !text.startsWith('E')) {
          res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Length': data.length,
            'Access-Control-Allow-Origin': '*',
            'X-Fetched-By': 'rpi-v4-passthrough',
          });
          res.end(data);
        } else {
          sendJsonError(res, proxyRes.statusCode ?? 502, {
            error: 'Invalid key response',
            details: text.substring(0, 200),
            timestamp: Date.now(),
          });
        }
      });
    }
  );

  proxyReq.on('error', (err) => {
    sendJsonError(res, 502, { error: err.message, timestamp: Date.now() });
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    sendJsonError(res, 504, { error: 'Timeout', timestamp: Date.now() });
  });

  proxyReq.end();
}

/**
 * /dlhd-key — Fetches DLHD encryption key via V5 auth module.
 * Falls back to the legacy dlhd-auth-v5 module.
 */
export async function handleDLHDKey(req: RPIRequest, res: ServerResponse): Promise<void> {
  const targetUrl = req.url.searchParams.get('url');

  if (!targetUrl) {
    sendJsonError(res, 400, {
      error: 'Missing url parameter',
      details: '/dlhd-key?url=<key_url>',
      timestamp: Date.now(),
    });
    return;
  }

  const decoded = decodeURIComponent(targetUrl);
  if (!isAllowedProxyDomain(decoded)) {
    sendJsonError(res, 403, { error: 'Domain not allowed', timestamp: Date.now() });
    return;
  }

  try {
    // Dynamic require for the legacy JS auth modules
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const dlhdAuthV5 = require('../../dlhd-auth-v5');
    const result = await dlhdAuthV5.fetchDLHDKeyV5(targetUrl);

    if (result.success && result.data) {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': result.data.length,
        'Access-Control-Allow-Origin': '*',
        'X-Fetched-By': 'rpi-v5-auth',
      });
      res.end(result.data);
    } else {
      sendJsonError(res, 502, {
        error: result.error ?? 'Key fetch failed',
        code: result.code,
        timestamp: Date.now(),
      });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    sendJsonError(res, 502, { error: message, timestamp: Date.now() });
  }
}

/**
 * /heartbeat — Establishes heartbeat session for DLHD key fetching.
 */
export async function handleHeartbeat(req: RPIRequest, res: ServerResponse): Promise<void> {
  const channel = req.url.searchParams.get('channel');
  const server = req.url.searchParams.get('server');
  const domain = req.url.searchParams.get('domain') ?? 'soyspace.cyou';

  if (!channel || !server) {
    sendJsonError(res, 400, {
      error: 'Missing channel or server parameter',
      details: '/heartbeat?channel=51&server=zeko&domain=soyspace.cyou',
      timestamp: Date.now(),
    });
    return;
  }

  try {
    // Fetch auth token from player page
    const authData = await fetchAuthToken(channel);
    if (!authData?.token) {
      sendJsonError(res, 502, { error: 'Failed to get auth token', timestamp: Date.now() });
      return;
    }

    const result = await establishHeartbeatSession(
      channel, server, domain, authData.token, authData.country, authData.timestamp
    );

    sendJson(res, result.success ? 200 : 502, {
      success: result.success,
      channel,
      server,
      domain,
      expiry: result.expiry,
      error: result.error,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    sendJsonError(res, 502, { error: message, timestamp: Date.now() });
  }
}

// ---- Internal helpers (extracted from server.js) ----

interface AuthData {
  token: string;
  country: string;
  timestamp: string;
}

function fetchAuthToken(channel: string): Promise<AuthData | null> {
  // UPDATED Mar 27 2026: www.ksohls.ru is primary (browser recon confirmed)
  return fetchAuthTokenFromDomain(channel, 'www.ksohls.ru')
    .then(result => result || fetchAuthTokenFromDomain(channel, 'www.ksohls.ru'));
}

function fetchAuthTokenFromDomain(channel: string, domain: string): Promise<AuthData | null> {
  return new Promise((resolve) => {
    const url = `https://${domain}/premiumtv/daddyhd.php?id=${channel}`;
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: 'https://dlstreams.top/',
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => (data += chunk));
      res.on('end', () => {
        const tokenMatch = data.match(/AUTH_TOKEN\s*=\s*["']([^"']+)["']/);
        if (!tokenMatch) { resolve(null); return; }
        const countryMatch = data.match(/AUTH_COUNTRY\s*=\s*["']([^"']+)["']/);
        const tsMatch = data.match(/AUTH_TS\s*=\s*["']([^"']+)["']/);
        resolve({
          token: tokenMatch[1],
          country: countryMatch?.[1] ?? 'US',
          timestamp: tsMatch?.[1] ?? String(Math.floor(Date.now() / 1000)),
        });
      });
    }).on('error', () => resolve(null));
  });
}

interface HeartbeatResult {
  success: boolean;
  expiry?: number;
  error?: string;
}

function establishHeartbeatSession(
  channel: string, server: string, domain: string,
  authToken: string, country: string, timestamp: string
): Promise<HeartbeatResult> {
  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const channelKey = `premium${channel}`;
  const fingerprint = `${userAgent}|1920x1080|America/New_York|en-US`;
  const signData = `${channelKey}|${country}|${timestamp}|${userAgent}|${fingerprint}`;
  const clientToken = Buffer.from(signData).toString('base64');

  return new Promise((resolve) => {
    const hbUrl = `https://${server}.${domain}/heartbeat`;
    const hbReq = https.get(hbUrl, {
      headers: {
        'User-Agent': userAgent,
        Accept: '*/*',
        Origin: 'https://www.ksohls.ru',
        Referer: 'https://www.ksohls.ru/',
        Authorization: `Bearer ${authToken}`,
        'X-Channel-Key': channelKey,
        'X-Client-Token': clientToken,
        'X-User-Agent': userAgent,
      },
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode === 404) {
          resolve({ success: false, error: 'No heartbeat endpoint (404)' });
          return;
        }
        if (res.statusCode === 200 && (data.includes('"ok"') || data.includes('"status":"ok"'))) {
          let expiry = Math.floor(Date.now() / 1000) + 1800;
          try { const json = JSON.parse(data); if (json.expiry) expiry = json.expiry; } catch { /* ignore */ }
          resolve({ success: true, expiry });
        } else {
          resolve({ success: false, error: data.substring(0, 200) });
        }
      });
    });
    hbReq.on('error', (err) => resolve({ success: false, error: err.message }));
    hbReq.on('timeout', () => { hbReq.destroy(); resolve({ success: false, error: 'Timeout' }); });
  });
}

/**
 * /dlhd-whitelist — Trigger reCAPTCHA v3 whitelist refresh via rust-fetch.
 * 
 * March 2026: DLHD key servers require IP whitelisting via reCAPTCHA v3.
 * This endpoint runs rust-fetch --mode dlhd-whitelist via ProxyJet residential SOCKS5
 * to solve reCAPTCHA and POST to ai.the-sunmoon.site/verify.
 *
 * The whitelist lasts ~20 minutes. The CF worker should call this before key fetches.
 */
export async function handleDLHDWhitelist(req: RPIRequest, res: ServerResponse): Promise<void> {
  const channel = req.url.searchParams.get('channel') ?? 'premium44';
  console.log(`[DLHD-Whitelist] Refreshing whitelist for ${channel}...`);

  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);

  // Build args — route through SOCKS5 proxy with sticky session
  const baseProxyUrl = process.env.PROXY_SOCKS5_URL || '';
  // Use caller-provided session or create new one for standalone whitelist
  const sessionId = req.url.searchParams.get('session') || `w${Date.now().toString(36)}`;
  const proxyUrl = baseProxyUrl ? injectStickySession(baseProxyUrl, sessionId) : '';
  const args = ['--mode', 'dlhd-whitelist', '--url', channel, '--timeout', '20'];
  if (proxyUrl) {
    args.push('--proxy', proxyUrl);
    console.log(`[DLHD-Whitelist] routing through proxy: ${proxyUrl.substring(0, 40)}...`);
  }

  try {
    const { stdout, stderr } = await execFileAsync('rust-fetch', args, { timeout: 25000, windowsHide: true });

    console.log(`[DLHD-Whitelist] stderr: ${stderr.substring(0, 200)}`);

    let result: Record<string, unknown>;
    try {
      result = JSON.parse(stdout.trim());
    } catch {
      result = { raw: stdout.trim().substring(0, 500) };
    }

    const success = result.success === true;
    console.log(`[DLHD-Whitelist] ${success ? '✅' : '❌'} result:`, JSON.stringify(result));

    sendJson(res, success ? 200 : 502, {
      ...result,
      channel,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[DLHD-Whitelist] Error: ${message}`);
    sendJsonError(res, 502, {
      error: 'Whitelist refresh failed',
      details: message,
      channel,
      timestamp: Date.now(),
    });
  }
}

// ─── Session cache: reuse whitelisted ProxyJet sessions (20 min TTL) ────
let _cachedSession: { sessionId: string; proxyUrl: string; whitelistedAt: number } | null = null;
const SESSION_TTL_MS = 18 * 60 * 1000; // 18 min (whitelist lasts ~20-30 min)

function getCachedSession() {
  if (_cachedSession && Date.now() - _cachedSession.whitelistedAt < SESSION_TTL_MS) return _cachedSession;
  _cachedSession = null;
  return null;
}
function cacheSession(sessionId: string, proxyUrl: string) {
  _cachedSession = { sessionId, proxyUrl, whitelistedAt: Date.now() };
}
function clearCachedSession() { _cachedSession = null; }

/**
 * /dlhd-key-v6 — ProxyJet sticky session key fetching via rust-fetch.
 *
 * REFACTORED Mar 27 2026: Caches whitelisted sessions for fast reuse (~1s).
 * Only re-whitelists when the cached session returns fake keys.
 *
 *   1. Creates a fresh ProxyJet sticky session (unique residential IP)
 *   2. Whitelists that IP via reCAPTCHA v3 HTTP bypass + POST /verify
 *   3. Fetches the key through the SAME sticky IP (now whitelisted)
 *   4. Returns the valid 16-byte key
 *
 * The sticky session is ephemeral — one session per key request, no reuse.
 * This avoids the 4-channel concurrent limit and ensures a clean IP every time.
 */
export async function handleDLHDKeyV6(req: RPIRequest, res: ServerResponse): Promise<void> {
  const startTime = Date.now();
  const targetUrl = req.url.searchParams.get('url');

  if (!targetUrl) {
    sendJsonError(res, 400, {
      error: 'Missing url parameter',
      details: '/dlhd-key-v6?url=<key_url>',
      timestamp: Date.now(),
    });
    return;
  }

  const decoded = decodeURIComponent(targetUrl);
  if (!isAllowedProxyDomain(decoded)) {
    sendJsonError(res, 403, { error: 'Domain not allowed', timestamp: Date.now() });
    return;
  }

  // Extract key path for trying multiple servers
  const keyPathMatch = decoded.match(/(\/key\/[^?]+)/);
  const keyPath = keyPathMatch ? keyPathMatch[1] : new URL(decoded).pathname;
  const channelMatch = keyPath.match(/\/(premium\d+)\//);
  const channel = channelMatch ? channelMatch[1] : 'premium44';

  // Key servers — UPDATED Apr 10 2026: sec.ai-hls.site is DEAD (403). All chevy.{domain} now.
  const keyServers = [
    ...new Set([
      decoded,
      `https://chevy.embedkclx.sbs${keyPath}`,
      `https://chevy.enviromentalanimal.horse${keyPath}`,
      `https://chevy.soyspace.cyou${keyPath}`,
      `https://chevy.vovlacosa.sbs${keyPath}`,
    ])
  ];

  const { spawn } = await import('child_process');
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);

  const baseProxyUrl = process.env.PROXY_SOCKS5_URL || '';
  if (!baseProxyUrl) {
    sendJsonError(res, 502, { error: 'PROXY_SOCKS5_URL not configured', timestamp: Date.now() });
    return;
  }

  // ─── CACHED SESSION: reuse a previously whitelisted ProxyJet session ───
  // Fast path (~1s) — skip reCAPTCHA + verify entirely.
  // Only create new session if cached one returns a fake key.
  let proxyUrl: string;
  let sessionId: string;
  const cached = getCachedSession();
  if (cached) {
    proxyUrl = cached.proxyUrl;
    sessionId = cached.sessionId;
    console.log(`[DLHD-Key-V6] ── FAST PATH ── reusing session ${sessionId} (${Math.round((Date.now() - cached.whitelistedAt) / 1000)}s old)`);
  } else {
    sessionId = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    proxyUrl = injectStickySession(baseProxyUrl, sessionId);
    console.log(`[DLHD-Key-V6] ── NEW SESSION ── ${sessionId}`);
  }

  // Helper: fetch binary data via rust-fetch through sticky proxy
  function fetchBin(url: string, timeoutSec = 5): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const args = [
        '--url', url, '--timeout', String(timeoutSec), '--mode', 'fetch-bin',
        '--headers', JSON.stringify({
          'Referer': 'https://www.ksohls.ru/',
          'Origin': 'https://www.ksohls.ru',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
        }),
        '--proxy', proxyUrl,
      ];
      const proc = spawn('rust-fetch', args);
      const chunks: Buffer[] = [];
      proc.stdout.on('data', (c: Buffer) => chunks.push(c));
      proc.on('error', reject);
      proc.on('close', (code: number) =>
        code !== 0 ? reject(new Error(`rust-fetch exit ${code}`)) : resolve(Buffer.concat(chunks)));
    });
  }

  let validKey: Buffer | null = null;
  const keyHost = (() => { try { return new URL(decoded).origin; } catch { return 'https://chevy.embedkclx.sbs'; } })();

  // ─── FAST PATH: fetch key with cached session (~1s) ────────────────
  if (cached) {
    try {
      const buf = await fetchBin(decoded, 5);
      if (buf.length === 16) {
        validKey = buf;
        console.log(`[DLHD-Key-V6] ✅ FAST: ${buf.toString('hex').substring(0, 8)}... [${Date.now() - startTime}ms]`);
      }
    } catch (e: unknown) {
      console.log(`[DLHD-Key-V6] Fast path error: ${e instanceof Error ? e.message : String(e)}`);
      clearCachedSession();
    }
  }

  // ─── SLOW PATH: whitelist + fetch ─────────────────────────────────
  if (!validKey) {
    // Create fresh session
    sessionId = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    proxyUrl = injectStickySession(baseProxyUrl, sessionId);

    try {
      const wlStart = Date.now();
      const siteKey = '6LfJv4AsAAAAALTLEHKaQ7LN_VYfFqhLPrB2Tvgj';
      const pageUrl = `https://www.ksohls.ru/premiumtv/daddyhd.php?id=${channel.replace('premium', '')}`;
      const action = `verify_${channel}`;

      // Solve reCAPTCHA (no proxy needed)
      const { stdout: recapOut } = await execFileAsync('rust-fetch',
        ['--mode', 'recaptcha-v3', '--site-key', siteKey, '--action', action, '--url', pageUrl, '--timeout', '8'],
        { timeout: 10000, windowsHide: true });
      const recapToken = recapOut.trim();

      if (recapToken && recapToken.length > 20) {
        console.log(`[DLHD-Key-V6] reCAPTCHA: ${recapToken.length}b [${Date.now() - wlStart}ms]`);

        // POST verify through SOCKS5 (SAME host as key)
        const verifyUrl = `${keyHost}/verify`;
        const verifyBody = JSON.stringify({ 'recaptcha-token': recapToken, 'channel_id': channel });
        const { stdout: verifyOut } = await execFileAsync('curl', [
          '-s', '--max-time', '6',
          '--socks5-hostname', proxyUrl.replace('socks5://', ''),
          '-X', 'POST',
          '-H', 'Content-Type: application/json',
          '-H', 'Origin: https://www.ksohls.ru',
          '-H', 'Referer: https://www.ksohls.ru/',
          '-d', verifyBody, verifyUrl,
        ], { timeout: 10000, windowsHide: true });

        const vResult = verifyOut.trim();
        console.log(`[DLHD-Key-V6] Verify: ${vResult.substring(0, 80)} [${Date.now() - wlStart}ms]`);

        // 500ms delay for whitelist propagation
        await new Promise(r => setTimeout(r, 500));

        // Fetch key — trust it if verify succeeded
        const buf = await fetchBin(decoded, 5);
        if (buf.length === 16) {
          validKey = buf;
          cacheSession(sessionId, proxyUrl);
          console.log(`[DLHD-Key-V6] ✅ key: ${buf.toString('hex').substring(0, 8)}... [${Date.now() - startTime}ms]`);
        }
      }
    } catch (e: unknown) {
      console.log(`[DLHD-Key-V6] Whitelist error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ─── Step 4: Return key (session is ephemeral, no cleanup needed) ──
  const totalMs = Date.now() - startTime;
  console.log(`[DLHD-Key-V6] ── END ── ${validKey ? '✅' : '❌'} [${totalMs}ms] session=${sessionId}`);

  if (validKey) {
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': validKey.length,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Cache-Control': 'no-store',
      'X-Fetched-By': 'rpi-v6-sticky',
      'X-Session-Id': sessionId,
      'X-Total-Ms': String(totalMs),
    });
    res.end(validKey);
  } else {
    sendJsonError(res, 502, {
      error: 'Key fetch failed — all servers returned fake keys after whitelist',
      hint: 'ProxyJet session may have failed to whitelist',
      session: sessionId,
      totalMs,
      timestamp: Date.now(),
    });
  }
}

// =============================================================================
// RESTREAM — Clean M3U8 for VRChat / external players
// =============================================================================

const RESTREAM_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const LOOKUP_DOMAINS = ['embedkclx.sbs', 'enviromentalanimal.horse', 'vovlacosa.sbs', 'soyspace.cyou'];
const CDN_DOMAIN = 'embedkclx.sbs';
const NEW_M3U8_SERVER = 'chevy.embedkclx.sbs';

/** Fetch a URL via https and return the body as a string */
function httpGet(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    https.get({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: { 'User-Agent': RESTREAM_UA, ...headers },
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
    }).on('error', reject);
  });
}

/** Fetch server key for a channel from lookup endpoints */
async function fetchServerKey(channelKey: string): Promise<string | null> {
  // Try new primary M3U8 server first (March 24, 2026)
  try {
    const { status, body } = await httpGet(
      `https://${NEW_M3U8_SERVER}/server_lookup?channel_id=${channelKey}`,
      { Origin: 'https://www.ksohls.ru', Referer: 'https://www.ksohls.ru/' }
    );
    if (status === 200 && body.startsWith('{')) {
      const data = JSON.parse(body);
      if (data.server_key) return data.server_key;
    }
  } catch { /* try fallbacks */ }

  for (const domain of LOOKUP_DOMAINS) {
    try {
      const { status, body } = await httpGet(
        `https://chevy.${domain}/server_lookup?channel_id=${channelKey}`,
        { Origin: 'https://www.ksohls.ru', Referer: 'https://www.ksohls.ru/' }
      );
      if (status === 200 && body.startsWith('{')) {
        const data = JSON.parse(body);
        if (data.server_key) return data.server_key;
      }
    } catch { /* try next */ }
  }
  return null;
}

/**
 * /dlhd/restream — Returns a rewritten M3U8 for VRChat / external players.
 *
 * All key and segment URLs point back to this RPI proxy so the residential IP
 * handles DLHD's whitelist requirements. VRChat clients just consume the stream.
 *
 * Usage: GET /dlhd/restream?channel=303&key=<api_key>
 */
export async function handleDLHDRestream(req: RPIRequest, res: ServerResponse): Promise<void> {
  const channel = req.url.searchParams.get('channel');
  if (!channel || !/^\d{1,10}$/.test(channel)) {
    sendJsonError(res, 400, { error: 'Missing or invalid channel parameter', timestamp: Date.now() });
    return;
  }

  const apiKey = req.url.searchParams.get('key') ?? '';
  console.log(`[DLHD-Restream] Channel ${channel} requested`);

  // Step 1: Fetch auth token (enviromentalspace.sbs → ksohls.ru fallback)
  const auth = await fetchAuthToken(channel);
  if (!auth) {
    sendJsonError(res, 502, { error: 'Failed to fetch auth token', timestamp: Date.now() });
    return;
  }

  // Decode JWT to get channelKey
  let channelKey = `premium${channel}`;
  try {
    const payload = JSON.parse(Buffer.from(auth.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    if (payload.sub) channelKey = payload.sub;
  } catch { /* use default */ }

  console.log(`[DLHD-Restream] Auth OK, channelKey=${channelKey}`);

  // Step 2: Fetch server key
  const serverKey = await fetchServerKey(channelKey);
  if (!serverKey) {
    sendJsonError(res, 502, { error: 'Failed to fetch server key', timestamp: Date.now() });
    return;
  }

  console.log(`[DLHD-Restream] Server key: ${serverKey}`);

  // Step 3: Fetch M3U8 from DLHD CDN (RPI residential IP)
  // Try new primary M3U8 server first, fall back to chevy.soyspace.cyou
  const m3u8Url = `https://${NEW_M3U8_SERVER}/proxy/${serverKey}/${channelKey}/mono.css`;
  let m3u8Content: string;
  try {
    let { status, body } = await httpGet(m3u8Url, {
      Origin: 'https://www.ksohls.ru',
      Referer: 'https://www.ksohls.ru/',
    });
    // Fallback to chevy.soyspace.cyou if primary fails
    if (status !== 200 || !body.includes('#EXTM3U')) {
      const fallbackUrl = `https://chevy.${CDN_DOMAIN}/proxy/${serverKey}/${channelKey}/mono.css`;
      const fallback = await httpGet(fallbackUrl, {
        Origin: 'https://www.ksohls.ru',
        Referer: 'https://www.ksohls.ru/',
      });
      status = fallback.status;
      body = fallback.body;
    }
    if (status !== 200 || !body.includes('#EXTM3U')) {
      sendJsonError(res, 502, {
        error: 'M3U8 fetch failed',
        status,
        preview: body.substring(0, 200),
        timestamp: Date.now(),
      });
      return;
    }
    m3u8Content = body;
  } catch (e: unknown) {
    sendJsonError(res, 502, { error: 'M3U8 fetch error', details: (e as Error).message, timestamp: Date.now() });
    return;
  }

  console.log(`[DLHD-Restream] M3U8 fetched (${m3u8Content.length} bytes)`);

  // Step 4: Build the base URL for this RPI proxy (so VRChat can reach us)
  const host = req.raw.headers['host'] ?? 'localhost:3001';
  const proto = req.raw.headers['x-forwarded-proto'] ?? 'http';
  const rpiBase = `${proto}://${host}`;

  // Step 5: Rewrite M3U8
  // - Key URIs → /dlhd-key-v6?url=<absolute_key_url>&key=<api_key>
  // - Segment URLs → /proxy?url=<absolute_segment_url>&key=<api_key>
  let rewritten = m3u8Content;

  // Rewrite key URIs
  rewritten = rewritten.replace(/URI="([^"]+)"/g, (_, keyUrl) => {
    let absoluteKey = keyUrl;
    if (!absoluteKey.startsWith('http')) {
      const base = new URL(m3u8Url);
      absoluteKey = new URL(keyUrl, base.origin + base.pathname.replace(/\/[^/]*$/, '/')).toString();
    }
    return `URI="${rpiBase}/dlhd-key-v6?url=${encodeURIComponent(absoluteKey)}&key=${apiKey}"`;
  });

  // Remove ENDLIST for live streams
  rewritten = rewritten.replace(/\n?#EXT-X-ENDLIST\s*$/m, '');

  // Join split URLs (DLHD sometimes splits long URLs across lines)
  const lines = rewritten.split('\n');
  const joined: string[] = [];
  let cur = '';
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) {
      if (cur) { joined.push(cur); cur = ''; }
      joined.push(line);
    } else if (t.startsWith('http://') || t.startsWith('https://')) {
      if (cur) joined.push(cur);
      cur = t;
    } else {
      cur += t;
    }
  }
  if (cur) joined.push(cur);

  // Rewrite segment URLs
  const output = joined.map((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return line;
    // Already rewritten
    if (t.includes('/proxy?url=') || t.includes('/dlhd-key-v6?')) return line;
    // Absolute DLHD segment URL
    if ((t.startsWith('http://') || t.startsWith('https://')) && !t.includes('mono.css')) {
      return `${rpiBase}/proxy?url=${encodeURIComponent(t)}&key=${apiKey}`;
    }
    // Relative segment URL — make absolute then proxy
    if (!t.startsWith('http')) {
      try {
        const base = new URL(m3u8Url);
        const abs = new URL(t, base.origin + base.pathname.replace(/\/[^/]*$/, '/')).toString();
        return `${rpiBase}/proxy?url=${encodeURIComponent(abs)}&key=${apiKey}`;
      } catch { return line; }
    }
    return line;
  });

  const finalM3U8 = output.join('\n');
  console.log(`[DLHD-Restream] Serving rewritten M3U8 (${finalM3U8.length} bytes)`);

  res.writeHead(200, {
    'Content-Type': 'application/vnd.apple.mpegurl',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  });
  res.end(finalM3U8);
}
