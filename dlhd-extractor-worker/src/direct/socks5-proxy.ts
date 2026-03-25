/**
 * SOCKS5 Proxy Client for Cloudflare Workers
 * 
 * Uses CF Workers' connect() TCP socket API to tunnel HTTPS requests
 * through free SOCKS5 proxies. This bypasses dvalna.ru's datacenter IP detection.
 * 
 * Flow: CF Worker → SOCKS5 proxy → TLS → dvalna.ru (key server)
 * 
 * IMPORTANT: CF Workers startTls() uses the connect() hostname for SNI.
 * Since we connect to the SOCKS5 proxy, SNI will be the proxy's IP.
 * dvalna.ru is behind Cloudflare which terminates TLS — it may still work
 * because CF routes based on the Host header, not SNI.
 * If SNI mismatch causes issues, we fall back to sending the Host header
 * and hoping CF's TLS termination is lenient.
 * 
 * Proxy list sourced from:
 * - github.com/proxifly/free-proxy-list
 * - github.com/TheSpeedX/PROXY-List
 * - github.com/officialputuid/KangProxy
 */

import { connect } from 'cloudflare:sockets';

// Verified working SOCKS5 proxies (tested Feb 7 2026)
// All returned REAL keys from chevy.dvalna.ru with V5 auth
const SOCKS5_PROXY_LIST = [
  { host: '192.111.129.145', port: 16894 },
  { host: '184.178.172.5', port: 15303 },
  { host: '98.181.137.80', port: 4145 },
  { host: '192.252.210.233', port: 4145 },
  { host: '68.71.245.206', port: 4145 },
  { host: '142.54.228.193', port: 4145 },
  { host: '199.58.184.97', port: 4145 },
  { host: '192.252.214.20', port: 15864 },
  { host: '184.178.172.25', port: 15291 },
  { host: '70.166.167.38', port: 57728 },
  { host: '198.177.252.24', port: 4145 },
  { host: '174.77.111.196', port: 4145 },
  { host: '184.181.217.213', port: 4145 },
  { host: '192.252.208.67', port: 14287 },
  { host: '184.170.251.30', port: 11288 },
  { host: '174.75.211.193', port: 4145 },
  { host: '199.187.210.54', port: 4145 },
  { host: '192.111.134.10', port: 4145 },
  { host: '24.249.199.12', port: 4145 },
  { host: '69.61.200.104', port: 36181 },
];

// Track which proxies are working/dead for rotation
const proxyHealth = new Map<string, { failures: number; lastFail: number; lastSuccess: number }>();
let proxyIndex = 0;

/**
 * Get the next healthy proxy in rotation
 */
function getNextProxy(): { host: string; port: number } {
  const now = Date.now();
  const maxAttempts = SOCKS5_PROXY_LIST.length;
  
  for (let i = 0; i < maxAttempts; i++) {
    const proxy = SOCKS5_PROXY_LIST[proxyIndex % SOCKS5_PROXY_LIST.length];
    proxyIndex++;
    
    const key = `${proxy.host}:${proxy.port}`;
    const health = proxyHealth.get(key);
    
    // Skip proxies that failed recently (backoff: 60s after 3+ failures)
    if (health && health.failures >= 3 && (now - health.lastFail) < 60000) {
      continue;
    }
    
    return proxy;
  }
  
  // All proxies are in backoff — just pick the next one anyway
  const proxy = SOCKS5_PROXY_LIST[proxyIndex % SOCKS5_PROXY_LIST.length];
  proxyIndex++;
  return proxy;
}

function markProxySuccess(host: string, port: number): void {
  const key = `${host}:${port}`;
  proxyHealth.set(key, { failures: 0, lastFail: 0, lastSuccess: Date.now() });
}

function markProxyFailure(host: string, port: number): void {
  const key = `${host}:${port}`;
  const existing = proxyHealth.get(key) || { failures: 0, lastFail: 0, lastSuccess: 0 };
  proxyHealth.set(key, { ...existing, failures: existing.failures + 1, lastFail: Date.now() });
}

