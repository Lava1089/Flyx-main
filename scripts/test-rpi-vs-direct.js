#!/usr/bin/env node
/**
 * Side-by-side comparison: DIRECT key fetch vs RPI proxy key fetch
 * Uses the EXACT same headers and timestamp for both.
 * This isolates whether the RPI is corrupting headers or if timing matters.
 */
const crypto = require('crypto');
const fs = require('fs');

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

async function main() {
  const channelId = '51';
  
  // Step 1: Get auth
  console.log('1. Getting auth...');
  const authRes = await fetch(`https://epaly.fun/premiumtv/daddyhd.php?id=${channelId}`, {
    headers: { 'User-Agent': UA, 'Referer': 'https://dlhd.link/' },
  });
  const html = await authRes.text();
  const init = html.match(/EPlayerAuth\.init\s*\(\s*\{([^}]+)\}\s*\)/);
  const authToken = init[1].match(/authToken\s*:\s*["']([^"']+)["']/)[1];
  const channelSalt = init[1].match(/channelSalt\s*:\s*["']([^"']+)["']/)[1];
  console.log(`   Token: ${authToken.substring(0, 40)}...`);

  // Step 2: Get M3U8 to find key URL
  console.log('2. Getting M3U8...');
  const lookup = await (await fetch(`https://chevy.dvalna.ru/server_lookup?channel_id=premium${channelId}`)).json();
  const sk = lookup.server_key;
  const m3u8Url = `https://${sk}new.dvalna.ru/${sk}/premium${channelId}/mono.css`;
  const m3u8Res = await fetch(m3u8Url, {
    headers: { 'User-Agent': UA, 'Origin': 'https://epaly.fun', 'Referer': 'https://epaly.fun/', 'Authorization': `Bearer ${authToken}` },
  });
  const m3u8 = await m3u8Res.text();
  const keyMatch = m3u8.match(/#EXT-X-KEY:METHOD=AES-128,URI="([^"]+)"/);
  const keyUrl = keyMatch[1];
  const keyParts = keyUrl.match(/\/key\/([^/]+)\/(\d+)/);
  const resource = keyParts[1];
  const keyNumber = keyParts[2];
  console.log(`   Key URL: ${keyUrl}`);

  // Step 3: Compute auth headers ONCE (same for both requests)
  const ts = Math.floor(Date.now() / 1000);
  const fp = sha256(UA + '1920x1080' + 'America/New_York' + 'en-US').substring(0, 16);
  const hmacPrefix = hmacSha256(resource, channelSalt);
  let nonce = 0;
  for (let n = 0; n < 100000; n++) {
    if (parseInt(md5(hmacPrefix + resource + keyNumber + ts + n).substring(0, 4), 16) < 0x1000) { nonce = n; break; }
  }
  const keyPath = hmacSha256(`${resource}|${keyNumber}|${ts}|${fp}`, channelSalt).substring(0, 16);

  const upstreamHeaders = {
    'User-Agent': UA,
    'Accept': '*/*',
    'Origin': 'https://epaly.fun',
    'Referer': 'https://epaly.fun/',
    'Authorization': `Bearer ${authToken}`,
    'X-Key-Timestamp': String(ts),
    'X-Key-Nonce': String(nonce),
    'X-Key-Path': keyPath,
    'X-Fingerprint': fp,
  };

  console.log('\n3. Auth headers (shared):');
  for (const [k, v] of Object.entries(upstreamHeaders)) {
    if (k === 'User-Agent') continue;
    const display = k === 'Authorization' ? v.substring(0, 50) + '...' : v;
    console.log(`   ${k}: ${display}`);
  }

  // Step 4: DIRECT fetch
  console.log('\n4. DIRECT key fetch...');
  const t1 = Date.now();
  const directRes = await fetch(keyUrl, { headers: upstreamHeaders });
  const directBuf = Buffer.from(await directRes.arrayBuffer());
  const directHex = directBuf.toString('hex');
  const directTime = Date.now() - t1;
  console.log(`   Status: ${directRes.status}, Size: ${directBuf.length}, Time: ${directTime}ms`);
  console.log(`   Hex: ${directHex}`);
  console.log(`   Fake: ${directHex.startsWith('45c6497') ? 'YES ❌' : 'NO ✅'}`);

  // Step 5: RPI /fetch (Node.js https)
  console.log('\n5. RPI /fetch (Node.js https)...');
  const params1 = new URLSearchParams({ url: keyUrl, headers: JSON.stringify(upstreamHeaders), key: API_KEY });
  const t2 = Date.now();
  const rpi1Res = await fetch(`${RPI_URL}/fetch?${params1}`, {
    headers: { 'X-API-Key': API_KEY },
    signal: AbortSignal.timeout(20000),
  });
  const rpi1Buf = Buffer.from(await rpi1Res.arrayBuffer());
  const rpi1Hex = rpi1Buf.toString('hex');
  const rpi1Time = Date.now() - t2;
  console.log(`   Status: ${rpi1Res.status}, Size: ${rpi1Buf.length}, Time: ${rpi1Time}ms`);
  console.log(`   Proxied-By: ${rpi1Res.headers.get('x-proxied-by')}`);
  console.log(`   Upstream-Status: ${rpi1Res.headers.get('x-upstream-status')}`);
  console.log(`   Hex: ${rpi1Hex.substring(0, 64)}`);
  if (rpi1Buf.length > 100) {
    console.log(`   Text: ${rpi1Buf.toString('utf8').substring(0, 200)}`);
  }
  console.log(`   Fake: ${rpi1Hex.startsWith('45c6497') ? 'YES ❌' : 'NO'}`);

  // Step 6: RPI /fetch-impersonate (curl_chrome116)
  console.log('\n6. RPI /fetch-impersonate (curl_chrome116)...');
  // Recompute headers with fresh timestamp since time has passed
  const ts2 = Math.floor(Date.now() / 1000);
  let nonce2 = 0;
  for (let n = 0; n < 100000; n++) {
    if (parseInt(md5(hmacPrefix + resource + keyNumber + ts2 + n).substring(0, 4), 16) < 0x1000) { nonce2 = n; break; }
  }
  const keyPath2 = hmacSha256(`${resource}|${keyNumber}|${ts2}|${fp}`, channelSalt).substring(0, 16);
  const upstreamHeaders2 = { ...upstreamHeaders, 'X-Key-Timestamp': String(ts2), 'X-Key-Nonce': String(nonce2), 'X-Key-Path': keyPath2 };

  const params2 = new URLSearchParams({ url: keyUrl, headers: JSON.stringify(upstreamHeaders2), key: API_KEY });
  const t3 = Date.now();
  const rpi2Res = await fetch(`${RPI_URL}/fetch-impersonate?${params2}`, {
    headers: { 'X-API-Key': API_KEY },
    signal: AbortSignal.timeout(20000),
  });
  const rpi2Buf = Buffer.from(await rpi2Res.arrayBuffer());
  const rpi2Hex = rpi2Buf.toString('hex');
  const rpi2Time = Date.now() - t3;
  console.log(`   Status: ${rpi2Res.status}, Size: ${rpi2Buf.length}, Time: ${rpi2Time}ms`);
  console.log(`   Proxied-By: ${rpi2Res.headers.get('x-proxied-by')}`);
  console.log(`   Upstream-Status: ${rpi2Res.headers.get('x-upstream-status')}`);
  console.log(`   Hex: ${rpi2Hex.substring(0, 64)}`);
  if (rpi2Buf.length > 100) {
    console.log(`   Text: ${rpi2Buf.toString('utf8').substring(0, 200)}`);
  }
  console.log(`   Fake: ${rpi2Hex.startsWith('45c6497') ? 'YES ❌' : 'NO'}`);

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`Direct:           ${directHex.startsWith('45c6497') ? '❌ FAKE' : '✅ REAL'} (${directTime}ms)`);
  console.log(`RPI /fetch:       ${rpi1Hex.startsWith('45c6497') ? '❌ FAKE' : rpi1Buf.length === 16 ? '✅ REAL' : '⚠️ ' + rpi1Buf.length + 'b'} (${rpi1Time}ms)`);
  console.log(`RPI /fetch-imp:   ${rpi2Hex.startsWith('45c6497') ? '❌ FAKE' : rpi2Buf.length === 16 ? '✅ REAL' : '⚠️ ' + rpi2Buf.length + 'b'} (${rpi2Time}ms)`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
