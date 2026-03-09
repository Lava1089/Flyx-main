/**
 * DLHD Key Bandwidth Calculator
 *
 * Measures the actual byte size of a full key fetch round-trip:
 * - Request headers + body
 * - Response headers + body (16 bytes AES key)
 * - PoW computation overhead (CPU only, no network)
 *
 * Then calculates: if 100 users are watching live TV,
 * how much bandwidth does key fetching consume per hour/day/month?
 *
 * HLS key fetch frequency depends on EXT-X-KEY in the playlist.
 * Typically the key URI appears once at the top of a live playlist,
 * and the player fetches it once per playlist reload (every ~6-10s for live).
 * But if the player caches the key URI, it only re-fetches when the URI changes.
 */

import { describe, test } from 'bun:test';
import { createHmac, createHash } from 'crypto';

const PLAYER_DOMAIN = 'www.ksohls.ru';
const CDN_DOMAIN = 'soyspace.cyou';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HMAC_SECRET = '444c44cc8888888844444444';
const POW_THRESHOLD = 0x1000;

function computePoWNonce(resource: string, keyNumber: string, timestamp: number): number | null {
  const hmac = createHmac('sha256', HMAC_SECRET).update(resource).digest('hex');
  for (let nonce = 0; nonce < 100000; nonce++) {
    const data = `${hmac}${resource}${keyNumber}${timestamp}${nonce}`;
    const hash = createHash('md5').update(data).digest('hex');
    if (parseInt(hash.substring(0, 4), 16) < POW_THRESHOLD) return nonce;
  }
  return null;
}

function generateKeyJWT(resource: string, keyNumber: string, timestamp: number, nonce: number): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = { resource, keyNumber, timestamp, nonce, exp: timestamp + 300 };
  const b64H = Buffer.from(JSON.stringify(header)).toString('base64url');
  const b64P = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', HMAC_SECRET).update(`${b64H}.${b64P}`).digest('base64url');
  return `${b64H}.${b64P}.${sig}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(4)} GB`;
}