/**
 * Perform SOCKS5 handshake over a TCP socket.
 * Supports both no-auth (method 0x00) and username/password auth (method 0x02, RFC 1929).
 * Returns the connected socket ready for TLS upgrade.
 */
async function socks5Handshake(
  socket: { readable: ReadableStream; writable: WritableStream },
  targetHost: string,
  targetPort: number,
  auth?: { username: string; password: string },
): Promise<void> {
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();

  // Step 1: Send greeting
  if (auth) {
    // Offer username/password auth (method 0x02)
    await writer.write(new Uint8Array([0x05, 0x01, 0x02]));
  } else {
    // Offer no-auth (method 0x00)
    await writer.write(new Uint8Array([0x05, 0x01, 0x00]));
  }

  // Read greeting response
  const greetResult = await reader.read();
  if (greetResult.done || !greetResult.value) throw new Error('SOCKS5: connection closed during greeting');
  const greetResp = new Uint8Array(greetResult.value);

  if (auth) {
    // Expect method 0x02 (username/password)
    if (greetResp[0] !== 0x05 || greetResp[1] !== 0x02) {
      throw new Error(`SOCKS5: server rejected auth method (${greetResp[0]}/${greetResp[1]})`);
    }

    // RFC 1929: username/password sub-negotiation
    const userBytes = new TextEncoder().encode(auth.username);
    const passBytes = new TextEncoder().encode(auth.password);
    const authReq = new Uint8Array(3 + userBytes.length + passBytes.length);
    authReq[0] = 0x01; // version
    authReq[1] = userBytes.length;
    authReq.set(userBytes, 2);
    authReq[2 + userBytes.length] = passBytes.length;
    authReq.set(passBytes, 3 + userBytes.length);
    await writer.write(authReq);

    // Read auth response
    const authResult = await reader.read();
    if (authResult.done || !authResult.value) throw new Error('SOCKS5: connection closed during auth');
    const authResp = new Uint8Array(authResult.value);
    if (authResp[0] !== 0x01 || authResp[1] !== 0x00) {
      throw new Error(`SOCKS5: auth failed (${authResp[0]}/${authResp[1]})`);
    }
  } else {
    // Expect method 0x00 (no-auth)
    if (greetResp[0] !== 0x05 || greetResp[1] !== 0x00) {
      throw new Error(`SOCKS5: auth rejected (${greetResp[0]}/${greetResp[1]})`);
    }
  }

  // Step 2: Send CONNECT request
  // version=5, cmd=connect(1), rsv=0, atyp=domain(3), len, host, port
  const hostBytes = new TextEncoder().encode(targetHost);
  const portBytes = new Uint8Array(2);
  new DataView(portBytes.buffer).setUint16(0, targetPort, false); // big-endian

  const connectReq = new Uint8Array(5 + hostBytes.length + 2);
  connectReq[0] = 0x05; // version
  connectReq[1] = 0x01; // CONNECT
  connectReq[2] = 0x00; // reserved
  connectReq[3] = 0x03; // domain name
  connectReq[4] = hostBytes.length;
  connectReq.set(hostBytes, 5);
  connectReq.set(portBytes, 5 + hostBytes.length);

  await writer.write(connectReq);

  // Read CONNECT response
  const connResult = await reader.read();
  if (connResult.done || !connResult.value) throw new Error('SOCKS5: connection closed during connect');
  const connResp = new Uint8Array(connResult.value);
  if (connResp[0] !== 0x05 || connResp[1] !== 0x00) {
    const errorCodes: Record<number, string> = {
      1: 'general failure', 2: 'not allowed', 3: 'network unreachable',
      4: 'host unreachable', 5: 'connection refused', 6: 'TTL expired',
      7: 'command not supported', 8: 'address type not supported',
    };
    throw new Error(`SOCKS5: connect failed (${errorCodes[connResp[1]] || connResp[1]})`);
  }

  // Release the locks so the socket can be used for TLS
  writer.releaseLock();
  reader.releaseLock();
}

