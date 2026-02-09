#!/usr/bin/env node
/**
 * Test DIRECT key fetch (no RPI) + segment decrypt to prove auth is correct.
 * If this works, the problem is RPI-specific (IP reputation, not auth).
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

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const RPI_URL = process.env.RPI_PROXY_URL;
const API_KEY = process.env.RPI_PROXY_KEY;

function md5(s) { return crypto.createHash('md5').update(s).digest('hex'); }
function hmacSha256(d, k) { return crypto.createHmac('sha256', k).update(d).digest('hex'); }
function sha256(d) { return crypto.createHash('sha256').update(d).digest('hex'); }
function fingerprint() { return sha256(UA + '1920x1080' + 'America/New_York' + 'en-US').substring(0, 16); }

function computeAuthHeaders(resource, keyNumber, channelSalt, authToken) {
  const ts = Math.floor(Date.now() / 1000);
  const fp = fingerprint();
  const hmacPrefix = hmacSha256(resource, channelSalt);
  let nonce = 0;
  for (let n = 0; n < 100000; n++) {
    if (parseInt(md5(hmacPrefix + resource + keyNumber + ts + n).substring(0, 4), 16) < 0x1000) { nonce = n; break; }
  }
  const keyPath = hmacSha256(`${resource}|${keyNumber}|${ts}|${fp}`, channelSalt).substring(0, 16);
  return {
    'User-Agent': UA, 'Accept': '*/*',
    'Origin': 'https://epaly.fun', 'Referer': 'https://epaly.fun/',
    'Authorization': `Bearer ${authToken}`,
    'X-Key-Timestamp': String(ts), 'X-Key-Nonce': String(nonce),
    'X-Key-Path': keyPath, 'X-Fingerprint': fp,
  };
}

