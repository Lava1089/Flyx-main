#!/usr/bin/env node
/**
 * Simulate EXACTLY what VLC does:
 * 1. Fetch M3U8 (plain GET, no special headers)
 * 2. Parse key URI
 * 3. Fetch key (plain GET, no special headers — VLC can't set custom headers)
 * 4. Fetch segment (plain GET)
 * 5. Try to decrypt segment with key
 */
const https = require('https');
const crypto = require('crypto');
const FAKES = new Set(['45db13cfa0ed393fdb7da4dfe9b5ac81', '455806f8bc592fdacb6ed5e071a517b1', '4542956ed8680eaccb615f7faad4da8f']);

function fetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: opts.headers || {
        // VLC sends minimal headers — just User-Agent
        'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20',
      },
      timeout: 20000,
    }, (res) => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve({ 
        status: res.statusCode, 
        headers: res.headers, 
        buf: Buffer.concat(chunks),
        redirectUrl: res.headers.location,
      }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

async function testChannel(ch) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`VLC SIMULATION — Channel ${ch}`);
  console.log('='.repeat(60));

  // Step 1: Fetch M3U8
  const playUrl = `https://dlhd.vynx.workers.dev/play/${ch}?key=vynx`;
  console.log(`\n[1. M3U8] GET ${playUrl}`);
  let m3u8, keyUrl, keyIV, segUrl;
  try {
    const t = Date.now();
    const r = await fetch(playUrl);
    console.log(`    Status: ${r.status} (${Date.now()-t}ms)`);
    console.log(`    Content-Type: ${r.headers['content-type']}`);
    console.log(`    CORS: ${r.headers['access-control-allow-origin'] || 'NONE'}`);
    
    if (r.status !== 200) {
      console.log(`    ❌ BODY: ${r.buf.toString().substring(0, 300)}`);
      return;
    }
    m3u8 = r.buf.toString();
    if (!m3u8.includes('#EXTM3U')) {
      console.log(`    ❌ Not M3U8: ${m3u8.substring(0, 200)}`);
      return;
    }
    
    // Parse
    for (const line of m3u8.split('\n')) {
      const t = line.trim();
      if (t.startsWith('#EXT-X-KEY')) {
        const um = t.match(/URI="([^"]+)"/);
        const im = t.match(/IV=0x([0-9a-fA-F]+)/);
        if (um && !keyUrl) keyUrl = um[1];
        if (im && !keyIV) keyIV = im[1];
        console.log(`    KEY LINE: ${t.substring(0, 200)}`);
      }
      if (t && !t.startsWith('#') && t.startsWith('http') && !segUrl) segUrl = t;
    }
    
    const lines = m3u8.split('\n');
    const segCount = lines.filter(l => l.trim().startsWith('http')).length;
    console.log(`    ✅ Valid M3U8 — ${segCount} segments, key: ${keyUrl ? 'YES' : 'NO'}`);
  } catch (e) {
    console.log(`    ❌ ${e.message}`);
    return;
  }

  // Step 2: Fetch key (VLC sends NO Origin, NO Referer)
  if (keyUrl) {
    console.log(`\n[2. KEY] GET ${keyUrl.substring(0, 140)}`);
    try {
      const t = Date.now();
      const kr = await fetch(keyUrl);
      console.log(`    Status: ${kr.status} (${Date.now()-t}ms)`);
      console.log(`    Content-Type: ${kr.headers['content-type']}`);
      console.log(`    Size: ${kr.buf.length} bytes`);
      console.log(`    CORS: ${kr.headers['access-control-allow-origin'] || 'NONE'}`);
      console.log(`    X-Key-Source: ${kr.headers['x-key-source'] || '?'}`);
      
      if (kr.buf.length === 16) {
        const hex = kr.buf.toString('hex');
        console.log(`    Key: ${hex} ${FAKES.has(hex) ? '❌ FAKE' : '✅ REAL'}`);
        
        // Step 3: Fetch segment and try to decrypt
        if (segUrl && keyIV) {
          console.log(`\n[3. SEGMENT] GET ${segUrl.substring(0, 120)}...`);
          try {
            const st = Date.now();
            const sr = await fetch(segUrl);
            console.log(`    Status: ${sr.status} (${Date.now()-st}ms)`);
            console.log(`    Size: ${sr.buf.length} bytes`);
            console.log(`    CORS: ${sr.headers['access-control-allow-origin'] || 'NONE'}`);
            
            if (sr.status === 200 && sr.buf.length > 100) {
              // Try AES-128-CBC decrypt
              console.log(`\n[4. DECRYPT] AES-128-CBC with IV=${keyIV.substring(0,16)}...`);
              try {
                const ivBuf = Buffer.from(keyIV, 'hex');
                const decipher = crypto.createDecipheriv('aes-128-cbc', kr.buf, ivBuf);
                decipher.setAutoPadding(true);
                const dec1 = decipher.update(sr.buf);
                const dec2 = decipher.final();
                const decrypted = Buffer.concat([dec1, dec2]);
                
                // Check for MPEG-TS sync byte (0x47) or ftyp box
                const isMpegTS = decrypted[0] === 0x47;
                const isFmp4 = decrypted.slice(4, 8).toString() === 'ftyp' || 
                               decrypted.slice(4, 8).toString() === 'moof' ||
                               decrypted.slice(4, 8).toString() === 'styp';
                
                if (isMpegTS) {
                  console.log(`    ✅ Decrypted to valid MPEG-TS (${decrypted.length} bytes)`);
                  console.log(`    First bytes: ${decrypted.slice(0, 16).toString('hex')}`);
                } else if (isFmp4) {
                  console.log(`    ✅ Decrypted to valid fMP4 (${decrypted.length} bytes)`);
                } else {
                  console.log(`    ⚠️ Decrypted but unknown format (${decrypted.length} bytes)`);
                  console.log(`    First bytes: ${decrypted.slice(0, 32).toString('hex')}`);
                }
              } catch (e) {
                console.log(`    ❌ Decrypt FAILED: ${e.message}`);
                console.log(`    This means the key is WRONG for this segment!`);
              }
            }
          } catch (e) {
            console.log(`    ❌ Segment error: ${e.message}`);
          }
        }
      } else {
        console.log(`    ❌ Not 16 bytes! Body: ${kr.buf.toString().substring(0, 200)}`);
      }
    } catch (e) {
      console.log(`    ❌ Key error: ${e.message}`);
    }
  }
}

(async () => {
  await testChannel(303);
  await testChannel(220);
  await testChannel(52);
  console.log('\nDone.');
})();