/**
 * Build an HTTP request string
 */
function buildHttpRequest(path: string, host: string, headers: Record<string, string>): string {
  let req = `GET ${path} HTTP/1.1\r\n`;
  req += `Host: ${host}\r\n`;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== 'host') {
      req += `${key}: ${value}\r\n`;
    }
  }
  req += `Connection: close\r\n\r\n`;
  return req;
}

/**
 * Parse raw HTTP response bytes into status + body
 */
function parseHttpResponse(data: Uint8Array): { status: number; body: Uint8Array } {
  // Find \r\n\r\n boundary
  for (let i = 0; i < data.length - 3; i++) {
    if (data[i] === 0x0d && data[i+1] === 0x0a && data[i+2] === 0x0d && data[i+3] === 0x0a) {
      const headerStr = new TextDecoder().decode(data.slice(0, i));
      const statusMatch = headerStr.match(/HTTP\/[\d.]+ (\d+)/);
      const status = statusMatch ? parseInt(statusMatch[1]) : 0;
      const body = data.slice(i + 4);
      return { status, body };
    }
  }
  return { status: 0, body: data };
}

/**
 * Fetch a URL through a SOCKS5 proxy using CF Workers TCP sockets
 * Handles: SOCKS5 handshake → TLS upgrade → HTTP request → response parsing
 * 
 * NOTE on TLS/SNI: We connect() to the SOCKS5 proxy IP, so startTls() will
 * use the proxy IP for SNI. However, the TLS handshake actually goes through
 * the SOCKS5 tunnel to the target server (Cloudflare). CF terminates TLS and
 * routes based on the Host header, so SNI mismatch should be OK.
 */
export async function fetchViaSocks5(
  targetUrl: string,
  headers: Record<string, string>,
  proxyOverride?: { host: string; port: number },
): Promise<{ status: number; body: Uint8Array; proxy: string }> {
  const proxy = proxyOverride || getNextProxy();
  const proxyStr = `${proxy.host}:${proxy.port}`;
  const url = new URL(targetUrl);

  console.log(`[SOCKS5] Connecting via ${proxyStr} → ${url.hostname}`);

  try {
    // Step 1: Open TCP connection to SOCKS5 proxy with starttls mode
    // secureTransport: "starttls" allows us to upgrade to TLS after SOCKS5 handshake
    const socket = connect(
      { hostname: proxy.host, port: proxy.port },
      { secureTransport: 'starttls', allowHalfOpen: false } as any,
    );

    // Step 2: SOCKS5 handshake (negotiate + CONNECT to target on port 443)
    await socks5Handshake(socket, url.hostname, 443);

    // Step 3: Upgrade to TLS through the SOCKS5 tunnel
    // The TLS handshake goes through the tunnel to the actual target server
    const tlsSocket = (socket as any).startTls();

    // Step 4: Send HTTP request over TLS
    const writer = tlsSocket.writable.getWriter();
    const httpReq = buildHttpRequest(url.pathname + url.search, url.hostname, headers);
    await writer.write(new TextEncoder().encode(httpReq));
    await writer.close();

    // Step 5: Read full response
    const reader = tlsSocket.readable.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(new Uint8Array(value));
    }

    // Combine chunks
    const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
    const fullResponse = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of chunks) {
      fullResponse.set(chunk, offset);
      offset += chunk.length;
    }

    // Step 6: Parse HTTP response
    const { status, body } = parseHttpResponse(fullResponse);

    markProxySuccess(proxy.host, proxy.port);
    console.log(`[SOCKS5] ✅ ${url.hostname} → ${status} (${body.length}b) via ${proxyStr}`);
    return { status, body, proxy: proxyStr };

  } catch (e) {
    markProxyFailure(proxy.host, proxy.port);
    console.log(`[SOCKS5] ❌ ${proxyStr} failed: ${e}`);
    throw e;
  }
}