describe('DLHD Key Bandwidth Analysis', () => {

  test('measure actual key fetch request/response sizes', async () => {
    console.log('\n════════════════════════════════════════');
    console.log('  MEASURING KEY FETCH SIZES');
    console.log('════════════════════════════════════════\n');

    const channelKey = 'premium44';
    const keyNumber = '1';
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = computePoWNonce(channelKey, keyNumber, timestamp)!;
    const jwt = generateKeyJWT(channelKey, keyNumber, timestamp, nonce);

    // Build the exact request that would be sent
    const keyUrl = `https://chevy.${CDN_DOMAIN}/key/${channelKey}/${keyNumber}`;
    const requestHeaders: Record<string, string> = {
      'User-Agent': USER_AGENT,
      'Referer': `https://${PLAYER_DOMAIN}/`,
      'Origin': `https://${PLAYER_DOMAIN}`,
      'Authorization': `Bearer ${jwt}`,
      'X-Key-Timestamp': timestamp.toString(),
      'X-Key-Nonce': nonce.toString(),
      'Accept': '*/*',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
    };

    // Calculate request size
    // HTTP request line: GET /key/premium44/1 HTTP/1.1\r\n
    const requestLine = `GET /key/${channelKey}/${keyNumber} HTTP/1.1\r\n`;
    const hostHeader = `Host: chevy.${CDN_DOMAIN}\r\n`;
    let requestHeadersStr = requestLine + hostHeader;
    for (const [k, v] of Object.entries(requestHeaders)) {
      requestHeadersStr += `${k}: ${v}\r\n`;
    }
    requestHeadersStr += '\r\n'; // end of headers

    const requestBytes = Buffer.byteLength(requestHeadersStr, 'utf8');

    console.log('REQUEST:');
    console.log(`  URL: ${keyUrl}`);
    console.log(`  JWT length: ${jwt.length} chars`);
    console.log(`  Request headers size: ${requestBytes} bytes`);
    console.log(`  Request body: 0 bytes (GET)`);
    console.log(`  Total request: ${requestBytes} bytes`);

    // Actually fetch to measure response
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(keyUrl, {
      headers: requestHeaders,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    // Measure response
    const responseBody = await resp.arrayBuffer();
    const responseBodySize = responseBody.byteLength;

    // Estimate response headers size
    let responseHeadersStr = `HTTP/1.1 ${resp.status} ${resp.statusText}\r\n`;
    resp.headers.forEach((v, k) => {
      responseHeadersStr += `${k}: ${v}\r\n`;
    });
    responseHeadersStr += '\r\n';
    const responseHeadersSize = Buffer.byteLength(responseHeadersStr, 'utf8');

    console.log('\nRESPONSE:');
    console.log(`  Status: ${resp.status}`);
    console.log(`  Response headers size: ${responseHeadersSize} bytes`);
    console.log(`  Response body size: ${responseBodySize} bytes`);
    console.log(`  Total response: ${responseHeadersSize + responseBodySize} bytes`);
    console.log(`  Key hex: ${Buffer.from(responseBody).toString('hex')}`);

    // Print all response headers for reference
    console.log('\n  Response headers:');
    resp.headers.forEach((v, k) => {
      console.log(`    ${k}: ${v}`);
    });

    const totalPerFetch = requestBytes + responseHeadersSize + responseBodySize;
    console.log(`\n  TOTAL PER KEY FETCH: ${totalPerFetch} bytes (${formatBytes(totalPerFetch)})`);

    // ════════════════════════════════════════
    // BANDWIDTH PROJECTIONS
    // ════════════════════════════════════════

    console.log('\n════════════════════════════════════════');
    console.log('  BANDWIDTH PROJECTIONS — 100 USERS');
    console.log('════════════════════════════════════════\n');

    // HLS live playlists typically reload every target duration (usually 6-10s)
    // The player fetches the key when it first sees EXT-X-KEY or when the URI changes.
    // Scenario A: Player caches key, only fetches once per session
    // Scenario B: Player fetches key every playlist reload (~every 8s)
    // Scenario C: Key rotates every N minutes, player re-fetches

    const users = 100;
    const avgChannels = 13; // max unique channels per whitelist window

    // Also account for the whitelist request itself
    // reCAPTCHA solve: ~3 HTTP requests (api.js + anchor + reload)
    // verify POST: 1 request
    const recaptchaApiJsSize = 800;     // small JS loader
    const recaptchaAnchorSize = 93000;  // ~93KB HTML (from our test)
    const recaptchaReloadSize = 40000;  // ~40KB response
    const verifyRequestSize = 2200;     // JSON POST with ~2KB token
    const verifyResponseSize = 150;     // small JSON response
    const whitelistTotalPerChannel = recaptchaApiJsSize + recaptchaAnchorSize + recaptchaReloadSize + verifyRequestSize + verifyResponseSize;

    console.log('Per-fetch sizes:');
    console.log(`  Key request:  ${requestBytes} bytes`);
    console.log(`  Key response: ${responseHeadersSize + responseBodySize} bytes`);
    console.log(`  Key total:    ${totalPerFetch} bytes (${formatBytes(totalPerFetch)})`);
    console.log(`  Whitelist (reCAPTCHA + verify): ~${formatBytes(whitelistTotalPerChannel)} per channel`);

    const scenarios = [
      { name: 'A: Key cached per session (fetch once)', fetchesPerUserPerHour: 1 },
      { name: 'B: Key re-fetched every 5 min', fetchesPerUserPerHour: 12 },
      { name: 'C: Key re-fetched every playlist reload (~8s)', fetchesPerUserPerHour: 450 },
    ];

    for (const s of scenarios) {
      console.log(`\n── Scenario ${s.name} ──`);

      const keyFetchesPerHour = users * s.fetchesPerUserPerHour;
      const keyBytesPerHour = keyFetchesPerHour * totalPerFetch;

      // Whitelist: 13 channels every 30 min = 26 whitelists/hour
      const whitelistsPerHour = avgChannels * 2; // refresh every 30 min
      const whitelistBytesPerHour = whitelistsPerHour * whitelistTotalPerChannel;

      const totalBytesPerHour = keyBytesPerHour + whitelistBytesPerHour;
      const totalBytesPerDay = totalBytesPerHour * 24;
      const totalBytesPerMonth = totalBytesPerDay * 30;

      console.log(`  Key fetches/hour:       ${keyFetchesPerHour.toLocaleString()}`);
      console.log(`  Key bandwidth/hour:     ${formatBytes(keyBytesPerHour)}`);
      console.log(`  Whitelist bandwidth/hr: ${formatBytes(whitelistBytesPerHour)}`);
      console.log(`  Total/hour:             ${formatBytes(totalBytesPerHour)}`);
      console.log(`  Total/day:              ${formatBytes(totalBytesPerDay)}`);
      console.log(`  Total/month:            ${formatBytes(totalBytesPerMonth)}`);
    }

    // WITH key caching at CF worker level
    console.log('\n── Scenario D: CF Worker caches keys (RECOMMENDED) ──');
    console.log('  Users never fetch keys directly — CF worker serves cached keys.');
    console.log('  CF worker fetches 1 key per channel, caches in KV.');

    const cfKeyFetchesPerHour = avgChannels * 12; // re-fetch every 5 min per channel
    const cfKeyBytesPerHour = cfKeyFetchesPerHour * totalPerFetch;
    const cfWhitelistBytesPerHour = avgChannels * 2 * whitelistTotalPerChannel;
    const cfTotalPerHour = cfKeyBytesPerHour + cfWhitelistBytesPerHour;

    // User-facing: CF worker serves 16-byte key from cache
    const cfUserResponseSize = 16 + 200; // 16 byte key + ~200 byte headers
    const cfUserFetchesPerHour = users * 12; // users re-fetch every 5 min
    const cfUserBytesPerHour = cfUserFetchesPerHour * cfUserResponseSize;

    console.log(`  Upstream key fetches/hr:  ${cfKeyFetchesPerHour} (${avgChannels} channels × 12/hr)`);
    console.log(`  Upstream bandwidth/hr:    ${formatBytes(cfTotalPerHour)}`);
    console.log(`  User-facing bandwidth/hr: ${formatBytes(cfUserBytesPerHour)} (from CF cache)`);
    console.log(`  Upstream bandwidth/day:   ${formatBytes(cfTotalPerHour * 24)}`);
    console.log(`  Upstream bandwidth/month: ${formatBytes(cfTotalPerHour * 24 * 30)}`);

  }, 30000);
});
