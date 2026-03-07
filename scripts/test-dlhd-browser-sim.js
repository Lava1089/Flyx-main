#!/usr/bin/env node
/**
 * Simulate EXACTLY what the browser does for DLHD streams:
 * 1. Fetch M3U8 from /play (with Origin header like browser)
 * 2. Parse M3U8
 * 3. Fetch key (with Origin header like HLS.js does)
 * 4. Fetch segment
 * 5. Repeat M3U8 fetch (live stream refresh) to check for key rotation issues
 * 6. Check if new key still works
 */
const https = require('https');
const FAKES = new Set(['45db13cfa0ed393fdb7da4dfe9b5ac81', '455806f8bc592fdacb6ed5e071a517b1']);

function fetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: {
        // Simulate browser headers
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Origin': 'https://tv.vynx.cc',
        'Referer': 'https://tv.vynx.cc/',
        ...(opts.headers || {}),
      },
      timeout: 20000,
    }, (res) => {
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
  console.log(`BROWSER SIMULATION — Channel ${ch}`);
  console.log('='.repeat(60));

  // Step 1: Fetch M3U8 (like HLS.js loadSource)
  const t1 = Date.now();
  const playUrl = `https://dlhd.vynx.workers.dev/play/${ch}?key=vynx`;
  console.log(`[M3U8] GET ${playUrl}`);
  let m3u8, keyUrl, segUrl, server;
  try {
    const r = await fetch(playUrl);
    const elapsed = Date.now() - t1;
    server = r.headers['x-dlhd-server'] || '?';
    console.log(`[M3U8] ${r.status} in ${elapsed}ms — server: ${server}`);
    console.log(`[M3U8] CORS: ${r.headers['access-control-allow-origin'] || 'MISSING!'}`);
    
    if (r.status !== 200) {
      console.log(`[M3U8] ❌ BODY: ${r.buf.toString().substring(0, 300)}`);
      return;
    }
    m3u8 = r.buf.toString();
    if (!m3u8.includes('#EXTM3U')) {
      console.log(`[M3U8] ❌ Not valid M3U8`);
      return;
    }
    console.log(`[M3U8] ✅ Valid (${m3u8.length}b)`);
    
    // Parse
    for (const line of m3u8.split('\n')) {
      const t = line.trim();
      if (t.startsWith('#EXT-X-KEY')) {
        const m = t.match(/URI="([^"]+)"/);
        if (m && !keyUrl) keyUrl = m[1];
      }
      if (t && !t.startsWith('#') && t.startsWith('http') && !segUrl) segUrl = t;
    }
  } catch (e) {
    console.log(`[M3U8] ❌ ${e.message}`);
    return;
  }

  // Step 2: Fetch key (like HLS.js does — NO API key, just Origin header)
  if (keyUrl) {
    const t2 = Date.now();
    console.log(`\n[KEY] GET ${keyUrl.substring(0, 120)}...`);
    try {
      const kr = await fetch(keyUrl);
      const elapsed = Date.now() - t2;
      console.log(`[KEY] ${kr.status} in ${elapsed}ms — size: ${kr.buf.length}b`);
      console.log(`[KEY] CORS: ${kr.headers['access-control-allow-origin'] || 'MISSING!'}`);
      console.log(`[KEY] Source: ${kr.headers['x-key-source'] || '?'}`);
      
      if (kr.buf.length === 16) {
        const hex = kr.buf.toString('hex');
        console.log(`[KEY] ${hex} ${FAKES.has(hex) ? '❌ FAKE' : '✅ REAL'}`);
      } else {
        console.log(`[KEY] ❌ Not 16 bytes: ${kr.buf.toString().substring(0, 200)}`);
      }
    } catch (e) {
      console.log(`[KEY] ❌ ${e.message}`);
    }
  } else {
    console.log(`\n[KEY] ⚠️ No key URI in M3U8`);
  }

  // Step 3: Fetch segment
  if (segUrl) {
    const t3 = Date.now();
    console.log(`\n[SEG] GET ${segUrl.substring(0, 100)}...`);
    try {
      const sr = await fetch(segUrl);
      const elapsed = Date.now() - t3;
      console.log(`[SEG] ${sr.status} in ${elapsed}ms — size: ${sr.buf.length}b`);
      console.log(`[SEG] CORS: ${sr.headers['access-control-allow-origin'] || 'MISSING!'}`);
      if (sr.status === 200 && sr.buf.length > 100) {
        console.log(`[SEG] ✅ OK`);
      } else {
        console.log(`[SEG] ❌ Bad response`);
      }
    } catch (e) {
      console.log(`[SEG] ❌ ${e.message}`);
    }
  }

  // Step 4: Wait 5s and refetch M3U8 (simulate live playlist refresh)
  console.log(`\n[REFRESH] Waiting 5s for live playlist refresh...`);
  await new Promise(r => setTimeout(r, 5000));
  
  const t4 = Date.now();
  try {
    const r2 = await fetch(playUrl);
    const elapsed = Date.now() - t4;
    console.log(`[REFRESH] ${r2.status} in ${elapsed}ms`);
    
    if (r2.status === 200) {
      const m3u8_2 = r2.buf.toString();
      if (m3u8_2.includes('#EXTM3U')) {
        // Check if key changed
        let newKeyUrl;
        for (const line of m3u8_2.split('\n')) {
          const m = line.match(/URI="([^"]+)"/);
          if (m && !newKeyUrl) newKeyUrl = m[1];
        }
        if (newKeyUrl && newKeyUrl !== keyUrl) {
          console.log(`[REFRESH] Key URL CHANGED — fetching new key...`);
          const kr2 = await fetch(newKeyUrl);
          if (kr2.buf.length === 16) {
            const hex = kr2.buf.toString('hex');
            console.log(`[REFRESH] New key: ${hex} ${FAKES.has(hex) ? '❌ FAKE' : '✅ REAL'}`);
          } else {
            console.log(`[REFRESH] ❌ New key bad: ${kr2.buf.length}b`);
          }
        } else {
          console.log(`[REFRESH] ✅ Same key URL — no rotation`);
        }
      }
    }
  } catch (e) {
    console.log(`[REFRESH] ❌ ${e.message}`);
  }
}

(async () => {
  await testChannel(220);
  await testChannel(52);
  console.log('\n\nAll done.');
})();
