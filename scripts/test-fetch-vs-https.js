#!/usr/bin/env node
/**
 * Test: Node.js fetch() vs https.request() vs curl from THIS machine.
 * If fetch() works but https.request() doesn't, that explains why the RPI proxy fails.
 * The RPI /fetch route uses https.request(), not fetch().
 */
const crypto = require('crypto');
const https = require('https');
const { spawn } = require('child_process');
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

async function getAuthAndKeyUrl() {
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
  const resource = kp[1], keyNumber = kp[2];
  const ts = Math.floor(Date.now() / 1000);
  const fp = sha256(UA + '1920x1080' + 'America/New_York' + 'en-US').substring(0, 16);
  const hp = hmacSha256(resource, channelSalt);
  let nonce = 0;
  for (let n = 0; n < 100000; n++) {
    if (parseInt(md5(hp + resource + keyNumber + ts + n).substring(0, 4), 16) < 0x1000) { nonce = n; break; }
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

async function testFetch(keyUrl, headers) {
  const res = await fetch(keyUrl, { headers });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, hex: buf.toString('hex'), size: buf.length };
}

function testHttpsRequest(keyUrl, headers) {
  return new Promise((resolve) => {
    const u = new URL(keyUrl);
    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: 'GET',
      headers: { ...headers },
      rejectUnauthorized: false,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, hex: buf.toString('hex'), size: buf.length });
      });
    });
    req.on('error', e => resolve({ error: e.message }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.end();
  });
}

function testCurl(keyUrl, headers) {
  return new Promise((resolve) => {
    const args = ['-s', '--max-time', '15', '-o', '-', '-w', '%{http_code}'];
    for (const [k, v] of Object.entries(headers)) {
      args.push('-H', `${k}: ${v}`);
    }
    args.push(keyUrl);
    
    const proc = spawn('curl', args);
    const chunks = [];
    proc.stdout.on('data', d => chunks.push(d));
    proc.on('close', () => {
      const output = Buffer.concat(chunks);
      // Last 3 bytes are the HTTP status code
      const statusStr = output.slice(-3).toString();
      const body = output.slice(0, -3);
      resolve({ status: parseInt(statusStr), hex: body.toString('hex'), size: body.length });
    });
    proc.on('error', e => resolve({ error: e.message }));
  });
}

async function main() {
  console.log('Node.js version:', process.version);
  console.log('');

  const { authToken, channelSalt, keyUrl } = await getAuthAndKeyUrl();
  console.log('Key URL:', keyUrl);
  console.log('');

  // Test 1: fetch()
  console.log('Test 1: fetch() ...');
  const h1 = buildHeaders(keyUrl, authToken, channelSalt);
  const r1 = await testFetch(keyUrl, h1);
  console.log(`  Status: ${r1.status}, Size: ${r1.size}, Hex: ${r1.hex}`);
  console.log(`  ${r1.hex.startsWith('45c6497') ? '❌ FAKE' : '✅ REAL'}`);

  await new Promise(r => setTimeout(r, 500));

  // Test 2: https.request() — THIS is what the RPI /fetch route uses
  console.log('\nTest 2: https.request() ...');
  const h2 = buildHeaders(keyUrl, authToken, channelSalt);
  const r2 = await testHttpsRequest(keyUrl, h2);
  console.log(`  Status: ${r2.status}, Size: ${r2.size}, Hex: ${r2.hex}`);
  console.log(`  ${r2.hex?.startsWith('45c6497') ? '❌ FAKE' : r2.error ? '❌ ' + r2.error : '✅ REAL'}`);

  await new Promise(r => setTimeout(r, 500));

  // Test 3: curl
  console.log('\nTest 3: curl ...');
  const h3 = buildHeaders(keyUrl, authToken, channelSalt);
  const r3 = await testCurl(keyUrl, h3);
  console.log(`  Status: ${r3.status}, Size: ${r3.size}, Hex: ${r3.hex}`);
  console.log(`  ${r3.hex?.startsWith('45c6497') ? '❌ FAKE' : r3.error ? '❌ ' + r3.error : '✅ REAL'}`);

  console.log('\n=== SUMMARY ===');
  console.log(`fetch():          ${r1.hex?.startsWith('45c6497') ? '❌ FAKE' : '✅ REAL'}`);
  console.log(`https.request():  ${r2.hex?.startsWith('45c6497') ? '❌ FAKE' : r2.error ? '❌ ERROR' : '✅ REAL'}`);
  console.log(`curl:             ${r3.hex?.startsWith('45c6497') ? '❌ FAKE' : r3.error ? '❌ ERROR' : '✅ REAL'}`);
  
  if (r1.hex && !r1.hex.startsWith('45c6497') && r2.hex?.startsWith('45c6497')) {
    console.log('\n🔑 FOUND IT: fetch() works but https.request() returns fake key!');
    console.log('The RPI /fetch route uses https.request() which has a different TLS fingerprint.');
    console.log('Solution: Use fetch() in the RPI proxy instead of https.request().');
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
