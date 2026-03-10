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
  return new Promise((resolve) => {
    const url = `https://www.ksohls.ru/premiumtv/daddyhd.php?id=${channel}`;
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: 'https://daddyhd.com/',
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
 * This endpoint runs rust-fetch --mode dlhd-whitelist from the RPI's residential IP
 * to solve reCAPTCHA and POST to chevy.soyspace.cyou/verify.
 * 
 * The whitelist lasts ~30 minutes. The CF worker should call this before key fetches.
 */
export async function handleDLHDWhitelist(req: RPIRequest, res: ServerResponse): Promise<void> {
  const channel = req.url.searchParams.get('channel') ?? 'premium44';
  console.log(`[DLHD-Whitelist] Refreshing whitelist for ${channel}...`);

  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);

  try {
    const { stdout, stderr } = await execFileAsync('rust-fetch', [
      '--mode', 'dlhd-whitelist',
      '--url', channel,
      '--timeout', '20',
    ], { timeout: 25000, windowsHide: true });

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

/**
 * /dlhd-key-v6 — Server-side key fetching via rust-fetch (residential IP + Chrome TLS).
 * 
 * March 2026: DLHD uses reCAPTCHA v3 IP whitelist. Without whitelist, key servers
 * return fake 16-byte keys. This endpoint:
 * 1. Triggers reCAPTCHA whitelist refresh via rust-fetch (if needed)
 * 2. Fetches the key from multiple servers
 * 3. Returns the first valid (non-fake) 16-byte key
 */
export async function handleDLHDKeyV6(req: RPIRequest, res: ServerResponse): Promise<void> {
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

  console.log(`[DLHD-Key-V6] Fetching key: ${decoded.substring(0, 80)}...`);

  // Extract key path for trying multiple servers
  const keyPathMatch = decoded.match(/(\/key\/[^?]+)/);
  const keyPath = keyPathMatch ? keyPathMatch[1] : new URL(decoded).pathname;

  // UPDATED Mar 10 2026: Removed go.ai-chatx.site — SSL cert broken (ERR_TLS_CERT_ALTNAME_INVALID)
  const keyServers = [
    decoded,
    `https://chevy.vmvmv.shop${keyPath}`,
    `https://chevy.vovlacosa.sbs${keyPath}`,
    `https://chevy.soyspace.cyou${keyPath}`,
  ];
  const uniqueServers = [...new Set(keyServers)];

  // Known fake keys that key servers return to non-whitelisted IPs
  const FAKE_KEYS = new Set([
    '45db13cfa0ed393fdb7da4dfe9b5ac81',
    '455806f8bc592fdacb6ed5e071a517b1',
    '4542956ed8680eaccb615f7faad4da8f',
  ]);

  const { spawn } = await import('child_process');
  let validKey: Buffer | null = null;
  let gotFakeKey = false;

  for (const keyUrl of uniqueServers) {
    try {
      console.log(`[DLHD-Key-V6] Trying: ${keyUrl.substring(0, 80)}`);

      const keyBuf = await new Promise<Buffer>((resolve, reject) => {
        const args = [
          '--url', keyUrl,
          '--timeout', '10',
          '--mode', 'fetch-bin',
          '--headers', JSON.stringify({
            Referer: 'https://www.ksohls.ru/',
            Origin: 'https://www.ksohls.ru',
          }),
        ];

        const proc = spawn('rust-fetch', args);
        const chunks: Buffer[] = [];
        let stderr = '';

        proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
        proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
        proc.on('error', (err: Error) => reject(err));
        proc.on('close', (code: number) => {
          if (code !== 0) {
            reject(new Error(`rust-fetch exit ${code}: ${stderr}`));
            return;
          }
          resolve(Buffer.concat(chunks));
        });
      });

      if (keyBuf.length !== 16) {
        console.log(`[DLHD-Key-V6] ❌ Not 16 bytes (${keyBuf.length})`);
        continue;
      }

      const keyHex = keyBuf.toString('hex');
      console.log(`[DLHD-Key-V6] Got 16-byte key: ${keyHex}`);

      if (FAKE_KEYS.has(keyHex)) {
        console.log(`[DLHD-Key-V6] ❌ Known fake key, skipping`);
        gotFakeKey = true;
        continue;
      }

      validKey = keyBuf;
      console.log(`[DLHD-Key-V6] ✅ Key accepted: ${keyHex}`);
      break;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`[DLHD-Key-V6] Error: ${msg}`);
      continue;
    }
  }

  // If all keys were fake, trigger whitelist refresh and retry once
  if (!validKey && gotFakeKey) {
    console.log(`[DLHD-Key-V6] All keys fake — triggering whitelist refresh...`);
    try {
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const execFileAsync = promisify(execFile);
      
      // Extract channel from key path (e.g., /key/premium44/123 → premium44)
      const channelMatch = keyPath.match(/\/(premium\d+)\//);
      const channel = channelMatch ? channelMatch[1] : 'premium44';
      
      const { stdout } = await execFileAsync('rust-fetch', [
        '--mode', 'dlhd-whitelist',
        '--url', channel,
        '--timeout', '20',
      ], { timeout: 25000, windowsHide: true });
      
      console.log(`[DLHD-Key-V6] Whitelist result: ${stdout.trim().substring(0, 200)}`);
      
      // Retry key fetch after whitelist
      const retryUrl = uniqueServers[0];
      console.log(`[DLHD-Key-V6] Retrying key after whitelist: ${retryUrl.substring(0, 80)}`);
      
      const retryBuf = await new Promise<Buffer>((resolve, reject) => {
        const proc = spawn('rust-fetch', [
          '--url', retryUrl,
          '--timeout', '10',
          '--mode', 'fetch-bin',
          '--headers', JSON.stringify({
            Referer: 'https://www.ksohls.ru/',
            Origin: 'https://www.ksohls.ru',
          }),
        ]);
        const chunks: Buffer[] = [];
        proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
        proc.on('error', reject);
        proc.on('close', () => resolve(Buffer.concat(chunks)));
      });
      
      if (retryBuf.length === 16) {
        const retryHex = retryBuf.toString('hex');
        if (!FAKE_KEYS.has(retryHex)) {
          validKey = retryBuf;
          console.log(`[DLHD-Key-V6] ✅ Key after whitelist: ${retryHex}`);
        }
      }
    } catch (e: unknown) {
      console.log(`[DLHD-Key-V6] Whitelist refresh failed: ${e instanceof Error ? e.message : String(e)}`);
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
    });
    res.end(validKey);
  } else {
    sendJsonError(res, 502, {
      error: 'All key servers returned fake keys — RPI IP may not be whitelisted',
      hint: 'reCAPTCHA v3 whitelist required',
      timestamp: Date.now(),
    });
  }
}