/**
 * Fetch a key URL through SOCKS5 proxy with automatic retry on different proxies
 * Tries up to maxRetries different proxies before giving up
 */
export async function fetchKeyViaSocks5(
  keyUrl: string,
  headers: Record<string, string>,
  maxRetries: number = 3,
): Promise<{ status: number; body: Uint8Array; proxy: string } | null> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await fetchViaSocks5(keyUrl, headers);
      
      // Check if we got a valid 16-byte key
      if (result.status === 200 && result.body.length === 16) {
        const hex = Array.from(result.body).map(b => b.toString(16).padStart(2, '0')).join('');
        
        // Check for fake/decoy keys (updated Mar 25 2026)
        if (hex.startsWith('455806f8') || hex === '45c6497365ca4c64c83460adca4e65ee' || hex === '45a542173e0b81d2a9c13cbc2bdcfd8c') {
          console.log(`[SOCKS5] ⚠️ Fake key from ${result.proxy}, trying next proxy...`);
          continue;
        }
        if (hex.startsWith('6572726f72')) {
          console.log(`[SOCKS5] 🚫 Rate limited via ${result.proxy}, trying next proxy...`);
          continue;
        }
        
        console.log(`[SOCKS5] ✅ Real key: ${hex} via ${result.proxy}`);
        return result;
      }
      
      // Non-200 or wrong size — try next proxy
      console.log(`[SOCKS5] Attempt ${attempt + 1}: status=${result.status} body=${result.body.length}b via ${result.proxy}`);
    } catch (e) {
      console.log(`[SOCKS5] Attempt ${attempt + 1} failed: ${e}`);
    }
  }
  
  return null;
}

/**
 * Get proxy health stats (for debug endpoint)
 */
export function getProxyStats(): Record<string, unknown> {
  const stats: Record<string, unknown>[] = [];
  for (const proxy of SOCKS5_PROXY_LIST) {
    const key = `${proxy.host}:${proxy.port}`;
    const health = proxyHealth.get(key);
    stats.push({
      proxy: key,
      failures: health?.failures || 0,
      lastFail: health?.lastFail ? new Date(health.lastFail).toISOString() : null,
      lastSuccess: health?.lastSuccess ? new Date(health.lastSuccess).toISOString() : null,
    });
  }
  return { proxies: stats, currentIndex: proxyIndex, total: SOCKS5_PROXY_LIST.length };
}

// =============================================================================
// Residential Proxy Support (authenticated SOCKS5 with sticky sessions)
// =============================================================================

/**
 * Config for a paid residential SOCKS5 proxy (IPRoyal, PacketStream, etc.)
 */
export interface ResidentialProxyConfig {
  host: string;
  port: number;
  username: string;
  password: string;
}

/**
 * Generate a sticky session username.
 * Appends a session ID to the base username so the proxy provider
 * reuses the same residential IP for the session duration.
 *
 * ProxyJet format: USERNAME-resi-US-ip-{SessionID}
 *   e.g., ACCTID-resi-US-ip-s1a2b3c4d5
 *
 * The base username should already include the resi and country parts
 *   e.g., "ACCTID-resi-US"
 * This function appends "-ip-{sessionId}" for sticky sessions.
 *
 * @param baseUsername - Provider username (e.g., "ACCTID-resi-US")
 * @param sessionId   - Unique session ID (reuse for same IP)
 */
export function createStickySession(
  baseUsername: string,
  sessionId?: string,
): { username: string; sessionId: string } {
  const id = sessionId || `s${Date.now().toString(36)}${Math.random().toString(36).substring(2, 8)}`;
  const username = `${baseUsername}-ip-${id}`;
  return { username, sessionId: id };
}

/**
 * Build an HTTP POST request string with JSON body.
 */
