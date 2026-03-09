#!/usr/bin/env node
/**
 * Full E2E test: Fetch M3U8 from go.ai-chatx.site, get key via RPI, decrypt segment
 */
const https = require('https');
const crypto = require('crypto');

const RPI = 'https://rpi-proxy.vynx.cc';
const RPI_KEY = '5f1845926d725bb2a8230a6ed231fce1d03f07782f74a3f683c30ec04d4ac560';

function fetchBin(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      ...headers,
    }, timeout: 20000 }, r => {
      const chunks = [];
      r.on('data', c => chunks.push(c));
      r.on('end', () => resolve({ status: r.statusCode, buf: Buffer.concat(chunks), headers: r.headers }));
    }).on('error', reject);
  });
}

async function main() {
  const ch = process.argv[2] || '303';
  console.log(`\n=== E2E DECRYPT TEST — Channel ${ch} ===\n`);

  // Step 1: Server lookup
  console.log('[1] Server lookup...');
  const lookup = await fetchBin(`https://chevy.vovlacosa.sbs/server_lookup?channel_id=premium${ch}`, {
    'Referer': 'https://adffdafdsafds.sbs/', 'Origin': 'https://adffdafdsafds.sbs',
  });
  const serverData = JSON.parse(lookup.buf.toString());
  const sk = serverData.server_key;
  console.log(`    server_key: ${sk}`);

  // Step 2: Fetch M3U8 from go.ai-chatx.site (the REAL source)
  const m3u8Url = `https://go.ai-chatx.site/proxy/${sk}/premium${ch}/mono.css`;
  console.log(`\n[2] M3U8: ${m3u8Url}`);
  const m3u8Res = await fetchBin(m3u8Url, {
    'Referer': 'https://adffdafdsafds.sbs/', 'Origin': 'https://adffdafdsafds.sbs',
  });
  const m3u8 = m3u8Res.buf.toString();
  console.log(`    Status: ${m3u8Res.status}, Size: ${m3u8.length}`);
  
  if (!m3u8.includes('#EXTM3U')) {
    console.log(`    ❌ Not M3U8: ${m3u8.substring(0, 200)}`);
    return;
  }

  // Parse key URI and IV
  let keyPath, keyIV, segUrl;
  for (const line of m3u8.split('\n')) {
    const t = line.trim();
    if (t.startsWith('#EXT-X-KEY')) {
      const um = t.match(/URI="([^"]+)"/);
      const im = t.match(/IV=0x([0-9a-fA-F]+)/);
      if (um) keyPath = um[1];
      if (im) keyIV = im[1];
      console.log(`    KEY: ${t.substring(0, 200)}`);
    }
    if (t && !t.startsWith('#') && t.startsWith('http') && !segUrl) segUrl = t;
  }

  if (!keyPath || !keyIV || !segUrl) {
    console.log('    ❌ Missing key/IV/segment');
    return;
  }

  // The key URI is relative: /key/premium303/5909740
  // Resolve to go.ai-chatx.site
  const fullKeyUrl = keyPath.startsWith('http') ? keyPath : `https://go.ai-chatx.site${keyPath}`;
  console.log(`\n[3] Key URL: ${fullKeyUrl}`);

  // Step 3a: Fetch key DIRECTLY (my IP — probably not whitelisted)
  console.log('\n[3a] Direct key fetch (my IP):');
  const directKey = await fetchBin(fullKeyUrl, {
    'Referer': 'https://adffdafdsafds.sbs/', 'Origin': 'https://adffdafdsafds.sbs',
  });
  if (directKey.buf.length === 16) {
    console.log(`    Key: ${directKey.buf.toString('hex')}`);
  } else {
    console.log(`    Size: ${directKey.buf.length} (not 16 bytes)`);
  }

  // Step 3b: Fetch key via RPI /fetch
  console.log('\n[3b] Key via RPI /fetch:');
  const rpiKeyUrl = `${RPI}/fetch?url=${encodeURIComponent(fullKeyUrl)}&headers=${encodeURIComponent(JSON.stringify({
    'Referer': 'https://adffdafdsafds.sbs/',
    'Origin': 'https://adffdafdsafds.sbs',
  }))}&key=${RPI_KEY}`;
  const rpiKey = await fetchBin(rpiKeyUrl, { 'X-API-Key': RPI_KEY });
  console.log(`    Status: ${rpiKey.status}, Size: ${rpiKey.buf.length}`);
  if (rpiKey.buf.length === 16) {
    const hex = rpiKey.buf.toString('hex');
    console.log(`    Key: ${hex}`);
    
    const FAKES = new Set(['45db13cfa0ed393fdb7da4dfe9b5ac81','455806f8bc592fdacb6ed5e071a517b1','4542956ed8680eaccb615f7faad4da8f']);
    console.log(`    Fake? ${FAKES.has(hex) ? '❌ YES' : '✅ NO'}`);
  } else {
    console.log(`    Body: ${rpiKey.buf.toString().substring(0, 200)}`);
  }

  // Step 4: Fetch segment
  console.log(`\n[4] Segment: ${segUrl.substring(0, 100)}...`);
  const seg = await fetchBin(segUrl);
  console.log(`    Status: ${seg.status}, Size: ${seg.buf.length}`);

  // Step 5: Try decrypt with RPI key
  if (rpiKey.buf.length === 16 && seg.buf.length > 100) {
    console.log(`\n[5] Decrypt with RPI key...`);
    try {
      const ivBuf = Buffer.from(keyIV, 'hex');
      const decipher = crypto.createDecipheriv('aes-128-cbc', rpiKey.buf, ivBuf);
      decipher.setAutoPadding(true);
      const dec = Buffer.concat([decipher.update(seg.buf), decipher.final()]);
      const isMpegTS = dec[0] === 0x47;
      console.log(`    ${isMpegTS ? '✅ MPEG-TS' : '⚠️ Unknown format'} — ${dec.length} bytes`);
      console.log(`    First 16 bytes: ${dec.slice(0, 16).toString('hex')}`);
    } catch (e) {
      console.log(`    ❌ Decrypt FAILED: ${e.message}`);
    }
  }

  // Step 5b: Try decrypt with direct key
  if (directKey.buf.length === 16 && seg.buf.length > 100) {
    console.log(`\n[5b] Decrypt with direct key...`);
    try {
      const ivBuf = Buffer.from(keyIV, 'hex');
      const decipher = crypto.createDecipheriv('aes-128-cbc', directKey.buf, ivBuf);
      decipher.setAutoPadding(true);
      const dec = Buffer.concat([decipher.update(seg.buf), decipher.final()]);
      const isMpegTS = dec[0] === 0x47;
      console.log(`    ${isMpegTS ? '✅ MPEG-TS' : '⚠️ Unknown format'} — ${dec.length} bytes`);
      console.log(`    First 16 bytes: ${dec.slice(0, 16).toString('hex')}`);
    } catch (e) {
      console.log(`    ❌ Decrypt FAILED: ${e.message}`);
    }
  }
}

main().catch(e => console.error(e));
