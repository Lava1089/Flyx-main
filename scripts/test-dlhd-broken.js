#!/usr/bin/env node
const https = require('https');
const FAKES = new Set(['45db13cfa0ed393fdb7da4dfe9b5ac81', '455806f8bc592fdacb6ed5e071a517b1']);

function fetch(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { timeout: 20000, headers }, (res) => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

async function testChannel(ch) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`CHANNEL ${ch}`);
  console.log('='.repeat(60));

  // Step 1: /play endpoint
  const playUrl = `https://dlhd.vynx.workers.dev/play/${ch}?key=vynx`;
  console.log(`[1] GET ${playUrl}`);
  try {
    const r = await fetch(playUrl);
    console.log(`    Status: ${r.status}  Server: ${r.headers['x-dlhd-server'] || 'none'}  Backend: ${r.headers['x-dlhd-backend'] || 'none'}`);
    const body = r.buf.toString();

    if (r.status !== 200) {
      console.log(`    ❌ FAIL: ${body.substring(0, 300)}`);
      return;
    }
    if (!body.includes('#EXTM3U')) {
      console.log(`    ❌ Not M3U8: ${body.substring(0, 300)}`);
      return;
    }
    console.log(`    ✅ Valid M3U8 (${body.length} bytes, ${body.split('\n').length} lines)`);

    // Step 2: Parse key URIs
    const keyUrls = [];
    const segUrls = [];
    for (const line of body.split('\n')) {
      const t = line.trim();
      if (t.startsWith('#EXT-X-KEY')) {
        const m = t.match(/URI="([^"]+)"/);
        if (m) keyUrls.push(m[1]);
        console.log(`    KEY: ${t.substring(0, 150)}`);
      }
      if (t && !t.startsWith('#') && t.startsWith('http')) segUrls.push(t);
    }
    console.log(`    Keys: ${keyUrls.length}  Segments: ${segUrls.length}`);

    // Step 3: Fetch key
    if (keyUrls.length > 0) {
      const keyUrl = keyUrls[0];
      // Extract upstream URL for logging
      try {
        const upstream = new URL(keyUrl).searchParams.get('url');
        console.log(`[2] Key upstream: ${upstream}`);
      } catch {}
      console.log(`[2] GET ${keyUrl.substring(0, 120)}...`);
      try {
        const kr = await fetch(keyUrl);
        console.log(`    Status: ${kr.status}  Size: ${kr.buf.length}  Source: ${kr.headers['x-key-source'] || '?'}`);
        if (kr.buf.length === 16) {
          const hex = kr.buf.toString('hex');
          console.log(`    Key: ${hex}  ${FAKES.has(hex) ? '❌ FAKE' : '✅ REAL'}`);
        } else {
          console.log(`    ❌ Not 16 bytes: ${kr.buf.toString().substring(0, 200)}`);
        }
      } catch (e) {
        console.log(`    ❌ Key fetch error: ${e.message}`);
      }
    }

    // Step 4: Fetch first segment
    if (segUrls.length > 0) {
      console.log(`[3] Segment: ${segUrls[0].substring(0, 100)}...`);
      try {
        const sr = await fetch(segUrls[0]);
        console.log(`    Status: ${sr.status}  Size: ${sr.buf.length}`);
        if (sr.status === 200 && sr.buf.length > 100) {
          console.log(`    ✅ Segment OK`);
        } else {
          console.log(`    ❌ Segment bad`);
        }
      } catch (e) {
        console.log(`    ❌ Segment error: ${e.message}`);
      }
    }
  } catch (e) {
    console.log(`    ❌ Error: ${e.message}`);
  }
}

(async () => {
  await testChannel(220);
  await testChannel(52);
  console.log('\nDone.');
})();
