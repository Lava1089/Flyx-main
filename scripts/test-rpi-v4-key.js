#!/usr/bin/env node
/** Quick test: does the RPI's own V4 auth (via /proxy) get real keys? */
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
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
} catch {}

const RPI = process.env.RPI_PROXY_URL;
const KEY = process.env.RPI_PROXY_KEY;

async function main() {
  console.log('RPI:', RPI);

  // Step 1: Get M3U8 to find current key URL
  console.log('\n1. Fetching M3U8 for channel 51...');
  const m3u8Res = await fetch('https://zekonew.dvalna.ru/zeko/premium51/mono.css', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://epaly.fun/',
      'Origin': 'https://epaly.fun',
    },
    signal: AbortSignal.timeout(10000),
  });
  const m3u8 = await m3u8Res.text();
  const keyMatch = m3u8.match(/#EXT-X-KEY:METHOD=AES-128,URI="([^"]+)"/);
  if (!keyMatch) { console.log('No key in M3U8'); return; }
  const base = 'https://zekonew.dvalna.ru/zeko/premium51/';
  const keyUrl = keyMatch[1].startsWith('http') ? keyMatch[1] : base + keyMatch[1];
  console.log('   Key URL:', keyUrl);

  // Step 2: Test RPI /proxy (uses V4 WASM auth internally)
  console.log('\n2. Testing RPI /proxy (V4 WASM auth)...');
  const proxyUrl = `${RPI}/proxy?url=${encodeURIComponent(keyUrl)}&key=${KEY}`;
  const proxyRes = await fetch(proxyUrl, {
    headers: { 'X-API-Key': KEY },
    signal: AbortSignal.timeout(30000),
  });
  const buf1 = await proxyRes.arrayBuffer();
  const hex1 = Buffer.from(buf1).toString('hex');
  const text1 = Buffer.from(buf1).toString('utf8');
  console.log(`   Status: ${proxyRes.status}, Size: ${buf1.byteLength}, Hex: ${hex1.substring(0, 32)}`);
  if (text1.startsWith('error') || text1.startsWith('{')) console.log(`   Text: ${text1.substring(0, 100)}`);
  if (hex1.startsWith('45c6497')) console.log('   ⚠️ FAKE KEY (45c6497 pattern)');
  else if (hex1.startsWith('6572726f72')) console.log('   ❌ ERROR response');
  else if (buf1.byteLength === 16) console.log('   ✅ Potentially REAL key!');
  else console.log('   ❌ Unexpected response');

  // Step 3: Also test the /dlhd-key-v4 endpoint directly
  console.log('\n3. Testing RPI /dlhd-key-v4 endpoint...');
  // We need JWT + timestamp + nonce for this endpoint
  // Let's just check if it exists
  const v4Url = `${RPI}/dlhd-key-v4?url=${encodeURIComponent(keyUrl)}&jwt=test&timestamp=${Math.floor(Date.now()/1000)}&nonce=0&key=${KEY}`;
  const v4Res = await fetch(v4Url, {
    headers: { 'X-API-Key': KEY },
    signal: AbortSignal.timeout(15000),
  });
  const buf2 = await v4Res.arrayBuffer();
  const hex2 = Buffer.from(buf2).toString('hex');
  const text2 = Buffer.from(buf2).toString('utf8');
  console.log(`   Status: ${v4Res.status}, Size: ${buf2.byteLength}`);
  if (text2.length < 200) console.log(`   Text: ${text2}`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
