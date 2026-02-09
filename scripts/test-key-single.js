#!/usr/bin/env node
/**
 * Test a single key fetch via RPI /fetch with multiple timestamp offsets.
 * Helps diagnose whether the issue is rate limiting, auth, or timing.
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

async function main() {
  const channelId = process.argv[2] || '51';
  console.log(`Testing key fetch for channel ${channelId}`);
  console.log(`RPI: ${RPI_URL}`);
  console.log(`Key: ${API_KEY ? API_KEY.substring(0, 8) + '...' : 'NOT SET'}\n`);

  // Step 1: Auth
  console.log('1. Fetching auth data...');
  const endpoints = [
    `https://epaly.fun/premiumtv/daddyhd.php?id=${channelId}`,
    `https://hitsplay.fun/premiumtv/daddyhd.php?id=${channelId}`,
  ];

  let authToken, channelSalt, channelKey;
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Referer': 'https://dlhd.link/' },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) { console.log(`   ${url} → HTTP ${res.status}`); continue; }
      const html = await res.text();
      const init = html.match(/EPlayerAuth\.init\s*\(\s*\{([^}]+)\}\s*\)/);
      if (!init) { console.log(`   ${url} → No EPlayerAuth`); continue; }
      authToken = init[1].match(/authToken\s*:\s*["']([^"']+)["']/)?.[1];
      channelSalt = init[1].match(/channelSalt\s*:\s*["']([^"']+)["']/)?.[1];
      channelKey = init[1].match(/channelKey\s*:\s*["']([^"']+)["']/)?.[1] || `premium${channelId}`;
      if (authToken && channelSalt) {
        console.log(`   ✅ Auth from ${url.includes('codepcplay') ? 'codepcplay' : 'hitsplay'}`);
        console.log(`   Token: ${authToken.substring(0, 40)}...`);
        console.log(`   Salt:  ${channelSalt.substring(0, 16)}...`);
        break;
      }
    } catch (e) {
      console.log(`   ${url} → Error: ${e.message}`);
    }
  }

  if (!authToken || !channelSalt) {
    console.error('FATAL: Could not get auth data');
    process.exit(1);
  }

  // Step 2: M3U8
  console.log('\n2. Fetching M3U8...');
  // Determine server from channel
  const serverMap = { '51': 'zeko', '44': 'zeko', '35': 'zeko', '40': 'ddy6', '31': 'nfs', '130': 'dokko1', '43': 'wind' };
  const server = serverMap[channelId] || 'zeko';
  const m3u8Url = `https://${server}new.dvalna.ru/${server}/premium${channelId}/mono.css`;

  const m3u8Res = await fetch(m3u8Url, {
    headers: {
      'User-Agent': UA, 'Accept': '*/*',
      'Referer': 'https://epaly.fun/', 'Origin': 'https://epaly.fun',
      'Authorization': `Bearer ${authToken}`,
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!m3u8Res.ok) {
    console.error(`   ❌ M3U8 HTTP ${m3u8Res.status}`);
    process.exit(1);
  }

  const m3u8 = await m3u8Res.text();
  if (!m3u8.includes('#EXTM3U')) {
    console.error('   ❌ Not a valid M3U8');
    process.exit(1);
  }

  const keyMatch = m3u8.match(/#EXT-X-KEY:METHOD=AES-128,URI="([^"]+)"(?:,IV=0x([a-fA-F0-9]+))?/);
  if (!keyMatch) {
    console.log('   ✅ M3U8 OK (unencrypted)');
    process.exit(0);
  }

  const keyUri = keyMatch[1];
  const iv = keyMatch[2] || null;
  const basePath = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);
  const keyUrl = keyUri.startsWith('http') ? keyUri : basePath + keyUri;
  console.log(`   ✅ M3U8 OK, key URL: ${keyUrl}`);
  console.log(`   IV: ${iv || '(default)'}`);

  // Step 3: Try key fetch with multiple offsets
  console.log('\n3. Fetching key via RPI /fetch (trying multiple offsets)...');
  const resource = keyUrl.match(/\/key\/([^/]+)\//)?.[1];
  const keyNumber = keyUrl.match(/\/key\/[^/]+\/(\d+)/)?.[1];
  console.log(`   Resource: ${resource}, KeyNumber: ${keyNumber}`);

  const offsets = [0, -1, 1, -2, 2, -3, 3, -5, -7, -10];
  let successKey = null;

  for (const offset of offsets) {
    const ts = Math.floor(Date.now() / 1000) + offset;
    const fp = fingerprint();
    const nonce = computePow(resource, keyNumber, ts, channelSalt);
    const kp = computeKeyPath(resource, keyNumber, ts, fp, channelSalt);

    const upstreamHeaders = {
      'User-Agent': UA, 'Accept': '*/*',
      'Origin': 'https://epaly.fun', 'Referer': 'https://epaly.fun/',
      'Authorization': `Bearer ${authToken}`,
      'X-Key-Timestamp': String(ts),
      'X-Key-Nonce': String(nonce),
      'X-Key-Path': kp,
      'X-Fingerprint': fp,
    };

    const params = new URLSearchParams({
      url: keyUrl,
      headers: JSON.stringify(upstreamHeaders),
      key: API_KEY,
    });

    try {
      const res = await fetch(`${RPI_URL}/fetch?${params}`, {
        headers: { 'X-API-Key': API_KEY },
        signal: AbortSignal.timeout(15000),
      });

      const buf = await res.arrayBuffer();
      const hex = Buffer.from(buf).toString('hex');
      const text = Buffer.from(buf).toString('utf8');
      const upstream = res.headers.get('x-upstream-status');

      const isError = hex.startsWith('6572726f72') || hex.startsWith('455806f8') || hex.startsWith('45c6497') || hex === '00000000000000000000000000000000';
      const label = isError ? '❌' : (buf.byteLength === 16 ? '✅' : '⚠️');

      console.log(`   offset=${String(offset).padStart(3)} → ${label} status=${res.status} upstream=${upstream} size=${buf.byteLength} hex=${hex.substring(0, 32)}${text.startsWith('error') ? ' (' + text + ')' : ''}`);

      if (buf.byteLength === 16 && !isError) {
        successKey = hex;
        console.log(`\n   🎉 REAL KEY FOUND at offset ${offset}: ${hex}`);
        break;
      }
    } catch (e) {
      console.log(`   offset=${String(offset).padStart(3)} → ❌ Error: ${e.message}`);
    }

    // Wait between attempts
    await new Promise(r => setTimeout(r, 1500));
  }

  if (!successKey) {
    console.log('\n   ❌ ALL OFFSETS FAILED — key server may be rate-limiting the RPI IP');
    process.exit(1);
  }

  // Step 4: Try decrypt
  console.log('\n4. Testing segment decrypt...');
  const segLines = m3u8.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  const firstSeg = segLines[0];
  if (!firstSeg) {
    console.log('   No segments in M3U8');
    process.exit(0);
  }
  const segUrl = firstSeg.startsWith('http') ? firstSeg.trim() : basePath + firstSeg.trim();

  const segRes = await fetch(segUrl, {
    headers: { 'User-Agent': UA, 'Referer': 'https://epaly.fun/', 'Origin': 'https://epaly.fun' },
    signal: AbortSignal.timeout(15000),
  });

  if (!segRes.ok) {
    console.log(`   ❌ Segment HTTP ${segRes.status}`);
    process.exit(1);
  }

  const segBuf = Buffer.from(await segRes.arrayBuffer());
  console.log(`   Segment: ${segBuf.length} bytes`);

  const key = Buffer.from(successKey, 'hex');
  let ivBuf;
  if (iv) {
    ivBuf = Buffer.from(iv.padStart(32, '0'), 'hex');
  } else {
    ivBuf = Buffer.alloc(16, 0);
  }

  try {
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, ivBuf);
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(segBuf), decipher.final()]);
    const sync = decrypted[0] === 0x47;
    console.log(`   Decrypted: ${decrypted.length} bytes, first bytes: ${decrypted.slice(0, 8).toString('hex')}`);
    console.log(`   TS sync byte (0x47): ${sync ? '✅ YES' : '⚠️ NO'}`);
    console.log(`\n   ${sync ? '🎉 FULL PIPELINE PASS!' : '⚠️ Decrypted but no TS sync byte'}`);
  } catch (e) {
    console.log(`   ❌ Decrypt error: ${e.message}`);
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
