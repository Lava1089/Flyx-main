#!/usr/bin/env node
/**
 * Single key fetch through RPI - minimal test after rate limit reset.
 * Also logs the EXACT URL being sent to the RPI to check for encoding issues.
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
  // Get fresh auth
  const authRes = await fetch(`https://epaly.fun/premiumtv/daddyhd.php?id=51`, {
    headers: { 'User-Agent': UA, 'Referer': 'https://dlhd.link/' },
  });
  const html = await authRes.text();
  const init = html.match(/EPlayerAuth\.init\s*\(\s*\{([^}]+)\}\s*\)/);
  const authToken = init[1].match(/authToken\s*:\s*["']([^"']+)["']/)[1];
  const channelSalt = init[1].match(/channelSalt\s*:\s*["']([^"']+)["']/)[1];

  // Get M3U8
  const lookup = await (await fetch('https://chevy.dvalna.ru/server_lookup?channel_id=premium51')).json();
  const sk = lookup.server_key;
  const m3u8Url = `https://${sk}new.dvalna.ru/${sk}/premium51/mono.css`;
  const m3u8Res = await fetch(m3u8Url, {
    headers: { 'User-Agent': UA, 'Origin': 'https://epaly.fun', 'Referer': 'https://epaly.fun/', 'Authorization': `Bearer ${authToken}` },
  });
  const m3u8 = await m3u8Res.text();
  const keyMatch = m3u8.match(/#EXT-X-KEY:METHOD=AES-128,URI="([^"]+)"/);
  const keyUrl = keyMatch[1];
  const keyParts = keyUrl.match(/\/key\/([^/]+)\/(\d+)/);
  const resource = keyParts[1];
  const keyNumber = keyParts[2];

  // Compute headers
  const ts = Math.floor(Date.now() / 1000);
  const fp = sha256(UA + '1920x1080' + 'America/New_York' + 'en-US').substring(0, 16);
  const hmacPrefix = hmacSha256(resource, channelSalt);
  let nonce = 0;
  for (let n = 0; n < 100000; n++) {
    if (parseInt(md5(hmacPrefix + resource + keyNumber + ts + n).substring(0, 4), 16) < 0x1000) { nonce = n; break; }
  }
  const keyPath = hmacSha256(`${resource}|${keyNumber}|${ts}|${fp}`, channelSalt).substring(0, 16);

  const upstreamHeaders = {
    'User-Agent': UA, 'Accept': '*/*',
    'Origin': 'https://epaly.fun', 'Referer': 'https://epaly.fun/',
    'Authorization': `Bearer ${authToken}`,
    'X-Key-Timestamp': String(ts), 'X-Key-Nonce': String(nonce),
    'X-Key-Path': keyPath, 'X-Fingerprint': fp,
  };

  console.log('Key URL:', keyUrl);
  console.log('Timestamp:', ts);
  console.log('Headers JSON length:', JSON.stringify(upstreamHeaders).length);

  // Test 1: Direct
  console.log('\n--- DIRECT ---');
  const d = await fetch(keyUrl, { headers: upstreamHeaders });
  const dBuf = Buffer.from(await d.arrayBuffer());
  console.log(`Status: ${d.status}, Size: ${dBuf.length}, Hex: ${dBuf.toString('hex')}`);

  // Wait 1s
  await new Promise(r => setTimeout(r, 1000));

  // Test 2: RPI /fetch-impersonate (recompute timestamp)
  console.log('\n--- RPI /fetch-impersonate ---');
  const ts2 = Math.floor(Date.now() / 1000);
  let nonce2 = 0;
  for (let n = 0; n < 100000; n++) {
    if (parseInt(md5(hmacPrefix + resource + keyNumber + ts2 + n).substring(0, 4), 16) < 0x1000) { nonce2 = n; break; }
  }
  const keyPath2 = hmacSha256(`${resource}|${keyNumber}|${ts2}|${fp}`, channelSalt).substring(0, 16);
  const h2 = { ...upstreamHeaders, 'X-Key-Timestamp': String(ts2), 'X-Key-Nonce': String(nonce2), 'X-Key-Path': keyPath2 };

  const params = new URLSearchParams({ url: keyUrl, headers: JSON.stringify(h2), key: API_KEY });
  const rpiUrl = `${RPI_URL}/fetch-impersonate?${params}`;
  
  // Log the full URL length to check for truncation
  console.log('RPI request URL length:', rpiUrl.length);
  
  const r = await fetch(rpiUrl, {
    headers: { 'X-API-Key': API_KEY },
    signal: AbortSignal.timeout(20000),
  });
  const rBuf = Buffer.from(await r.arrayBuffer());
  console.log(`Status: ${r.status}, Size: ${rBuf.length}`);
  console.log(`Proxied-By: ${r.headers.get('x-proxied-by')}`);
  console.log(`Upstream-Status: ${r.headers.get('x-upstream-status')}`);
  console.log(`Hex: ${rBuf.toString('hex').substring(0, 64)}`);
  if (rBuf.length > 16) {
    console.log(`Text: ${rBuf.toString('utf8').substring(0, 200)}`);
  }
  console.log(`Fake: ${rBuf.toString('hex').startsWith('45c6497') ? 'YES ❌' : 'NO'}`);

  // Test 3: RPI /fetch (Node.js) with fresh timestamp
  console.log('\n--- RPI /fetch (Node.js) ---');
  await new Promise(r => setTimeout(r, 1000));
  const ts3 = Math.floor(Date.now() / 1000);
  let nonce3 = 0;
  for (let n = 0; n < 100000; n++) {
    if (parseInt(md5(hmacPrefix + resource + keyNumber + ts3 + n).substring(0, 4), 16) < 0x1000) { nonce3 = n; break; }
  }
  const keyPath3 = hmacSha256(`${resource}|${keyNumber}|${ts3}|${fp}`, channelSalt).substring(0, 16);
  const h3 = { ...upstreamHeaders, 'X-Key-Timestamp': String(ts3), 'X-Key-Nonce': String(nonce3), 'X-Key-Path': keyPath3 };

  const params3 = new URLSearchParams({ url: keyUrl, headers: JSON.stringify(h3), key: API_KEY });
  const r3 = await fetch(`${RPI_URL}/fetch?${params3}`, {
    headers: { 'X-API-Key': API_KEY },
    signal: AbortSignal.timeout(20000),
  });
  const r3Buf = Buffer.from(await r3.arrayBuffer());
  console.log(`Status: ${r3.status}, Size: ${r3Buf.length}`);
  console.log(`Proxied-By: ${r3.headers.get('x-proxied-by')}`);
  console.log(`Upstream-Status: ${r3.headers.get('x-upstream-status')}`);
  console.log(`Hex: ${r3Buf.toString('hex').substring(0, 64)}`);
  if (r3Buf.length > 16) {
    console.log(`Text: ${r3Buf.toString('utf8').substring(0, 200)}`);
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
