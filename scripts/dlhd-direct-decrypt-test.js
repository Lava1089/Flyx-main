#!/usr/bin/env node
/**
 * Direct upstream test: fetch M3U8 + key + segment from go.ai-chatx.site
 * and try to decrypt. Tests if the upstream is working AT ALL.
 */
const https = require('https');
const crypto = require('crypto');

function fetchBin(url, hdrs = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
      'Referer': 'https://adffdafdsafds.sbs/',
      'Origin': 'https://adffdafdsafds.sbs',
      ...hdrs,
    }, timeout: 15000 }, r => {
      const c = [];
      r.on('data', d => c.push(d));
      r.on('end', () => resolve({ status: r.statusCode, buf: Buffer.concat(c), headers: r.headers }));
    }).on('error', reject);
  });
}

async function testChannel(ch) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`DIRECT UPSTREAM TEST — Channel ${ch}`);
  console.log('='.repeat(60));

  // 1. Server lookup
  const lookup = await fetchBin(`https://chevy.vovlacosa.sbs/server_lookup?channel_id=premium${ch}`);
  const sk = JSON.parse(lookup.buf.toString()).server_key;
  console.log(`[1] server_key: ${sk}`);

  // 2. M3U8
  const m3u8Url = `https://go.ai-chatx.site/proxy/${sk}/premium${ch}/mono.css`;
  console.log(`[2] M3U8: ${m3u8Url}`);
  const m3u8Res = await fetchBin(m3u8Url);
  const m3u8 = m3u8Res.buf.toString();
  
  if (m3u8Res.status !== 200 || !m3u8.includes('#EXTM3U')) {
    console.log(`    ❌ M3U8 failed: ${m3u8Res.status} — ${m3u8.substring(0, 200)}`);
    return;
  }

  let keyPath, keyIV, segUrl;
  for (const line of m3u8.split('\n')) {
    const t = line.trim();
    if (t.startsWith('#EXT-X-KEY') && !keyPath) {
      const um = t.match(/URI="([^"]+)"/);
      const im = t.match(/IV=0x([0-9a-fA-F]+)/);
      if (um) keyPath = um[1];
      if (im) keyIV = im[1];
    }
    if (t && !t.startsWith('#') && t.startsWith('http') && !segUrl) segUrl = t;
  }
  console.log(`    Key: ${keyPath}, IV: ${keyIV ? keyIV.substring(0, 16) + '...' : 'NONE'}`);

  // 3. Key from go.ai-chatx.site (same domain as M3U8 — this is what browser does)
  const fullKeyUrl = keyPath.startsWith('http') ? keyPath : `https://go.ai-chatx.site${keyPath}`;
  console.log(`[3] Key: ${fullKeyUrl}`);
  const keyRes = await fetchBin(fullKeyUrl);
  console.log(`    Status: ${keyRes.status}, Size: ${keyRes.buf.length}`);
  
  if (keyRes.buf.length === 16) {
    const hex = keyRes.buf.toString('hex');
    const FAKES = new Set(['45db13cfa0ed393fdb7da4dfe9b5ac81','455806f8bc592fdacb6ed5e071a517b1','4542956ed8680eaccb615f7faad4da8f']);
    console.log(`    Hex: ${hex} ${FAKES.has(hex) ? '❌ KNOWN FAKE' : '✅ POSSIBLY REAL'}`);
  }

  // 4. Segment
  console.log(`[4] Segment: ${segUrl ? segUrl.substring(0, 80) + '...' : 'NONE'}`);
  if (!segUrl) return;
  const segRes = await fetchBin(segUrl);
  console.log(`    Status: ${segRes.status}, Size: ${segRes.buf.length}`);

  // 5. Decrypt
  if (keyRes.buf.length === 16 && segRes.buf.length > 100 && keyIV) {
    console.log(`[5] Decrypt...`);
    try {
      const iv = Buffer.from(keyIV, 'hex');
      const dec = crypto.createDecipheriv('aes-128-cbc', keyRes.buf, iv);
      dec.setAutoPadding(true);
      const out = Buffer.concat([dec.update(segRes.buf), dec.final()]);
      const isMpegTS = out[0] === 0x47;
      console.log(`    ${isMpegTS ? '✅ MPEG-TS' : '⚠️ Unknown'} — ${out.length} bytes, first: 0x${out[0].toString(16)}`);
    } catch (e) {
      console.log(`    ❌ Decrypt FAILED: ${e.message}`);
    }
  }

  // 6. Also try key from chevy.vovlacosa.sbs
  console.log(`[6] Alt key from chevy.vovlacosa.sbs:`);
  const altKeyUrl = `https://chevy.vovlacosa.sbs${keyPath}`;
  const altKey = await fetchBin(altKeyUrl);
  if (altKey.buf.length === 16) {
    const hex = altKey.buf.toString('hex');
    console.log(`    Hex: ${hex}`);
    // Try decrypt with alt key
    try {
      const iv = Buffer.from(keyIV, 'hex');
      const dec = crypto.createDecipheriv('aes-128-cbc', altKey.buf, iv);
      dec.setAutoPadding(true);
      const out = Buffer.concat([dec.update(segRes.buf), dec.final()]);
      console.log(`    Decrypt: ${out[0] === 0x47 ? '✅ MPEG-TS' : '⚠️ Unknown'} — ${out.length} bytes`);
    } catch (e) {
      console.log(`    Decrypt: ❌ ${e.message}`);
    }
  } else {
    console.log(`    Size: ${altKey.buf.length} (not 16)`);
  }
}

(async () => {
  await testChannel(303);
  await testChannel(52);
  console.log('\nDone.');
})();
