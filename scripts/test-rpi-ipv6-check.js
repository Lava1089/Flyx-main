#!/usr/bin/env node
/**
 * Check if IPv6 vs IPv4 matters for key fetching.
 * Run on THIS machine to test both address families.
 */
const crypto = require('crypto');
const https = require('https');
const dns = require('dns');
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

function md5(s) { return crypto.createHash('md5').update(s).digest('hex'); }
function hmacSha256(d, k) { return crypto.createHmac('sha256', k).update(d).digest('hex'); }
function sha256(d) { return crypto.createHash('sha256').update(d).digest('hex'); }

async function getAuthAndKey() {
  const authRes = await fetch('https://epaly.fun/premiumtv/daddyhd.php?id=51', {
    headers: { 'User-Agent': UA, 'Referer': 'https://dlhd.link/' },
  });
  const html = await authRes.text();
  const init = html.match(/EPlayerAuth\.init\s*\(\s*\{([^}]+)\}\s*\)/);
  const authToken = init[1].match(/authToken\s*:\s*["']([^"']+)["']/)[1];
  const channelSalt = init[1].match(/channelSalt\s*:\s*["']([^"']+)["']/)[1];

  const lookup = await (await fetch('https://chevy.dvalna.ru/server_lookup?channel_id=premium51')).json();
  const sk = lookup.server_key;
  const m3u8Url = `https://${sk}new.dvalna.ru/${sk}/premium51/mono.css`;
  const m3u8Res = await fetch(m3u8Url, {
    headers: { 'User-Agent': UA, 'Origin': 'https://epaly.fun', 'Referer': 'https://epaly.fun/', 'Authorization': `Bearer ${authToken}` },
  });
  const m3u8 = await m3u8Res.text();
  const keyMatch = m3u8.match(/#EXT-X-KEY:METHOD=AES-128,URI="([^"]+)"/);
  return { authToken, channelSalt, keyUrl: keyMatch[1] };
}

function buildHeaders(keyUrl, authToken, channelSalt) {
  const kp = keyUrl.match(/\/key\/([^/]+)\/(\d+)/);
  const ts = Math.floor(Date.now() / 1000);
  const fp = sha256(UA + '1920x1080' + 'America/New_York' + 'en-US').substring(0, 16);
  const hp = hmacSha256(kp[1], channelSalt);
  let nonce = 0;
  for (let n = 0; n < 100000; n++) {
    if (parseInt(md5(hp + kp[1] + kp[2] + ts + n).substring(0, 4), 16) < 0x1000) { nonce = n; break; }
  }
  const keyPath = hmacSha256(`${kp[1]}|${kp[2]}|${ts}|${fp}`, channelSalt).substring(0, 16);
  return {
    'User-Agent': UA, 'Accept': '*/*',
    'Origin': 'https://epaly.fun', 'Referer': 'https://epaly.fun/',
    'Authorization': `Bearer ${authToken}`,
    'X-Key-Timestamp': String(ts), 'X-Key-Nonce': String(nonce),
    'X-Key-Path': keyPath, 'X-Fingerprint': fp,
  };
}

function fetchWithFamily(keyUrl, headers, family) {
  return new Promise((resolve, reject) => {
    const u = new URL(keyUrl);
    const options = {
      hostname: u.hostname,
      port: 443,
      path: u.pathname,
      method: 'GET',
      headers: { ...headers },
      family: family, // 4 = IPv4, 6 = IPv6
      rejectUnauthorized: true,
    };
    
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({
          status: res.statusCode,
          hex: buf.toString('hex'),
          size: buf.length,
          remoteAddress: req.socket?.remoteAddress,
          remoteFamily: req.socket?.remoteFamily,
        });
      });
    });
    req.on('error', e => resolve({ error: e.message }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.end();
  });
}

async function main() {
  console.log('=== IPv4 vs IPv6 Key Fetch Test ===\n');
  
  // Check DNS
  console.log('DNS resolution for chevy.dvalna.ru:');
  const ipv4 = await new Promise(r => dns.resolve4('chevy.dvalna.ru', (e, a) => r(e ? [] : a)));
  const ipv6 = await new Promise(r => dns.resolve6('chevy.dvalna.ru', (e, a) => r(e ? [] : a)));
  console.log('  IPv4:', ipv4.join(', '));
  console.log('  IPv6:', ipv6.join(', '));
  
  const { authToken, channelSalt, keyUrl } = await getAuthAndKey();
  console.log('\nKey URL:', keyUrl);

  // Test IPv4
  console.log('\n--- IPv4 (family: 4) ---');
  const h4 = buildHeaders(keyUrl, authToken, channelSalt);
  const r4 = await fetchWithFamily(keyUrl, h4, 4);
  console.log(`  Status: ${r4.status}, Size: ${r4.size}, Remote: ${r4.remoteAddress} (${r4.remoteFamily})`);
  console.log(`  Hex: ${r4.hex}`);
  console.log(`  ${r4.hex?.startsWith('45c6497') ? '❌ FAKE' : r4.error ? '❌ ' + r4.error : '✅ REAL'}`);

  await new Promise(r => setTimeout(r, 1000));

  // Test IPv6
  console.log('\n--- IPv6 (family: 6) ---');
  const h6 = buildHeaders(keyUrl, authToken, channelSalt);
  const r6 = await fetchWithFamily(keyUrl, h6, 6);
  if (r6.error) {
    console.log(`  Error: ${r6.error}`);
  } else {
    console.log(`  Status: ${r6.status}, Size: ${r6.size}, Remote: ${r6.remoteAddress} (${r6.remoteFamily})`);
    console.log(`  Hex: ${r6.hex}`);
    console.log(`  ${r6.hex?.startsWith('45c6497') ? '❌ FAKE' : '✅ REAL'}`);
  }

  // Test default (no family specified — OS decides)
  await new Promise(r => setTimeout(r, 1000));
  console.log('\n--- Default (OS chooses) ---');
  const hd = buildHeaders(keyUrl, authToken, channelSalt);
  const rd = await fetchWithFamily(keyUrl, hd, 0);
  console.log(`  Status: ${rd.status}, Size: ${rd.size}, Remote: ${rd.remoteAddress} (${rd.remoteFamily})`);
  console.log(`  Hex: ${rd.hex}`);
  console.log(`  ${rd.hex?.startsWith('45c6497') ? '❌ FAKE' : rd.error ? '❌ ' + rd.error : '✅ REAL'}`);

  console.log('\n=== SUMMARY ===');
  console.log(`IPv4: ${r4.hex?.startsWith('45c6497') ? '❌ FAKE' : r4.error ? '❌ ERROR' : '✅ REAL'}`);
  console.log(`IPv6: ${r6.hex?.startsWith('45c6497') ? '❌ FAKE' : r6.error ? '❌ ERROR/UNSUPPORTED' : '✅ REAL'}`);
  console.log(`Default: ${rd.hex?.startsWith('45c6497') ? '❌ FAKE' : rd.error ? '❌ ERROR' : '✅ REAL'}`);
  
  if (r4.hex && !r4.hex.startsWith('45c6497') && r6.hex?.startsWith('45c6497')) {
    console.log('\n🔑 IPv6 returns FAKE key! The RPI is likely using IPv6.');
    console.log('Fix: Force IPv4 in the RPI proxy outbound requests.');
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