function buildHttpPostRequest(
  path: string,
  host: string,
  headers: Record<string, string>,
  body: string,
): string {
  const bodyBytes = new TextEncoder().encode(body);
  let req = `POST ${path} HTTP/1.1\r\n`;
  req += `Host: ${host}\r\n`;
  req += `Content-Length: ${bodyBytes.length}\r\n`;
  for (const [key, value] of Object.entries(headers)) {
    const lk = key.toLowerCase();
    if (lk !== 'host' && lk !== 'content-length') {
      req += `${key}: ${value}\r\n`;
    }
  }
  req += `Connection: close\r\n\r\n`;
  req += body;
  return req;
}

/**
 * Perform HTTP CONNECT handshake over a TCP socket.
 * Used for HTTP(S) proxies — establishes a raw tunnel to the target.
 * TLS then happens end-to-end (worker ↔ target), so SNI is correct.
 */
async function httpConnectHandshake(
  socket: { readable: ReadableStream; writable: WritableStream },
  targetHost: string,
  targetPort: number,
  auth: { username: string; password: string },
): Promise<void> {
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();

  // Build CONNECT request with Proxy-Authorization
  const credentials = btoa(`${auth.username}:${auth.password}`);
  const connectReq =
    `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n` +
    `Host: ${targetHost}:${targetPort}\r\n` +
    `Proxy-Authorization: Basic ${credentials}\r\n` +
    `Proxy-Connection: keep-alive\r\n` +
    `\r\n`;

  await writer.write(new TextEncoder().encode(connectReq));

  // Read the proxy's response (expect "HTTP/1.1 200 Connection established")
  const result = await reader.read();
  if (result.done || !result.value) throw new Error('HTTP CONNECT: connection closed');

  const response = new TextDecoder().decode(result.value);
  const statusMatch = response.match(/HTTP\/[\d.]+ (\d+)/);
  const status = statusMatch ? parseInt(statusMatch[1]) : 0;

  if (status !== 200) {
    throw new Error(`HTTP CONNECT: proxy returned ${status} — ${response.substring(0, 100)}`);
  }

  // Release locks so the socket can be upgraded to TLS
  writer.releaseLock();
  reader.releaseLock();
}

/**
 * Send an HTTP request through an HTTP CONNECT proxy tunnel.
 *
 * 1. Connect to proxy on HTTP port (1010)
 * 2. Send HTTP CONNECT to create a tunnel to target:443
 * 3. Upgrade the tunnel to TLS via startTls()
 * 4. Send the actual HTTP request through the encrypted tunnel
 *
 * NOTE: CF Workers' startTls() uses the connect() hostname for SNI.
 * Since we connected to proxy-jet.io, SNI will be proxy-jet.io even
 * after CONNECT. This works for targets behind Cloudflare (which routes
 * on Host header, not SNI). For other targets it may fail.
 *
 * If TLS fails, we fall back to sending the request as a plain HTTP
 * forward proxy request (GET https://... through the proxy).
 */
