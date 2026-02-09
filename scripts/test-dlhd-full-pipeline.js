#!/usr/bin/env node
/**
 * DLHD Full Pipeline Test
 * 
 * Tests the COMPLETE flow for multiple channels:
 *   1. Fetch auth data (EPlayerAuth V5) from epaly.fun / hitsplay.fun
 *   2. Fetch M3U8 playlist directly from dvalna.ru
 *   3. Extract key URL + IV from M3U8
 *   4. Compute V5 auth headers (PoW nonce, HMAC key path, fingerprint)
 *   5. Fetch key via RPI /fetch route (residential IP proxy)
 *   6. Validate key is 16 bytes and NOT a known fake pattern
 *   7. Download first segment
 *   8. Attempt AES-128-CBC decrypt to verify key is real
 * 
 * Usage:
 *   node scripts/test-dlhd-full-pipeline.js
 *   node scripts/test-dlhd-full-pipeline.js --channel 51
 *   node scripts/test-dlhd-full-pipeline.js --quick   (3 channels only)
 */

const crypto = require('crypto');

// ── Config ──────────────────────────────────────────────────────────────────
const RPI_PROXY_URL = process.env.RPI_PROXY_URL || 'https://rpi-proxy.vynx.cc';
const RPI_PROXY_KEY = process.env.RPI_PROXY_KEY || process.env.RPI_PROXY_API_KEY || '';

// Load .env.local if available
try {
  const fs = require('fs');
  const envFile = fs.readFileSync('.env.local', 'utf8');
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.substring(0, eqIdx).trim();
    let val = trimmed.substring(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
} catch {}

const RPI_URL = process.env.RPI_PROXY_URL || RPI_PROXY_URL;
const API_KEY = process.env.RPI_PROXY_KEY || RPI_PROXY_KEY;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Channels to test — mix of servers (ddy6, zeko, wind, dokko1, nfs)
const ALL_TEST_CHANNELS = [
  { id: '51',  name: 'ABC [USA]',              server: 'zeko' },
  { id: '44',  name: 'ESPN [USA]',             server: 'zeko' },
  { id: '35',  name: 'Sky Sports Football',    server: 'zeko' },
  { id: '40',  name: 'Sky Sports Cricket',     server: 'ddy6' },
  { id: '55',  name: 'CBS [USA]',              server: 'ddy6' },
  { id: '43',  name: 'Sky Sports Golf',        server: 'wind' },
  { id: '60',  name: 'Sky Sports F1',          server: 'wind' },
  { id: '130', name: 'Sky Sports PL',          server: 'dokko1' },
  { id: '349', name: 'BBC News',               server: 'dokko1' },
  { id: '31',  name: 'TNT Sports 1',           server: 'nfs' },
  { id: '34',  name: 'TNT Sports 4',           server: 'nfs' },
  { id: '425', name: 'beIN Sports USA',        server: 'zeko' },
];

const QUICK_CHANNELS = ALL_TEST_CHANNELS.slice(0, 3);

// Known fake key hex prefixes
const FAKE_KEY_PATTERNS = [
  '455806f8',       // Common fake key
  '45c6497',        // Another fake
  '6572726f72',     // "error" in hex
  '00000000000000', // All zeros
];

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Simple MD5 for PoW (same as dlhd-auth-v5.ts) */
function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

/** HMAC-SHA256 */
function hmacSha256(data, key) {
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}

/** SHA-256 */
function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** Generate fingerprint (matches V5 auth) */
function generateFingerprint() {
  const data = UA + '1920x1080' + 'America/New_York' + 'en-US';
  return sha256(data).substring(0, 16);
}

/** Compute PoW nonce (matches V5 auth) */
function computePowNonce(channelKey, keyNumber, timestamp, channelSalt) {
  const hmacPrefix = hmacSha256(channelKey, channelSalt);
  const threshold = 0x1000;
  for (let nonce = 0; nonce < 100000; nonce++) {
    const data = hmacPrefix + channelKey + keyNumber + timestamp + nonce;
    const hash = md5(data);
    if (parseInt(hash.substring(0, 4), 16) < threshold) return nonce;
  }
  return 99999;
}

/** Compute key path (matches V5 auth) */
function computeKeyPath(resource, keyNumber, timestamp, fingerprint, channelSalt) {
  const data = `${resource}|${keyNumber}|${timestamp}|${fingerprint}`;
  return hmacSha256(data, channelSalt).substring(0, 16);
}

// ── Step 1: Fetch auth data from player page ────────────────────────────────

async function fetchAuthData(channel) {
  const endpoints = [
    `https://epaly.fun/premiumtv/daddyhd.php?id=${channel}`,
    `https://hitsplay.fun/premiumtv/daddyhd.php?id=${channel}`,
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Referer': 'https://dlhd.link/' },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;
      const html = await res.text();

      const initMatch = html.match(/EPlayerAuth\.init\s*\(\s*\{([^}]+)\}\s*\)/);
      if (!initMatch) continue;

      const s = initMatch[1];
      const authToken = s.match(/authToken\s*:\s*["']([^"']+)["']/)?.[1];
      const channelSalt = s.match(/channelSalt\s*:\s*["']([^"']+)["']/)?.[1];
      const channelKey = s.match(/channelKey\s*:\s*["']([^"']+)["']/)?.[1] || `premium${channel}`;

      if (authToken && channelSalt && /^[a-f0-9]{64}$/i.test(channelSalt)) {
        const source = url.includes('epaly') ? 'epaly' : 'hitsplay';
        return { authToken, channelSalt, channelKey, source };
      }
    } catch {}
  }
  return null;
}

