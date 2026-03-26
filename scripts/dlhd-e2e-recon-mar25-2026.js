#!/usr/bin/env node
/**
 * DLHD Full E2E Recon + Extraction Test — March 25, 2026
 *
 * Probes every step of the DLHD pipeline with detailed timings:
 *   1. Domain chain (dlstreams.top → player iframe → current player domain)
 *   2. Player page fetch + EPlayerAuth extraction (XOR-encrypted)
 *   3. Server lookup API (vovlacosa.sbs, soyspace.cyou, ai.the-sunmoon.site)
 *   4. M3U8 playlist fetch (chevy.soyspace.cyou/proxy/...)
 *   5. Key URI extraction from M3U8
 *   6. Key server reachability (key.keylocking.ru, chevy.soyspace.cyou, ai.the-sunmoon.site)
 *   7. reCAPTCHA v3 HTTP bypass
 *   8. Verify endpoint (ai.the-sunmoon.site/verify)
 *   9. Key fetch with V5 EPlayerAuth headers
 *  10. TS segment fetch
 *
 * Usage:  node scripts/dlhd-e2e-recon-mar25-2026.js [channelId]
 *         Default channel: 44 (typically ESPN or a popular US channel)
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');

// ─── Config ─────────────────────────────────────────────────────────────────
const CHANNEL = process.argv[2] || '44';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const RECAPTCHA_SITE_KEY = '6LfJv4AsAAAAALTLEHKaQ7LN_VYfFqhLPrB2Tvgj';

// Known domains to probe
const PLAYER_DOMAINS = [
  'enviromentalspace.sbs',   // primary (Mar 24)
  'www.ksohls.ru',           // fallback
  'hitsplay.fun',            // legacy
];
const LOOKUP_DOMAINS = ['vovlacosa.sbs', 'soyspace.cyou'];
const M3U8_SERVERS  = ['ai.the-sunmoon.site'];
const KEY_DOMAINS   = ['key.keylocking.ru', 'chevy.soyspace.cyou', 'ai.the-sunmoon.site'];
const CDN_DOMAIN    = 'soyspace.cyou';

// ─── HTTP helper ────────────────────────────────────────────────────────────
function fetchUrl(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const mod = url.startsWith('https') ? https : http;
    const headers = { 'User-Agent': UA, ...(opts.headers || {}) };

    const req = mod.request(url, {
      method: opts.method || 'GET',
      headers,
      timeout: opts.timeout || 12000,
      rejectUnauthorized: false,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: body.toString('utf8'),
          raw: body,
          ms: Date.now() - start,
        });
      });
    });
    req.on('error', e => reject(Object.assign(e, { ms: Date.now() - start })));
    req.on('timeout', () => { req.destroy(); reject(Object.assign(new Error('Timeout'), { ms: Date.now() - start })); });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// ─── Timing helper ──────────────────────────────────────────────────────────
function fmt(ms) { return `${ms}ms`; }

let passed = 0, failed = 0, warned = 0;
const results = [];

function ok(step, name, ms, detail) {
  passed++;
  const msg = `  ✅ ${name}` + (ms != null ? ` [${fmt(ms)}]` : '') + (detail ? ` — ${detail}` : '');
  console.log(msg);
  results.push({ step, name, status: 'pass', ms, detail });
}
function fail(step, name, reason, ms) {
  failed++;
  const msg = `  ❌ ${name}` + (ms != null ? ` [${fmt(ms)}]` : '') + `: ${reason}`;
  console.log(msg);
  results.push({ step, name, status: 'fail', ms, reason });
}
function warn(step, name, reason, ms) {
  warned++;
  const msg = `  ⚠️  ${name}` + (ms != null ? ` [${fmt(ms)}]` : '') + `: ${reason}`;
  console.log(msg);
  results.push({ step, name, status: 'warn', ms, reason });
}

// ─── XOR decrypt helper (mirrors dlhd-auth-v5.ts) ──────────────────────────
function xorDecrypt(bytes, key) {
  return bytes.map(b => String.fromCharCode(b ^ key)).join('');
}

function extractEncryptedAuth(html) {
  // Find decoder function
  const decoderMatch = html.match(/(?:const|var|let)\s+(_dec_\w+)\s*=\s*\(?d\s*,\s*k\)?/)
    || html.match(/function\s+(_dec_\w+)\s*\(\s*d\s*,\s*k\s*\)/);
  if (!decoderMatch) return null;

  // Find byte arrays
  const byteArrays = {};
  const arrayRe = /(?:const|var|let)\s+(_init_\w+)\s*=\s*\[([0-9,\s]+)\]/g;
  let m;
  while ((m = arrayRe.exec(html)) !== null) {
    byteArrays[m[1]] = m[2].split(',').map(s => parseInt(s.trim(), 10));
  }
  if (Object.keys(byteArrays).length === 0) return null;

  // Find EPlayerAuth.init()
  const initMatch = html.match(/EPlayerAuth\.init\s*\(\s*\{([\s\S]*?)\}\s*\)/);
  if (!initMatch) return null;

  const initBlock = initMatch[1];
  const result = {};

  // Encrypted fields
  const fieldRe = /(\w+)\s*:\s*_dec_\w+\s*\(\s*(_init_\w+)\s*,\s*(\d+)\s*\)/g;
  while ((m = fieldRe.exec(initBlock)) !== null) {
    const bytes = byteArrays[m[2]];
    if (bytes) result[m[1]] = xorDecrypt(bytes, parseInt(m[3], 10));
  }

  // Plain string fields
  const plainRe = /(\w+)\s*:\s*["']([^"']+)["']/g;
  while ((m = plainRe.exec(initBlock)) !== null) {
    if (!result[m[1]]) result[m[1]] = m[2];
  }

  // Numeric fields
  const numRe = /(\w+)\s*:\s*(\d{8,})/g;
  while ((m = numRe.exec(initBlock)) !== null) {
    if (!result[m[1]]) result[m[1]] = m[2];
  }

  return Object.keys(result).length > 0 ? result : null;
}

// ─── MD5 (for PoW) ─────────────────────────────────────────────────────────
function md5(str) { return crypto.createHash('md5').update(str).digest('hex'); }

// ─── HMAC-SHA256 ────────────────────────────────────────────────────────────
function hmacSha256(data, key) {
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}

// ─── PoW nonce computation ──────────────────────────────────────────────────
function computePowNonce(channelKey, keyNumber, timestamp, channelSalt) {
  const hmacPrefix = hmacSha256(channelKey, channelSalt);
  for (let nonce = 0; nonce < 100000; nonce++) {
    const hash = md5(hmacPrefix + channelKey + keyNumber + timestamp + nonce);
    if (parseInt(hash.substring(0, 4), 16) < 0x1000) return nonce;
  }
  return 99999;
}

// ─── Browser fingerprint ────────────────────────────────────────────────────
function generateFingerprint() {
  const data = UA + '1920x1080' + 'America/New_York' + 'en-US';
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
}

// ─── Key path computation ───────────────────────────────────────────────────
function computeKeyPath(resource, keyNumber, timestamp, fingerprint, channelSalt) {
  const data = `${resource}|${keyNumber}|${timestamp}|${fingerprint}`;
  return hmacSha256(data, channelSalt).substring(0, 16);
}

// ═══════════════════════════════════════════════════════════════════════════
//  TESTS
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const totalStart = Date.now();
  console.log(`\n╔══════════════════════════════════════════════════════════╗`);
  console.log(`║  DLHD E2E Recon — March 25 2026 — Channel ${CHANNEL.padEnd(4)}           ║`);
  console.log(`╚══════════════════════════════════════════════════════════╝\n`);

  let currentPlayerDomain = null;
  let authData = null;       // { authToken, channelKey, channelSalt, country, timestamp }
  let serverKey = null;
  let m3u8Url = null;
  let m3u8Body = null;
  let keyUri = null;
  let fullKeyUrl = null;
  let segmentUrl = null;

  // ────────────────────────────────────────────────────────────────────────
  // 1. DOMAIN CHAIN: dlstreams.top → stream page → player iframe
  // ────────────────────────────────────────────────────────────────────────
  console.log('─── 1. DOMAIN CHAIN ───');
  try {
    const res = await fetchUrl(`https://dlstreams.top/stream/stream-${CHANNEL}.php`, {
      headers: { 'Referer': 'https://dlstreams.top/' },
    });
    if (res.status === 200) {
      ok(1, `dlstreams.top reachable`, res.ms, `${res.body.length} chars`);
      const iframeMatch = res.body.match(/<iframe[^>]*src=["']([^"']+)["']/i);
      if (iframeMatch) {
        const playerUrl = iframeMatch[1];
        try {
          const domain = new URL(playerUrl).hostname;
          currentPlayerDomain = domain;
          ok(1, `Player iframe → ${domain}`, null, playerUrl.substring(0, 100));
        } catch {
          // relative URL?
          ok(1, `Player iframe src`, null, playerUrl.substring(0, 100));
        }
      } else {
        warn(1, 'No iframe found in stream page', 'DOM structure may have changed');
      }
    } else {
      fail(1, 'dlstreams.top', `HTTP ${res.status}`, res.ms);
    }
  } catch (e) { fail(1, 'dlstreams.top', e.message, e.ms); }

  // Also try daddylive.mp
  try {
    const res = await fetchUrl(`https://daddylive.mp/stream/stream-${CHANNEL}.php`, {
      headers: { 'Referer': 'https://daddylive.mp/' },
      timeout: 8000,
    });
    if (res.status === 200) {
      ok(1, `daddylive.mp reachable`, res.ms);
      const iframeMatch = res.body.match(/<iframe[^>]*src=["']([^"']+)["']/i);
      if (iframeMatch) {
        const domain = (() => { try { return new URL(iframeMatch[1]).hostname; } catch { return iframeMatch[1]; } })();
        ok(1, `daddylive.mp player → ${domain}`, null);
        if (!currentPlayerDomain) currentPlayerDomain = domain;
      }
    } else {
      warn(1, 'daddylive.mp', `HTTP ${res.status}`, res.ms);
    }
  } catch (e) { warn(1, 'daddylive.mp', e.message, e.ms); }

  // ────────────────────────────────────────────────────────────────────────
  // 2. PLAYER PAGE + AUTH EXTRACTION
  // ────────────────────────────────────────────────────────────────────────
  console.log('\n─── 2. PLAYER PAGE + AUTH EXTRACTION ───');
  for (const domain of PLAYER_DOMAINS) {
    try {
      const url = `https://${domain}/premiumtv/daddyhd.php?id=${CHANNEL}`;
      const res = await fetchUrl(url, {
        headers: { 'Referer': 'https://dlstreams.top/' },
        timeout: 8000,
      });

      if (res.status === 200) {
        ok(2, `${domain} reachable`, res.ms, `${res.body.length} chars`);

        // Check for EPlayerAuth
        const hasEPlayer = res.body.includes('EPlayerAuth');
        const hasRecaptcha = res.body.includes('recaptcha') || res.body.includes('grecaptcha');
        const hasJWT = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(res.body);

        if (hasEPlayer) ok(2, `  EPlayerAuth found on ${domain}`);
        else warn(2, `  No EPlayerAuth on ${domain}`, 'auth format may have changed');

        if (hasRecaptcha) ok(2, `  reCAPTCHA present on ${domain}`);
        if (hasJWT) ok(2, `  JWT token found on ${domain}`);

        // Try XOR-encrypted extraction
        const encrypted = extractEncryptedAuth(res.body);
        if (encrypted) {
          ok(2, `  XOR auth extracted from ${domain}`, null,
            `fields: ${Object.keys(encrypted).join(', ')}`);

          if (encrypted.authToken) {
            ok(2, `  authToken: ${encrypted.authToken.substring(0, 30)}...`);
          }
          if (encrypted.channelSalt) {
            if (/^[a-f0-9]{64}$/i.test(encrypted.channelSalt)) {
              ok(2, `  channelSalt: ${encrypted.channelSalt.substring(0, 16)}... (valid 64-hex)`);
            } else {
              fail(2, `  channelSalt`, `Invalid format: ${encrypted.channelSalt.substring(0, 30)}`);
            }
          } else {
            fail(2, `  channelSalt`, 'Missing from auth data');
          }
          if (encrypted.channelKey) ok(2, `  channelKey: ${encrypted.channelKey}`);

          // Save auth data from first successful domain
          if (!authData && encrypted.authToken && encrypted.channelSalt) {
            authData = {
              authToken: encrypted.authToken,
              channelKey: encrypted.channelKey || `premium${CHANNEL}`,
              channelSalt: encrypted.channelSalt,
              country: encrypted.country || 'US',
              timestamp: encrypted.timestamp ? parseInt(encrypted.timestamp) : Math.floor(Date.now() / 1000),
            };
          }
        } else {
          // Try plain-text EPlayerAuth fallback
          const initMatch = res.body.match(/EPlayerAuth\.init\s*\(\s*\{([^}]+)\}\s*\)/);
          if (initMatch) {
            warn(2, `  Plain EPlayerAuth on ${domain}`, 'XOR extraction failed but plain-text found');
            const initStr = initMatch[1];
            const at = initStr.match(/authToken\s*:\s*["']([^"']+)["']/);
            const cs = initStr.match(/channelSalt\s*:\s*["']([^"']+)["']/);
            if (at) ok(2, `  authToken (plain): ${at[1].substring(0, 30)}...`);
            if (cs) ok(2, `  channelSalt (plain): ${cs[1].substring(0, 16)}...`);
            if (!authData && at && cs && /^[a-f0-9]{64}$/i.test(cs[1])) {
              authData = {
                authToken: at[1],
                channelKey: `premium${CHANNEL}`,
                channelSalt: cs[1],
                country: 'US',
                timestamp: Math.floor(Date.now() / 1000),
              };
            }
          } else if (hasJWT) {
            // Fallback: extract JWT directly
            const jwtMatch = res.body.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
            if (jwtMatch) {
              warn(2, `  JWT found but no EPlayerAuth.init() — format may have changed`, 'Needs investigation');
              try {
                const payloadB64 = jwtMatch[0].split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
                const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString());
                ok(2, `  JWT payload`, null, `sub=${payload.sub}, exp=${payload.exp}`);
              } catch {}
            }
          } else {
            fail(2, `  Auth extraction from ${domain}`, 'No EPlayerAuth, no JWT, no XOR patterns found');
            // Dump a preview for debugging
            console.log(`    Preview: ${res.body.substring(0, 300).replace(/\n/g, '\\n')}`);
          }
        }
      } else {
        fail(2, domain, `HTTP ${res.status}`, res.ms);
      }
    } catch (e) {
      fail(2, domain, e.message, e.ms);
    }
  }

  if (!authData) {
    fail(2, 'AUTH DATA', '⛔ Could not extract auth from any player domain — pipeline is BROKEN here');
  }

  // ────────────────────────────────────────────────────────────────────────
  // 3. SERVER LOOKUP API
  // ────────────────────────────────────────────────────────────────────────
  console.log('\n─── 3. SERVER LOOKUP ───');
  const channelKey = authData?.channelKey || `premium${CHANNEL}`;

  // Try lookup domains
  for (const domain of LOOKUP_DOMAINS) {
    try {
      const url = `https://chevy.${domain}/server_lookup?channel_id=${channelKey}`;
      const res = await fetchUrl(url, {
        headers: { 'Referer': `https://enviromentalspace.sbs/`, 'Origin': 'https://enviromentalspace.sbs' },
        timeout: 5000,
      });
      if (res.status === 200 && !res.body.startsWith('<')) {
        const data = JSON.parse(res.body);
        if (data.server_key) {
          ok(3, `chevy.${domain}`, res.ms, `server_key=${data.server_key}`);
          if (!serverKey) serverKey = data.server_key;
        } else {
          fail(3, `chevy.${domain}`, `No server_key in response: ${res.body.substring(0, 100)}`, res.ms);
        }
      } else {
        fail(3, `chevy.${domain}`, `HTTP ${res.status}`, res.ms);
      }
    } catch (e) { fail(3, `chevy.${domain}`, e.message, e.ms); }
  }

  // Try ai.the-sunmoon.site
  for (const server of M3U8_SERVERS) {
    try {
      const url = `https://${server}/server_lookup?channel_id=${channelKey}`;
      const res = await fetchUrl(url, {
        headers: { 'Referer': `https://enviromentalspace.sbs/`, 'Origin': 'https://enviromentalspace.sbs' },
        timeout: 5000,
      });
      if (res.status === 200 && !res.body.startsWith('<')) {
        const data = JSON.parse(res.body);
        if (data.server_key) {
          ok(3, server, res.ms, `server_key=${data.server_key}`);
          if (!serverKey) serverKey = data.server_key;
        } else {
          fail(3, server, `No server_key: ${res.body.substring(0, 100)}`, res.ms);
        }
      } else {
        fail(3, server, `HTTP ${res.status}, body starts with: ${res.body.substring(0, 60)}`, res.ms);
      }
    } catch (e) { fail(3, server, e.message, e.ms); }
  }

  if (!serverKey) {
    serverKey = 'zeko'; // hardcoded fallback
    warn(3, 'SERVER KEY', `All lookups failed, using fallback: ${serverKey}`);
  }

  // ────────────────────────────────────────────────────────────────────────
  // 4. M3U8 PLAYLIST FETCH
  // ────────────────────────────────────────────────────────────────────────
  console.log('\n─── 4. M3U8 PLAYLIST FETCH ───');
  m3u8Url = `https://chevy.${CDN_DOMAIN}/proxy/${serverKey}/${channelKey}/mono.css`;
  console.log(`  URL: ${m3u8Url}`);

  // Try different Referer/Origin combos
  const refererCombos = [
    { Referer: 'https://enviromentalspace.sbs/', Origin: 'https://enviromentalspace.sbs' },
    { Referer: `https://${currentPlayerDomain || 'enviromentalspace.sbs'}/`, Origin: `https://${currentPlayerDomain || 'enviromentalspace.sbs'}` },
    { Referer: 'https://www.ksohls.ru/', Origin: 'https://www.ksohls.ru' },
  ];

  for (const combo of refererCombos) {
    try {
      const res = await fetchUrl(m3u8Url, { headers: combo, timeout: 8000 });
      const isM3U8 = res.body.includes('#EXTM3U') || res.body.includes('#EXT-X-');

      if (res.status === 200 && isM3U8) {
        ok(4, `M3U8 fetched (Referer: ${combo.Referer})`, res.ms, `${res.body.length} bytes`);
        if (!m3u8Body) m3u8Body = res.body;

        // Parse key URI
        const keyMatch = res.body.match(/URI="([^"]+)"/);
        if (keyMatch) {
          keyUri = keyMatch[1];
          ok(4, `  Key URI: ${keyUri}`);
        } else {
          warn(4, '  No key URI in M3U8', 'Stream may be unencrypted or use different key method');
        }

        // Parse segment URLs
        const segMatch = res.body.match(/^(https?:\/\/[^\s]+\.ts[^\s]*)/m)
          || res.body.match(/^([^\s#][^\s]*\.ts[^\s]*)/m);
        if (segMatch) {
          segmentUrl = segMatch[1];
          ok(4, `  Segment: ${segmentUrl.substring(0, 80)}...`);
        }

        // Show first few lines
        const lines = res.body.split('\n').slice(0, 12);
        console.log(`  M3U8 preview:`);
        lines.forEach(l => console.log(`    ${l}`));
        break; // success, stop trying combos
      } else {
        fail(4, `M3U8 (Referer: ${combo.Referer})`, `HTTP ${res.status}, isM3U8=${isM3U8}`, res.ms);
        if (res.body.length < 500) console.log(`    Body: ${res.body.substring(0, 300)}`);
      }
    } catch (e) { fail(4, `M3U8 (Referer: ${combo.Referer})`, e.message, e.ms); }
  }

  // Also try ai.the-sunmoon.site direct
  if (!m3u8Body) {
    for (const server of M3U8_SERVERS) {
      try {
        const altUrl = `https://${server}/hls/${channelKey}/mono.m3u8`;
        const res = await fetchUrl(altUrl, {
          headers: { 'Referer': 'https://enviromentalspace.sbs/', 'Origin': 'https://enviromentalspace.sbs' },
          timeout: 8000,
        });
        if (res.status === 200 && (res.body.includes('#EXTM3U') || res.body.includes('#EXT-X-'))) {
          ok(4, `M3U8 from ${server} (alt path)`, res.ms, `${res.body.length} bytes`);
          m3u8Body = res.body;
          const keyMatch = res.body.match(/URI="([^"]+)"/);
          if (keyMatch) keyUri = keyMatch[1];
        } else {
          warn(4, `${server} alt path`, `HTTP ${res.status}`, res.ms);
        }
      } catch (e) { warn(4, `${server} alt path`, e.message, e.ms); }
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // 5. KEY SERVER REACHABILITY
  // ────────────────────────────────────────────────────────────────────────
  console.log('\n─── 5. KEY SERVER REACHABILITY ───');

  const testKeyPath = keyUri || `/key/${channelKey}/1`;

  for (const domain of KEY_DOMAINS) {
    try {
      const url = `https://${domain}${testKeyPath}`;
      const res = await fetchUrl(url, {
        headers: {
          'Referer': 'https://enviromentalspace.sbs/',
          'Origin': 'https://enviromentalspace.sbs',
        },
        timeout: 8000,
      });

      const cors = res.headers['access-control-allow-origin'] || 'not set';
      const ct = res.headers['content-type'] || 'unknown';

      if (res.status === 200) {
        const keyHex = res.raw.slice(0, 16).toString('hex');
        const isFake = ['455806f8', '45c6497', '00000000', 'ffffffff'].some(p => keyHex.startsWith(p));

        if (isFake) {
          warn(5, domain, `Reachable but FAKE key: ${keyHex} (need whitelist)`, res.ms);
        } else {
          ok(5, domain, res.ms, `${res.raw.length} bytes, key=${keyHex}, CORS=${cors}`);
        }
      } else if (res.status === 403) {
        fail(5, domain, `403 Forbidden (Cloudflare?) — CORS=${cors}`, res.ms);
      } else {
        fail(5, domain, `HTTP ${res.status}, CORS=${cors}, CT=${ct}`, res.ms);
      }
    } catch (e) { fail(5, domain, e.message, e.ms); }
  }

  // Also check legacy domain
  try {
    const res = await fetchUrl('https://go.ai-chatx.site/key/premium44/1', { timeout: 5000 });
    fail(5, 'go.ai-chatx.site', `HTTP ${res.status} (should be dead)`, res.ms);
  } catch (e) {
    ok(5, 'go.ai-chatx.site confirmed DEAD', e.ms, e.message.substring(0, 60));
  }

  // ────────────────────────────────────────────────────────────────────────
  // 6. reCAPTCHA v3 BYPASS
  // ────────────────────────────────────────────────────────────────────────
  console.log('\n─── 6. reCAPTCHA v3 BYPASS ───');
  let recaptchaToken = null;

  try {
    // Step 1: Get version
    const t1 = Date.now();
    const apiRes = await fetchUrl('https://www.google.com/recaptcha/api.js?render=explicit', {
      headers: { 'Referer': 'https://enviromentalspace.sbs/' },
    });
    const relIdx = apiRes.body.indexOf('releases/');
    let version = null;
    if (relIdx !== -1) {
      const rest = apiRes.body.substring(relIdx + 9);
      const slash = rest.indexOf('/');
      if (slash > 0 && slash < 60) version = rest.substring(0, slash);
    }
    if (version) {
      ok(6, `reCAPTCHA version: ${version}`, apiRes.ms);
    } else {
      fail(6, 'reCAPTCHA version extraction', 'Could not find releases/ in api.js', apiRes.ms);
    }

    if (version) {
      // Step 2: Anchor
      const pageUrl = `https://enviromentalspace.sbs/premiumtv/daddyhd.php?id=${CHANNEL}`;
      const co = Buffer.from(`https://enviromentalspace.sbs:443`).toString('base64').replace(/=+$/, '') + '.';
      const cb = `cb${Math.floor(Math.random() * 999999)}`;
      const anchorUrl = `https://www.google.com/recaptcha/api2/anchor?ar=1&k=${RECAPTCHA_SITE_KEY}&co=${co}&hl=en&v=${version}&size=invisible&cb=${cb}`;

      const anchorRes = await fetchUrl(anchorUrl, {
        headers: { 'Referer': pageUrl },
      });

      // Extract token
      const tokenMatch = anchorRes.body.match(/id="recaptcha-token"\s+value="([^"]+)"/);
      if (tokenMatch) {
        ok(6, `Anchor token obtained`, anchorRes.ms, `${tokenMatch[1].substring(0, 20)}...`);

        // Step 3: Reload
        const action = `verify_premium${CHANNEL}`;
        const formParams = new URLSearchParams({
          v: version, reason: 'q', c: tokenMatch[1], k: RECAPTCHA_SITE_KEY,
          co: co, hl: 'en', size: 'invisible', chr: '%5B89%2C64%2C27%5D',
          vh: '13599012192', bg: '', sa: action,
        });

        const reloadRes = await fetchUrl(`https://www.google.com/recaptcha/api2/reload?k=${RECAPTCHA_SITE_KEY}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': anchorUrl,
          },
          body: formParams.toString(),
        });

        // Extract rresp
        const rrespMatch = reloadRes.body.match(/\["rresp","([^"]+)"/);
        const uvrespMatch = reloadRes.body.match(/\["uvresp","([^"]+)"/);

        if (rrespMatch && rrespMatch[1].length > 20) {
          recaptchaToken = rrespMatch[1];
          ok(6, `reCAPTCHA solved (rresp)`, reloadRes.ms, `${recaptchaToken.length} chars`);
        } else if (uvrespMatch && uvrespMatch[1].length > 20) {
          recaptchaToken = uvrespMatch[1];
          ok(6, `reCAPTCHA solved (uvresp)`, reloadRes.ms, `${recaptchaToken.length} chars`);
        } else {
          fail(6, 'reCAPTCHA reload', `No rresp/uvresp in response`, reloadRes.ms);
          console.log(`    Preview: ${reloadRes.body.substring(0, 200)}`);
        }
      } else {
        fail(6, 'Anchor page', `No recaptcha-token input found`, anchorRes.ms);
        console.log(`    Preview: ${anchorRes.body.substring(0, 200)}`);
      }
    }
  } catch (e) { fail(6, 'reCAPTCHA bypass', e.message, e.ms); }

  // ────────────────────────────────────────────────────────────────────────
  // 7. VERIFY ENDPOINT
  // ────────────────────────────────────────────────────────────────────────
  console.log('\n─── 7. VERIFY ENDPOINT ───');

  const verifyEndpoints = [
    `https://ai.the-sunmoon.site/verify`,
    `https://chevy.${CDN_DOMAIN}/verify`,
  ];

  for (const verifyUrl of verifyEndpoints) {
    try {
      const body = JSON.stringify({
        'recaptcha-token': recaptchaToken || 'test-invalid-token',
        'channel_id': channelKey,
      });
      const res = await fetchUrl(verifyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://enviromentalspace.sbs',
          'Referer': 'https://enviromentalspace.sbs/',
        },
        body,
        timeout: 10000,
      });

      if (res.status === 200) {
        try {
          const data = JSON.parse(res.body);
          if (data.success) {
            ok(7, `${verifyUrl}`, res.ms, `✅ Whitelist SUCCESS! ${JSON.stringify(data).substring(0, 80)}`);
          } else {
            warn(7, `${verifyUrl}`, `Rejected: ${JSON.stringify(data).substring(0, 100)}`, res.ms);
          }
        } catch {
          warn(7, `${verifyUrl}`, `Non-JSON response: ${res.body.substring(0, 100)}`, res.ms);
        }
      } else {
        fail(7, `${verifyUrl}`, `HTTP ${res.status}`, res.ms);
        console.log(`    Body: ${res.body.substring(0, 200)}`);
      }
    } catch (e) { fail(7, `${verifyUrl}`, e.message, e.ms); }
  }

  // ────────────────────────────────────────────────────────────────────────
  // 8. KEY FETCH WITH V5 AUTH
  // ────────────────────────────────────────────────────────────────────────
  console.log('\n─── 8. KEY FETCH WITH V5 AUTH ───');

  if (authData && keyUri) {
    for (const keyDomain of KEY_DOMAINS) {
      try {
        const fullUrl = `https://${keyDomain}${keyUri}`;

        // Parse resource and keyNumber from keyUri
        const parsed = keyUri.match(/\/key\/([^/]+)\/(\d+)/);
        if (!parsed) {
          fail(8, `Key URI parse`, `Cannot parse: ${keyUri}`);
          continue;
        }
        const [, resource, keyNumber] = parsed;

        // Compute auth headers
        const timestamp = Math.floor(Date.now() / 1000);
        const fingerprint = generateFingerprint();
        const t0 = Date.now();
        const nonce = computePowNonce(resource, keyNumber, timestamp, authData.channelSalt);
        const powMs = Date.now() - t0;
        const keyPath = computeKeyPath(resource, keyNumber, timestamp, fingerprint, authData.channelSalt);

        ok(8, `PoW nonce=${nonce}`, powMs, `threshold=0x1000`);

        const headers = {
          'User-Agent': UA,
          'Accept': '*/*',
          'Origin': 'https://enviromentalspace.sbs',
          'Referer': 'https://enviromentalspace.sbs/',
          'Authorization': `Bearer ${authData.authToken}`,
          'X-Key-Timestamp': timestamp.toString(),
          'X-Key-Nonce': nonce.toString(),
          'X-Key-Path': keyPath,
          'X-Fingerprint': fingerprint,
        };

        const res = await fetchUrl(fullUrl, { headers, timeout: 10000 });

        if (res.status === 200 && res.raw.length === 16) {
          const keyHex = res.raw.toString('hex');
          const isFake = ['455806f8', '45c6497', '00000000', 'ffffffff'].some(p => keyHex.startsWith(p));

          if (isFake) {
            fail(8, `${keyDomain} key`, `FAKE key: ${keyHex} — IP not whitelisted (need reCAPTCHA verify first)`, res.ms);
          } else {
            ok(8, `${keyDomain} REAL KEY`, res.ms, `key=${keyHex} ✅ DECRYPTION WORKS!`);
          }
        } else if (res.status === 200) {
          warn(8, `${keyDomain}`, `Unexpected size: ${res.raw.length} bytes (expected 16)`, res.ms);
          console.log(`    Hex: ${res.raw.toString('hex').substring(0, 64)}`);
        } else {
          fail(8, `${keyDomain}`, `HTTP ${res.status}`, res.ms);
          console.log(`    Body: ${res.body.substring(0, 200)}`);
        }
      } catch (e) { fail(8, `${keyDomain}`, e.message, e.ms); }
    }
  } else {
    if (!authData) fail(8, 'KEY FETCH', 'Skipped — no auth data available');
    if (!keyUri) fail(8, 'KEY FETCH', 'Skipped — no key URI from M3U8');
  }

  // ────────────────────────────────────────────────────────────────────────
  // 9. SEGMENT FETCH
  // ────────────────────────────────────────────────────────────────────────
  console.log('\n─── 9. SEGMENT FETCH ───');

  if (segmentUrl) {
    try {
      // Make sure we have an absolute URL
      let segUrl = segmentUrl;
      if (!segUrl.startsWith('http')) {
        segUrl = `https://chevy.${CDN_DOMAIN}${segUrl.startsWith('/') ? '' : '/'}${segUrl}`;
      }

      const res = await fetchUrl(segUrl, {
        headers: {
          'Referer': 'https://enviromentalspace.sbs/',
          'Origin': 'https://enviromentalspace.sbs',
        },
        timeout: 10000,
      });

      if (res.status === 200) {
        ok(9, `Segment fetched`, res.ms, `${res.raw.length} bytes (${(res.raw.length / 1024).toFixed(1)} KB)`);
        // Check for TS sync byte (0x47)
        if (res.raw[0] === 0x47) {
          ok(9, `  Valid TS segment (sync byte 0x47)`);
        } else {
          warn(9, `  Unexpected first byte: 0x${res.raw[0]?.toString(16)}`, 'May be encrypted or different format');
        }
      } else {
        fail(9, 'Segment fetch', `HTTP ${res.status}`, res.ms);
      }
    } catch (e) { fail(9, 'Segment fetch', e.message, e.ms); }
  } else {
    warn(9, 'Segment fetch', 'Skipped — no segment URL from M3U8');
  }

  // ────────────────────────────────────────────────────────────────────────
  // 10. INFRASTRUCTURE SUMMARY
  // ────────────────────────────────────────────────────────────────────────
  const totalMs = Date.now() - totalStart;

  console.log(`\n╔══════════════════════════════════════════════════════════╗`);
  console.log(`║  RESULTS                                                 ║`);
  console.log(`╚══════════════════════════════════════════════════════════╝`);
  console.log(`  Passed: ${passed}  |  Failed: ${failed}  |  Warned: ${warned}  |  Total time: ${fmt(totalMs)}`);
  console.log('');

  // Print timing summary
  console.log('─── TIMING BREAKDOWN ───');
  const stepNames = {
    1: 'Domain chain',
    2: 'Auth extraction',
    3: 'Server lookup',
    4: 'M3U8 fetch',
    5: 'Key server check',
    6: 'reCAPTCHA bypass',
    7: 'Verify endpoint',
    8: 'Key fetch (auth)',
    9: 'Segment fetch',
  };
  for (let step = 1; step <= 9; step++) {
    const stepResults = results.filter(r => r.step === step);
    const times = stepResults.filter(r => r.ms != null).map(r => r.ms);
    const minMs = times.length ? Math.min(...times) : '-';
    const maxMs = times.length ? Math.max(...times) : '-';
    const passFail = stepResults.filter(r => r.status === 'pass').length + '/' + stepResults.length;
    console.log(`  ${step}. ${(stepNames[step] || '???').padEnd(20)} ${String(minMs).padStart(6)}ms - ${String(maxMs).padStart(6)}ms  (${passFail} ok)`);
  }

  console.log('\n─── CURRENT INFRASTRUCTURE ───');
  console.log(`  Player domain:  ${currentPlayerDomain || '❓ unknown (dlstreams.top iframe not found)'}`);
  console.log(`  Server key:     ${serverKey}`);
  console.log(`  Channel key:    ${channelKey}`);
  console.log(`  Auth method:    ${authData ? 'EPlayerAuth-XOR v5' : '❓ FAILED'}`);
  console.log(`  M3U8 URL:       ${m3u8Url}`);
  console.log(`  Key URI:        ${keyUri || '❓ not found'}`);
  console.log(`  reCAPTCHA:      ${recaptchaToken ? `✅ solved (${recaptchaToken.length} chars)` : '❌ failed'}`);

  if (failed > 0) {
    console.log('\n─── FAILURES REQUIRING ATTENTION ───');
    results.filter(r => r.status === 'fail').forEach(r => {
      console.log(`  [Step ${r.step}] ${r.name}: ${r.reason}`);
    });
  }

  console.log('');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
