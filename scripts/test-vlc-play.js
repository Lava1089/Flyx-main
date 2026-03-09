#!/usr/bin/env node
/**
 * Simulate what VLC/HLS.js sees when playing a DLHD stream
 * Fetch M3U8 → follow key URL → fetch segment → validate entire chain
 */
const https = require('https');
const crypto = require('crypto');

const PLAY_URL = 'https://dlhd.vynx.workers.dev/play/303?key=vynx';

function fetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...(opts.headers || {}),
      },
      timeout: 30000,
    }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        console.log(`    → Redirect ${res.statusCode}: ${res.headers.location.substring(0, 100)}`);
        return fetch(res.headers.location, opts).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, buf, text: buf.toString('utf8') });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

async function main() {
  console.log('=== VLC Playback Simulation ===');
  console.log(`URL: ${PLAY_URL}\n`);

  // Step 1: Fetch the M3U8
  console.log('[1] Fetching M3U8...');
  const m3u8 = await fetch(PLAY_URL);
  console.log(`    Status: ${m3u8.status}`);
  console.log(`    Content-Type: ${m3u8.headers['content-type']}`);
  console.log(`    Length: ${m3u8.buf.length}`);
  console.log(`    CORS: ${m3u8.headers['access-control-allow-origin'] || 'NONE'}`);
  console.log('\n--- M3U8 ---');
  console.log(m3u8.text);
  console.log('--- End ---\n');

  if (!m3u8.text.includes('#EXTM3U')) {
    console.log('❌ Not a valid M3U8! VLC will fail here.');
    return;
  }

  // Parse key and segments
  const lines = m3u8.text.split('\n').map(l => l.trim()).filter(Boolean);
  const keyLine = lines.find(l => l.startsWith('#EXT-X-KEY'));
  const segmentUrls = lines.filter(l => !l.startsWith('#') && l.startsWith('http'));

  // Step 2: Fetch the key
  let keyBuf = null, keyIV = null;
  if (keyLine) {
    const uriMatch = keyLine.match(/URI="([^"]+)"/);
    const ivMatch = keyLine.match(/IV=0x([0-9a-fA-F]+)/);
    keyIV = ivMatch ? ivMatch[1] : null;
    
    if (uriMatch) {
      console.log(`[2] Fetching key: ${uriMatch[1].substring(0, 120)}...`);
      const keyResp = await fetch(uriMatch[1]);
      console.log(`    Key status: ${keyResp.status}`);
      console.log(`    Key Content-Type: ${keyResp.headers['content-type']}`);
      console.log(`    Key length: ${keyResp.buf.length} bytes`);
      console.log(`    Key hex: ${keyResp.buf.toString('hex')}`);
      console.log(`    Key CORS: ${keyResp.headers['access-control-allow-origin'] || 'NONE'}`);
      console.log(`    X-Key-Source: ${keyResp.headers['x-key-source'] || 'none'}`);
      
      if (keyResp.buf.length === 16) {
        keyBuf = keyResp.buf;
      } else {
        console.log(`    ❌ Key is NOT 16 bytes! Content: ${keyResp.text.substring(0, 200)}`);
      }
    }
  } else {
    console.log('[2] No #EXT-X-KEY in M3U8');
  }

  // Step 3: Fetch first segment
  if (segmentUrls.length === 0) {
    console.log('\n[3] ❌ No segment URLs found!');
    return;
  }

  const segUrl = segmentUrls[0];
  console.log(`\n[3] Fetching segment 0: ${segUrl.substring(0, 120)}...`);
  const seg = await fetch(segUrl);
  console.log(`    Status: ${seg.status}`);
  console.log(`    Content-Type: ${seg.headers['content-type']}`);
  console.log(`    Length: ${seg.buf.length} bytes`);
  console.log(`    CORS: ${seg.headers['access-control-allow-origin'] || 'NONE'}`);
  console.log(`    First 32 bytes: ${seg.buf.slice(0, 32).toString('hex')}`);

  // Check if segment is text/error
  if (seg.buf.length < 188) {
    console.log(`    ❌ Segment too small! Content: ${seg.text.substring(0, 500)}`);
    return;
  }

  // Check raw first byte
  if (seg.buf[0] === 0x47) {
    console.log('    ✅ Segment starts with 0x47 — unencrypted TS');
    console.log('\n=== VLC should play this fine ===');
    return;
  }

  // Try decrypt
  if (keyBuf && keyIV) {
    console.log('\n[4] Attempting AES-128-CBC decrypt...');
    const iv = Buffer.from(keyIV, 'hex');
    console.log(`    Key: ${keyBuf.toString('hex')}`);
    console.log(`    IV:  ${iv.toString('hex')}`);
    
    try {
      const decipher = crypto.createDecipheriv('aes-128-cbc', keyBuf, iv);
      const dec = Buffer.concat([decipher.update(seg.buf), decipher.final()]);
      console.log(`    Decrypted length: ${dec.length}`);
      console.log(`    Decrypted first 32: ${dec.slice(0, 32).toString('hex')}`);
      
      if (dec[0] === 0x47) {
        console.log('    ✅ Decrypted to valid TS!');
        console.log('\n=== Stream is valid — VLC should handle decryption ===');
        console.log('    If VLC still fails, the issue is CORS or Content-Type headers');
      } else {
        console.log(`    ❌ Decrypted first byte: 0x${dec[0].toString(16)} — WRONG KEY!`);
      }
    } catch (e) {
      console.log(`    ❌ Decrypt error: ${e.message}`);
      // Maybe the segment is actually a /dlhdprivate proxy response?
      if (seg.text.includes('error') || seg.text.includes('{')) {
        console.log(`    Segment looks like error JSON: ${seg.text.substring(0, 300)}`);
      }
    }
  } else {
    console.log(`\n[4] Cannot decrypt — key=${keyBuf ? 'OK' : 'MISSING'}, IV=${keyIV ? 'OK' : 'MISSING'}`);
    console.log(`    First byte: 0x${seg.buf[0].toString(16)} — not 0x47`);
    console.log('    ❌ VLC cannot play encrypted segments without a valid key');
  }
}

main().catch(e => console.error('Fatal:', e.message));