// ── Step 2: Fetch M3U8 directly ─────────────────────────────────────────────

async function fetchM3U8(channelId, authToken, server) {
  const domain = 'dvalna.ru';
  const channelKey = `premium${channelId}`;
  const m3u8Url = `https://${server}new.${domain}/${server}/${channelKey}/mono.css`;

  const res = await fetch(m3u8Url, {
    headers: {
      'User-Agent': UA,
      'Accept': '*/*',
      'Referer': 'https://epaly.fun/',
      'Origin': 'https://epaly.fun',
      'Authorization': `Bearer ${authToken}`,
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, m3u8Url };
  const text = await res.text();
  if (!text.includes('#EXTM3U')) return { ok: false, error: 'Not M3U8', m3u8Url };

  // Extract key URI and IV
  const keyMatch = text.match(/#EXT-X-KEY:METHOD=AES-128,URI="([^"]+)"(?:,IV=0x([a-fA-F0-9]+))?/);
  if (!keyMatch) return { ok: true, encrypted: false, m3u8Url, playlist: text };

  const keyUri = keyMatch[1];
  const iv = keyMatch[2] || null;

  // Make key URL absolute
  const basePath = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);
  const keyUrl = keyUri.startsWith('http') ? keyUri : basePath + keyUri;

  // Extract first segment URL
  const segLines = text.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  const firstSeg = segLines[0];
  const segUrl = firstSeg?.startsWith('http') ? firstSeg : (firstSeg ? basePath + firstSeg.trim() : null);

  return { ok: true, encrypted: true, m3u8Url, keyUrl, iv, segUrl, playlist: text };
}

// ── Step 3: Fetch key via RPI /fetch ────────────────────────────────────────

async function fetchKeyViaRpi(keyUrl, authToken, channelSalt) {
  // Parse key URL: /key/premium51/5900830
  const keyMatch = keyUrl.match(/\/key\/([^/]+)\/(\d+)/);
  if (!keyMatch) return { ok: false, error: 'Cannot parse key URL' };

  const resource = keyMatch[1];
  const keyNumber = keyMatch[2];

  // Compute V5 auth headers with -7s offset (matches generateKeyHeaders)
  const timestamp = Math.floor(Date.now() / 1000) - 7;
  const fingerprint = generateFingerprint();
  const nonce = computePowNonce(resource, keyNumber, timestamp, channelSalt);
  const keyPath = computeKeyPath(resource, keyNumber, timestamp, fingerprint, channelSalt);

  const upstreamHeaders = {
    'User-Agent': UA,
    'Accept': '*/*',
    'Origin': 'https://epaly.fun',
    'Referer': 'https://epaly.fun/',
    'Authorization': `Bearer ${authToken}`,
    'X-Key-Timestamp': String(timestamp),
    'X-Key-Nonce': String(nonce),
    'X-Key-Path': keyPath,
    'X-Fingerprint': fingerprint,
  };

  // Call RPI /fetch
  const params = new URLSearchParams({
    url: keyUrl,
    headers: JSON.stringify(upstreamHeaders),
    key: API_KEY,
  });

  const fetchUrl = `${RPI_URL}/fetch?${params}`;

  const res = await fetch(fetchUrl, {
    headers: { 'X-API-Key': API_KEY },
    signal: AbortSignal.timeout(15000),
  });

  const upstreamStatus = res.headers.get('x-upstream-status');
  const buf = await res.arrayBuffer();

  if (buf.byteLength === 16) {
    const hex = Buffer.from(buf).toString('hex');
    const isFake = FAKE_KEY_PATTERNS.some(p => hex.startsWith(p));
    return { ok: !isFake, keyHex: hex, isFake, status: res.status, upstreamStatus };
  }

  // Not 16 bytes — probably an error
  const text = Buffer.from(buf).toString('utf8').substring(0, 200);
  return { ok: false, error: `Key size ${buf.byteLength}`, text, status: res.status, upstreamStatus };
}

// ── Step 4: Download segment and try decrypt ────────────────────────────────

async function fetchAndDecryptSegment(segUrl, keyHex, ivHex) {
  // Fetch segment directly (segments don't need auth)
  const res = await fetch(segUrl, {
    headers: {
      'User-Agent': UA,
      'Referer': 'https://epaly.fun/',
      'Origin': 'https://epaly.fun',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) return { ok: false, error: `Segment HTTP ${res.status}` };

  const segBuf = Buffer.from(await res.arrayBuffer());
  if (segBuf.length < 32) return { ok: false, error: `Segment too small: ${segBuf.length}b` };

  // Try AES-128-CBC decrypt
  const key = Buffer.from(keyHex, 'hex');
  // IV: use from M3U8 if available, otherwise first 16 bytes of segment (sequence-based)
  let iv;
  if (ivHex) {
    iv = Buffer.from(ivHex.padStart(32, '0'), 'hex');
  } else {
    // Default IV = segment sequence number as 16-byte big-endian (usually 0)
    iv = Buffer.alloc(16, 0);
  }

  try {
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    decipher.setAutoPadding(false); // TS segments may not have PKCS7 padding
    const decrypted = Buffer.concat([decipher.update(segBuf), decipher.final()]);

    // Check for MPEG-TS sync byte (0x47) in first few bytes
    // Valid TS packets start with 0x47 every 188 bytes
    const hasSyncByte = decrypted[0] === 0x47 || 
                        (decrypted.length > 188 && decrypted[188] === 0x47);

    return {
      ok: true,
      segSize: segBuf.length,
      decryptedSize: decrypted.length,
      hasSyncByte,
      firstBytes: decrypted.slice(0, 8).toString('hex'),
    };
  } catch (e) {
    return { ok: false, error: `Decrypt failed: ${e.message}`, segSize: segBuf.length };
  }
}

// ── Main test runner ────────────────────────────────────────────────────────

async function testChannel(ch) {
  const result = {
    id: ch.id,
    name: ch.name,
    server: ch.server,
    steps: {},
    status: 'UNKNOWN',
  };

  const t0 = Date.now();

  // Step 1: Auth
  try {
    const auth = await fetchAuthData(ch.id);
    if (!auth) {
      result.steps.auth = { ok: false, error: 'No auth data' };
      result.status = 'FAIL_AUTH';
      return result;
    }
    result.steps.auth = { ok: true, source: auth.source, saltPrefix: auth.channelSalt.substring(0, 12) };
    result._auth = auth; // internal
  } catch (e) {
    result.steps.auth = { ok: false, error: e.message };
    result.status = 'FAIL_AUTH';
    return result;
  }

  // Step 2: M3U8
  try {
    const m3u8 = await fetchM3U8(ch.id, result._auth.authToken, ch.server);
    if (!m3u8.ok) {
      result.steps.m3u8 = { ok: false, error: m3u8.error };
      result.status = 'FAIL_M3U8';
      return result;
    }
    result.steps.m3u8 = { ok: true, encrypted: m3u8.encrypted };
    result._m3u8 = m3u8;

    if (!m3u8.encrypted) {
      result.status = 'OK_UNENCRYPTED';
      result.totalMs = Date.now() - t0;
      return result;
    }
  } catch (e) {
    result.steps.m3u8 = { ok: false, error: e.message };
    result.status = 'FAIL_M3U8';
    return result;
  }

  // Step 3: Key via RPI /fetch
  try {
    const key = await fetchKeyViaRpi(
      result._m3u8.keyUrl,
      result._auth.authToken,
      result._auth.channelSalt
    );
    result.steps.key = { ok: key.ok, keyHex: key.keyHex, isFake: key.isFake, status: key.status, upstreamStatus: key.upstreamStatus };
    if (!key.ok) {
      result.status = key.isFake ? 'FAIL_FAKE_KEY' : 'FAIL_KEY';
      if (key.error) result.steps.key.error = key.error;
      if (key.text) result.steps.key.text = key.text;
      return result;
    }
    result._key = key;
  } catch (e) {
    result.steps.key = { ok: false, error: e.message };
    result.status = 'FAIL_KEY';
    return result;
  }

  // Step 4: Segment decrypt
  if (result._m3u8.segUrl) {
    try {
      const seg = await fetchAndDecryptSegment(
        result._m3u8.segUrl,
        result._key.keyHex,
        result._m3u8.iv
      );
      result.steps.decrypt = seg;
      if (seg.ok && seg.hasSyncByte) {
        result.status = 'OK';
      } else if (seg.ok) {
        result.status = 'OK_NO_SYNC'; // Decrypted but no TS sync byte (might still be valid)
      } else {
        result.status = 'FAIL_DECRYPT';
      }
    } catch (e) {
      result.steps.decrypt = { ok: false, error: e.message };
      result.status = 'FAIL_DECRYPT';
    }
  } else {
    result.steps.decrypt = { ok: false, error: 'No segment URL found' };
    result.status = 'FAIL_NO_SEGMENT';
  }

  result.totalMs = Date.now() - t0;
  delete result._auth;
  delete result._m3u8;
  delete result._key;
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const singleChannel = args.find(a => a === '--channel') ? args[args.indexOf('--channel') + 1] : null;
  const quick = args.includes('--quick');

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║          DLHD Full Pipeline Test (Auth → Decrypt)          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`  RPI: ${RPI_URL}`);
  console.log(`  Key: ${API_KEY ? API_KEY.substring(0, 8) + '...' : 'NOT SET'}`);
  console.log('');

  if (!API_KEY) {
    console.error('ERROR: No RPI_PROXY_KEY set. Check .env.local');
    process.exit(1);
  }

  let channels;
  if (singleChannel) {
    const existing = ALL_TEST_CHANNELS.find(c => c.id === singleChannel);
    channels = [existing || { id: singleChannel, name: `Channel ${singleChannel}`, server: 'zeko' }];
  } else {
    channels = quick ? QUICK_CHANNELS : ALL_TEST_CHANNELS;
  }

  const results = [];
  let ok = 0, partial = 0, fail = 0;

  for (const ch of channels) {
    const label = `${ch.id.padStart(3)} ${ch.name.padEnd(24)} [${ch.server}]`;
    process.stdout.write(`  ${label}  `);

    const result = await testChannel(ch);
    results.push(result);

    const ms = result.totalMs ? `${result.totalMs}ms` : '';

    switch (result.status) {
      case 'OK':
        console.log(`✅ PASS  ${ms}  key=${result.steps.key?.keyHex?.substring(0, 8)}.. sync=✓`);
        ok++;
        break;
      case 'OK_NO_SYNC':
        console.log(`⚠️  DECRYPT OK but no TS sync byte  ${ms}`);
        partial++;
        break;
      case 'OK_UNENCRYPTED':
        console.log(`✅ PASS (unencrypted)  ${ms}`);
        ok++;
        break;
      case 'FAIL_AUTH':
        console.log(`❌ AUTH FAIL: ${result.steps.auth?.error}`);
        fail++;
        break;
      case 'FAIL_M3U8':
        console.log(`❌ M3U8 FAIL: ${result.steps.m3u8?.error}`);
        fail++;
        break;
      case 'FAIL_FAKE_KEY':
        console.log(`❌ FAKE KEY: ${result.steps.key?.keyHex}`);
        fail++;
        break;
      case 'FAIL_KEY':
        console.log(`❌ KEY FAIL: ${result.steps.key?.error || result.steps.key?.text || 'unknown'}`);
        fail++;
        break;
      case 'FAIL_DECRYPT':
        console.log(`❌ DECRYPT FAIL: ${result.steps.decrypt?.error}`);
        fail++;
        break;
      default:
        console.log(`❌ ${result.status}: ${JSON.stringify(result.steps).substring(0, 80)}`);
        fail++;
    }

    // Small delay between channels to avoid rate limiting
    if (channels.length > 1) await new Promise(r => setTimeout(r, 500));
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Results: ${ok} PASS  ${partial} PARTIAL  ${fail} FAIL  (${channels.length} total)`);
  console.log('═══════════════════════════════════════════════════════════════');

  // Dump failures in detail
  const failures = results.filter(r => r.status.startsWith('FAIL'));
  if (failures.length > 0) {
    console.log('\n── Failure Details ──');
    for (const f of failures) {
      console.log(`\n  Channel ${f.id} (${f.name}) — ${f.status}`);
      console.log(`    ${JSON.stringify(f.steps, null, 2).split('\n').join('\n    ')}`);
    }
  }

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