async function tunnelViaHttpProxy(
  method: string,
  targetUrl: string,
  reqHeaders: Record<string, string>,
  body: string | null,
  proxyConfig: ResidentialProxyConfig,
): Promise<{ status: number; body: Uint8Array }> {
  const url = new URL(targetUrl);
  const httpPort = proxyConfig.port === 2020 ? 1010 : proxyConfig.port;

  // Strategy 1: Try HTTP CONNECT + TLS (works for CF-fronted targets)
  try {
    const socket = connect(
      { hostname: proxyConfig.host, port: httpPort },
      { secureTransport: 'starttls', allowHalfOpen: false } as any,
    );

    await httpConnectHandshake(socket, url.hostname, 443, {
      username: proxyConfig.username,
      password: proxyConfig.password,
    });

    const tlsSocket = (socket as any).startTls();
    const writer = tlsSocket.writable.getWriter();

    // Build the actual HTTP request (relative path, not full URL)
    let req: string;
    if (body) {
      req = buildHttpPostRequest(url.pathname + url.search, url.hostname, reqHeaders, body);
    } else {
      req = buildHttpRequest(url.pathname + url.search, url.hostname, reqHeaders);
    }

    await writer.write(new TextEncoder().encode(req));
    await writer.close();

    const reader = tlsSocket.readable.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(new Uint8Array(value));
    }

    const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
    if (totalLen > 0) {
      const fullResponse = new Uint8Array(totalLen);
      let offset = 0;
      for (const chunk of chunks) {
        fullResponse.set(chunk, offset);
        offset += chunk.length;
      }
      const result = parseHttpResponse(fullResponse);
      if (result.status > 0) return result;
    }
    // If we got 0 bytes or status 0, fall through to forward proxy
    console.log(`[Proxy-Resi] CONNECT+TLS returned empty, trying forward proxy...`);
  } catch (e) {
    console.log(`[Proxy-Resi] CONNECT+TLS failed: ${e}, trying forward proxy...`);
  }

  // Strategy 2: Plain HTTP forward proxy (proxy handles TLS to target)
  const socket2 = connect(
    { hostname: proxyConfig.host, port: httpPort },
    { allowHalfOpen: false } as any,
  );

  const credentials = btoa(`${proxyConfig.username}:${proxyConfig.password}`);
  let req = `${method} ${targetUrl} HTTP/1.1\r\n`;
  req += `Host: ${url.hostname}\r\n`;
  req += `Proxy-Authorization: Basic ${credentials}\r\n`;
  for (const [key, value] of Object.entries(reqHeaders)) {
    const lk = key.toLowerCase();
    if (lk !== 'host' && lk !== 'proxy-authorization') {
      req += `${key}: ${value}\r\n`;
    }
  }
  if (body) {
    req += `Content-Length: ${new TextEncoder().encode(body).length}\r\n`;
  }
  req += `Connection: close\r\n\r\n`;
  if (body) req += body;

  const writer2 = socket2.writable.getWriter();
  await writer2.write(new TextEncoder().encode(req));
  await writer2.close();

  const reader2 = socket2.readable.getReader();
  const chunks2: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader2.read();
    if (done) break;
    chunks2.push(new Uint8Array(value));
  }

  const totalLen2 = chunks2.reduce((sum, c) => sum + c.length, 0);
  const fullResponse2 = new Uint8Array(totalLen2);
  let offset2 = 0;
  for (const chunk of chunks2) {
    fullResponse2.set(chunk, offset2);
    offset2 += chunk.length;
  }

  return parseHttpResponse(fullResponse2);
}

/**
 * Fetch a URL via an authenticated residential proxy (GET).
 * Tries HTTP CONNECT+TLS first, falls back to forward proxy.
 */
export async function fetchViaResidentialProxy(
  targetUrl: string,
  headers: Record<string, string>,
  proxyConfig: ResidentialProxyConfig,
): Promise<{ status: number; body: Uint8Array }> {
  const url = new URL(targetUrl);
  console.log(`[Proxy-Resi] GET ${url.hostname}${url.pathname.substring(0, 40)} via ${proxyConfig.host}`);

  const { status, body } = await tunnelViaHttpProxy('GET', targetUrl, headers, null, proxyConfig);

  console.log(`[Proxy-Resi] ${url.hostname} → ${status} (${body.length}b)`);
  return { status, body };
}

/**
 * POST a JSON body to a URL via an authenticated residential proxy.
 * Tries HTTP CONNECT+TLS first, falls back to forward proxy.
 */
export async function postViaResidentialProxy(
  targetUrl: string,
  headers: Record<string, string>,
  jsonBody: string,
  proxyConfig: ResidentialProxyConfig,
): Promise<{ status: number; body: Uint8Array }> {
  const url = new URL(targetUrl);
  console.log(`[Proxy-Resi] POST ${url.hostname}${url.pathname} via ${proxyConfig.host}`);

  const { status, body } = await tunnelViaHttpProxy('POST', targetUrl, headers, jsonBody, proxyConfig);

  const bodyText = new TextDecoder().decode(body);
  console.log(`[Proxy-Resi] POST ${url.hostname} → ${status} (${body.length}b) ${bodyText.substring(0, 100)}`);
  return { status, body };
}
