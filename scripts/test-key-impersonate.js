#!/usr/bin/env node
/**
 * Test key fetch via RPI /fetch-impersonate (curl_chrome116 TLS fingerprint bypass)
 * vs /fetch (Node.js https) to prove TLS fingerprinting is the issue.
 * 
 * Also tests with corrected auth: NO timestamp offset (matching browser behavior).
 */
const crypto = require('crypto');
const fs = require('fs');

// Load .env.local
try {
  const envFile = fs.readFileSync('.env.local', 'utf8');
  for (const line of envFile.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.substring(0, eq).trim();
    let v = t.substring(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
} catch {}

const RPI_URL = process.env.RPI_PROXY_URL;
const API_KEY = process.env.RPI_PROXY_KEY;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function md5(s) { return crypto.createHash('md5').update(s).digest('hex'); }
function hmacSha256(d, k) { return crypto.createHmac('sha256', k).update(d).digest('hex'); }
function sha256(d) { return crypto.createHash('sha256').update(d).digest('hex'); }
function fingerprint() { return sha256(UA + '1920x1080' + 'America/New_York' + 'en-US').substring(0, 16); }

function computePow(ck, kn, ts, salt) {
  const hp = hmacSha256(ck, salt);
  for (let n = 0; n < 100000; n++) {
    if (parseInt(md5(hp + ck + kn + ts + n).substring(0, 4), 16) < 0x1000) return n;
  }
  return 99999;
}

function computeKeyPath(res, kn, ts, fp, salt) {
  return hmacSha256(`${res}|${kn}|${ts}|${fp}`, salt).substring(0, 16);
}

const FAKE_KEY_PATTERNS = ['45c6497', '455806f8', '00000000000000000000000000000000'];

function isLikelyFakeKey(hex) {
  return FAKE_KEY_PATTERNS.some(p => hex.startsWith(p)) || hex.startsWith('6572726f72');
}

async function fetchAuth(channelId) {
  const endpoints = [
    `https://epaly.fun/premiumtv/daddyhd.php?id=${channelId}`,
    `https://hitsplay.fun/premiumtv/daddyhd.php?id=${channelId}`,
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Referer': 'https://dlhd.link/' },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      const init = html.match(/EPlayerAuth\.init\s*\(\s*\{([^}]+)\}\s*\)/);
      if (!init) continue;
      const authToken = init[1].match(/authToken\s*:\s*["']([^"']+)["']/)?.[1];
      const channelSalt = init[1].match(/channelSalt\s*:\s*["']([^"']+)["']/)?.[1];
      const channelKey = init[1].match(/channelKey\s*:\s*["']([^"']+)["']/)?.[1] || `premium${channelId}`;
      if (authToken && channelSalt) return { authToken, channelSalt, channelKey };
    } catch {}
  }
  return null;
}

async function fetchServerLookup(channelKey) {
  try {
    const res = await fetch(`https://chevy.dvalna.ru/server_lookup?channel_id=${encodeURIComponent(channelKey)}`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function fetchKey(route, keyUrl, upstreamHeaders) {
  const params = new URLSearchParams({
    url: keyUrl,
    headers: JSON.stringify(upstreamHeaders),
    key: API_KEY,
  });

  const res = await fetch(`${RPI_URL}/${route}?${params}`, {
    headers: { 'X-API-Key': API_KEY },
    signal: AbortSignal.timeout(20000),
  });

  const buf = await res.arrayBuffer();
  const hex = Buffer.from(buf).toString('hex');
  const text = Buffer.from(buf).toString('utf8');
  const upstream = res.headers.get('x-upstream-status');
  const proxiedBy = res.headers.get('x-proxied-by') || '';

  return { status: res.status, upstream, hex, text, size: buf.byteLength, proxiedBy, buf };
}

async function main() {
  const channelId = process.argv[2] || '51';
  console.log(`\n=== DLHD Key Fetch: /fetch vs /fetch-impersonate ===`);
  console.log(`Channel: ${channelId}`);
  console.log(`RPI: ${RPI_URL}`);
  console.log(`API Key: ${API_KEY ? API_KEY.substring(0, 8) + '...' : 'NOT SET'}\n`);

  // Step 1: Auth
  console.log('1. Fetching auth data...');
  const auth = await fetchAuth(channelId);
  if (!auth) { console.error('FATAL: No auth data'); process.exit(1); }
  console.log(`   ✅ Token: ${auth.authToken.substring(0, 40)}...`);
  console.log(`   ✅ Salt:  ${auth.channelSalt.substring(0, 16)}...`);

  // Step 2: Server lookup (like the browser does)
  console.log('\n2. Server lookup...');
  const lookup = await fetchServerLookup(auth.channelKey);
  if (!lookup) { console.error('FATAL: Server lookup failed'); process.exit(1); }
  console.log(`   ✅ server_key: ${lookup.server_key}`);

  const sk = lookup.server_key;
  const m3u8Url = (sk === 'top1/cdn')
    ? `https://top1.dvalna.ru/top1/cdn/${auth.channelKey}/mono.css`
    : `https://${sk}new.dvalna.ru/${sk}/${auth.channelKey}/mono.css`;
  console.log(`   M3U8: ${m3u8Url}`);

  // Step 3: Fetch M3U8
  console.log('\n3. Fetching M3U8...');
  const m3u8Res = await fetch(m3u8Url, {
    headers: {
      'User-Agent': UA, 'Accept': '*/*',
      'Origin': 'https://epaly.fun', 'Referer': 'https://epaly.fun/',
      'Authorization': `Bearer ${auth.authToken}`,
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!m3u8Res.ok) { console.error(`   ❌ M3U8 HTTP ${m3u8Res.status}`); process.exit(1); }
  const m3u8 = await m3u8Res.text();
  if (!m3u8.includes('#EXTM3U')) { console.error('   ❌ Not valid M3U8'); process.exit(1); }

  const keyMatch = m3u8.match(/#EXT-X-KEY:METHOD=AES-128,URI="([^"]+)"(?:,IV=0x([a-fA-F0-9]+))?/);
  if (!keyMatch) { console.log('   ✅ M3U8 OK (unencrypted — no key needed)'); process.exit(0); }

  const keyUri = keyMatch[1];
  const iv = keyMatch[2] || null;
  const basePath = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);
  const keyUrl = keyUri.startsWith('http') ? keyUri : basePath + keyUri;
  console.log(`   ✅ M3U8 OK`);
  console.log(`   Key URL: ${keyUrl}`);

  // Extract resource and keyNumber from key URL
  const keyParts = keyUrl.match(/\/key\/([^/]+)\/(\d+)/);
  if (!keyParts) { console.error('   ❌ Cannot parse key URL'); process.exit(1); }
  const resource = keyParts[1];
  const keyNumber = keyParts[2];

  // Step 4: Build auth headers (NO timestamp offset — matching browser)
  console.log('\n4. Computing auth headers (NO offset — matching browser)...');
  const ts = Math.floor(Date.now() / 1000); // NO OFFSET
  const fp = fingerprint();
  const nonce = computePow(resource, keyNumber, ts, auth.channelSalt);
  const kp = computeKeyPath(resource, keyNumber, ts, fp, auth.channelSalt);

  const upstreamHeaders = {
    'User-Agent': UA, 'Accept': '*/*',
    'Origin': 'https://epaly.fun', 'Referer': 'https://epaly.fun/',
    'Authorization': `Bearer ${auth.authToken}`,
    'X-Key-Timestamp': String(ts),
    'X-Key-Nonce': String(nonce),
    'X-Key-Path': kp,
    'X-Fingerprint': fp,
  };
  console.log(`   Timestamp: ${ts} (current, no offset)`);
  console.log(`   Nonce: ${nonce}`);
  console.log(`   KeyPath: ${kp}`);
  console.log(`   Fingerprint: ${fp}`);
  console.log(`   Origin: https://epaly.fun`);

  // Step 5: Test both routes
  console.log('\n5. Testing key fetch via both routes...\n');

  const routes = ['fetch-impersonate', 'fetch'];
  const results = {};

  for (const route of routes) {
    console.log(`   --- /${route} ---`);
    try {
      const r = await fetchKey(route, keyUrl, upstreamHeaders);
      const fake = isLikelyFakeKey(r.hex);
      const label = fake ? '❌ FAKE' : (r.size === 16 ? '✅ REAL' : `⚠️ ${r.size}b`);
      console.log(`   ${label} | status=${r.status} upstream=${r.upstream} size=${r.size} via=${r.proxiedBy}`);
      console.log(`   hex: ${r.hex.substring(0, 32)}${r.text.startsWith('error') || r.text.startsWith('{') ? ' (' + r.text.substring(0, 60) + ')' : ''}`);
      results[route] = { ...r, fake };
    } catch (e) {
      console.log(`   ❌ Error: ${e.message}`);
      results[route] = { error: e.message };
    }
    // Small delay between requests
    await new Promise(r => setTimeout(r, 1000));
  }

  // Step 6: If we got a real key, test decryption
  const realRoute = routes.find(r => results[r] && !results[r].fake && results[r].size === 16);
  if (realRoute) {
    console.log(`\n6. Testing segment decryption with key from /${realRoute}...`);
    const segLines = m3u8.split('\n').filter(l => l.trim() && !l.startsWith('#'));
    const firstSeg = segLines[0];
    if (!firstSeg) { console.log('   No segments'); process.exit(0); }
    const segUrl = firstSeg.startsWith('http') ? firstSeg.trim() : basePath + firstSeg.trim();

    const segRes = await fetch(segUrl, {
      headers: { 'User-Agent': UA, 'Referer': 'https://epaly.fun/', 'Origin': 'https://epaly.fun' },
      signal: AbortSignal.timeout(15000),
    });

    if (!segRes.ok) { console.log(`   ❌ Segment HTTP ${segRes.status}`); process.exit(1); }
    const segBuf = Buffer.from(await segRes.arrayBuffer());
    console.log(`   Segment: ${segBuf.length} bytes`);

    const key = Buffer.from(results[realRoute].hex, 'hex');
    let ivBuf = iv ? Buffer.from(iv.padStart(32, '0'), 'hex') : Buffer.alloc(16, 0);

    try {
      const decipher = crypto.createDecipheriv('aes-128-cbc', key, ivBuf);
      decipher.setAutoPadding(false);
      const decrypted = Buffer.concat([decipher.update(segBuf), decipher.final()]);
      const sync = decrypted[0] === 0x47;
      console.log(`   Decrypted: ${decrypted.length} bytes, first: ${decrypted.slice(0, 8).toString('hex')}`);
      console.log(`   TS sync (0x47): ${sync ? '✅ YES' : '⚠️ NO'}`);
      console.log(`\n   ${sync ? '🎉 FULL PIPELINE PASS!' : '⚠️ Decrypted but no TS sync'}`);
    } catch (e) {
      console.log(`   ❌ Decrypt error: ${e.message}`);
    }
  } else {
    console.log('\n6. ❌ No real key obtained from either route.');
    console.log('\n=== DIAGNOSIS ===');
    if (results['fetch-impersonate']?.error?.includes('fetch')) {
      console.log('curl-impersonate may not be installed on the RPI.');
      console.log('SSH into the RPI and run: bash install-curl-impersonate.sh');
    } else if (results['fetch-impersonate']?.fake && results['fetch']?.fake) {
      console.log('Both routes returned fake keys. Possible causes:');
      console.log('  1. curl-impersonate not installed (check x-proxied-by header)');
      console.log('  2. Auth headers are wrong (salt/token expired?)');
      console.log('  3. IP is rate-limited (wait and retry)');
    }
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