async function testChannel(channelId) {
  console.log(`\n=== Channel ${channelId} ===`);

  // Auth
  const authRes = await fetch(`https://epaly.fun/premiumtv/daddyhd.php?id=${channelId}`, {
    headers: { 'User-Agent': UA, 'Referer': 'https://dlhd.link/' },
    signal: AbortSignal.timeout(10000),
  });
  if (!authRes.ok) { console.log(`  ❌ Auth HTTP ${authRes.status}`); return false; }
  const html = await authRes.text();
  const init = html.match(/EPlayerAuth\.init\s*\(\s*\{([^}]+)\}\s*\)/);
  if (!init) { console.log('  ❌ No EPlayerAuth'); return false; }
  const authToken = init[1].match(/authToken\s*:\s*["']([^"']+)["']/)?.[1];
  const channelSalt = init[1].match(/channelSalt\s*:\s*["']([^"']+)["']/)?.[1];
  const channelKey = init[1].match(/channelKey\s*:\s*["']([^"']+)["']/)?.[1] || `premium${channelId}`;
  if (!authToken || !channelSalt) { console.log('  ❌ Missing auth data'); return false; }
  console.log(`  Auth: ✅`);

  // Server lookup
  const lookup = await (await fetch(`https://chevy.dvalna.ru/server_lookup?channel_id=${channelKey}`, {
    headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000),
  })).json();
  const sk = lookup.server_key;
  console.log(`  Server: ${sk}`);

  const m3u8Url = (sk === 'top1/cdn')
    ? `https://top1.dvalna.ru/top1/cdn/${channelKey}/mono.css`
    : `https://${sk}new.dvalna.ru/${sk}/${channelKey}/mono.css`;

  // M3U8
  const m3u8Res = await fetch(m3u8Url, {
    headers: { 'User-Agent': UA, 'Origin': 'https://epaly.fun', 'Referer': 'https://epaly.fun/', 'Authorization': `Bearer ${authToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!m3u8Res.ok) { console.log(`  ❌ M3U8 HTTP ${m3u8Res.status}`); return false; }
  const m3u8 = await m3u8Res.text();
  if (!m3u8.includes('#EXTM3U')) { console.log('  ❌ Invalid M3U8'); return false; }

  const keyMatch = m3u8.match(/#EXT-X-KEY:METHOD=AES-128,URI="([^"]+)"(?:,IV=0x([a-fA-F0-9]+))?/);
  if (!keyMatch) { console.log('  ✅ Unencrypted stream'); return true; }

  const keyUrl = keyMatch[1];
  const iv = keyMatch[2];
  const keyParts = keyUrl.match(/\/key\/([^/]+)\/(\d+)/);
  if (!keyParts) { console.log('  ❌ Bad key URL'); return false; }

  // DIRECT key fetch
  const headers = computeAuthHeaders(keyParts[1], keyParts[2], channelSalt, authToken);
  const keyRes = await fetch(keyUrl, { headers, signal: AbortSignal.timeout(10000) });
  const keyBuf = Buffer.from(await keyRes.arrayBuffer());
  const keyHex = keyBuf.toString('hex');
  const isFake = keyHex.startsWith('45c6497') || keyHex.startsWith('455806f8');
  console.log(`  Direct key: ${keyHex} (${keyBuf.length}b) ${isFake ? '❌ FAKE' : '✅'}`);
  if (isFake || keyBuf.length !== 16) return false;

  // RPI key fetch for comparison
  if (RPI_URL && API_KEY) {
    const rpiHeaders = computeAuthHeaders(keyParts[1], keyParts[2], channelSalt, authToken);
    const params = new URLSearchParams({ url: keyUrl, headers: JSON.stringify(rpiHeaders), key: API_KEY });
    try {
      const rpiRes = await fetch(`${RPI_URL}/fetch-impersonate?${params}`, {
        headers: { 'X-API-Key': API_KEY }, signal: AbortSignal.timeout(20000),
      });
      const rpiBuf = Buffer.from(await rpiRes.arrayBuffer());
      const rpiHex = rpiBuf.toString('hex');
      const rpiFake = rpiHex.startsWith('45c6497') || rpiHex.startsWith('455806f8');
      console.log(`  RPI key:    ${rpiHex} (${rpiBuf.length}b) ${rpiFake ? '❌ FAKE' : '✅'} via=${rpiRes.headers.get('x-proxied-by')}`);
    } catch (e) {
      console.log(`  RPI key:    ❌ Error: ${e.message}`);
    }
  }

  // Segment decrypt with DIRECT key
  const basePath = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);
  const segLines = m3u8.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  const segUrl = segLines[0].startsWith('http') ? segLines[0].trim() : basePath + segLines[0].trim();

  const segRes = await fetch(segUrl, {
    headers: { 'User-Agent': UA, 'Origin': 'https://epaly.fun', 'Referer': 'https://epaly.fun/' },
    signal: AbortSignal.timeout(15000),
  });
  if (!segRes.ok) { console.log(`  ❌ Segment HTTP ${segRes.status}`); return false; }
  const segBuf = Buffer.from(await segRes.arrayBuffer());

  const ivBuf = iv ? Buffer.from(iv.padStart(32, '0'), 'hex') : Buffer.alloc(16, 0);
  try {
    const decipher = crypto.createDecipheriv('aes-128-cbc', keyBuf, ivBuf);
    decipher.setAutoPadding(false);
    const dec = Buffer.concat([decipher.update(segBuf), decipher.final()]);
    const sync = dec[0] === 0x47;
    console.log(`  Decrypt: ${dec.length}b, sync=0x${dec[0].toString(16)} ${sync ? '✅ PASS' : '❌ FAIL'}`);
    return sync;
  } catch (e) {
    console.log(`  ❌ Decrypt error: ${e.message}`);
    return false;
  }
}

async function main() {
  const channels = process.argv.slice(2);
  if (channels.length === 0) {
    // Test a variety of channels
    channels.push('51', '44', '35', '40', '31', '43', '130');
  }

  console.log('Testing DIRECT key fetch (from this machine) + RPI comparison');
  console.log('If DIRECT works but RPI fails, the issue is RPI IP reputation.\n');

  let pass = 0, fail = 0;
  for (const ch of channels) {
    try {
      const ok = await testChannel(ch);
      if (ok) pass++; else fail++;
    } catch (e) {
      console.log(`  ❌ Error: ${e.message}`);
      fail++;
    }
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n=== RESULTS: ${pass} pass, ${fail} fail out of ${channels.length} ===`);
  if (pass > 0 && fail === 0) {
    console.log('All channels working with DIRECT fetch!');
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
