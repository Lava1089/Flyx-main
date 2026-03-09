#!/usr/bin/env node
/**
 * Validate DLHD segments are real TS data (0x47 sync byte)
 * Fetches M3U8 → gets key → decrypts first segment → checks bytes
 */

const https = require('https');
const crypto = require('crypto');

const CF_WORKER = 'https://dlhd.vynx.workers.dev';
const API_KEY = 'vynx';
const CHANNEL = '44';

function fetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method: opts.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...(opts.headers || {}),
      },
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, buf, text: buf.toString('utf8') });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function main() {
  console.log('=== DLHD Segment Validation ===\n');

  // Step 1: Get M3U8 from /play
  console.log('[1] Fetching M3U8 from CF Worker /play...');
  const playResp = await fetch(`${CF_WORKER}/play/${CHANNEL}?key=${API_KEY}`);
  console.log(`    Status: ${playResp.status}, Length: ${playResp.buf.length}`);
  console.log(`    Content-Type: ${playResp.headers['content-type']}`);
  
  if (!playResp.text.includes('#EXTM3U')) {
    console.log('    ❌ Not a valid M3U8!');
    console.log(`    Body: ${playResp.text.substring(0, 500)}`);
    return;
  }

  console.log('\n--- M3U8 Content ---');
  console.log(playResp.text);
  console.log('--- End M3U8 ---\n');

  // Parse M3U8
  const lines = playResp.text.split('\n').map(l => l.trim()).filter(Boolean);
  
  // Extract key info
  const keyLine = lines.find(l => l.startsWith('#EXT-X-KEY'));
  let keyUri = null, keyIV = null, keyMethod = null;
  if (keyLine) {
    const uriMatch = keyLine.match(/URI="([^"]+)"/);
    const ivMatch = keyLine.match(/IV=0x([0-9a-fA-F]+)/);
    const methodMatch = keyLine.match(/METHOD=([^,]+)/);
    keyUri = uriMatch ? uriMatch[1] : null;
    keyIV = ivMatch ? ivMatch[1] : null;
    keyMethod = methodMatch ? methodMatch[1] : null;
    console.log(`[2] Key info: method=${keyMethod}, URI=${keyUri}, IV=${keyIV || 'none'}`);
  } else {
    console.log('[2] No #EXT-X-KEY found in M3U8');
  }

  // Extract segment URLs
  const segmentUrls = lines.filter(l => !l.startsWith('#') && (l.startsWith('http') || l.startsWith('/')));
  console.log(`[3] Found ${segmentUrls.length} segment URLs`);
  if (segmentUrls.length === 0) {
    console.log('    ❌ No segment URLs found!');
    console.log('    Non-tag lines:', lines.filter(l => !l.startsWith('#')));
    return;
  }

  // Step 2: Fetch the key
  let keyBuf = null;
  if (keyUri) {
    console.log(`\n[4] Fetching decryption key: ${keyUri.substring(0, 80)}...`);
    const keyResp = await fetch(keyUri);
    console.log(`    Key status: ${keyResp.status}, Length: ${keyResp.buf.length}`);
    console.log(`    Key hex: ${keyResp.buf.toString('hex')}`);
    keyBuf = keyResp.buf;
  }

  // Step 3: Fetch first 2 segments and validate
  const testCount = Math.min(2, segmentUrls.length);
  for (let i = 0; i < testCount; i++) {
    const segUrl = segmentUrls[i];
    console.log(`\n[${5+i}] Fetching segment ${i}: ${segUrl.substring(0, 100)}...`);
    
    const segResp = await fetch(segUrl);
    console.log(`    Status: ${segResp.status}`);
    console.log(`    Content-Type: ${segResp.headers['content-type']}`);
    console.log(`    Length: ${segResp.buf.length} bytes`);
    console.log(`    First 32 bytes (raw): ${segResp.buf.slice(0, 32).toString('hex')}`);
    
    // Check raw first byte
    if (segResp.buf[0] === 0x47) {
      console.log(`    ✅ Raw segment starts with 0x47 (TS sync byte) — NOT encrypted`);
      continue;
    }

    // If encrypted, try to decrypt
    if (keyBuf && keyBuf.length === 16 && keyMethod === 'AES-128') {
      console.log(`    Segment is encrypted, attempting AES-128-CBC decrypt...`);
      
      let iv;
      if (keyIV) {
        iv = Buffer.from(keyIV, 'hex');
      } else {
        // Default IV = segment sequence number (big-endian 16 bytes)
        iv = Buffer.alloc(16);
        iv.writeUInt32BE(i, 12);
      }
      
      console.log(`    IV: ${iv.toString('hex')}`);
      console.log(`    Key: ${keyBuf.toString('hex')}`);
      
      try {
        const decipher = crypto.createDecipheriv('aes-128-cbc', keyBuf, iv);
        const decrypted = Buffer.concat([decipher.update(segResp.buf), decipher.final()]);
        console.log(`    Decrypted length: ${decrypted.length}`);
        console.log(`    Decrypted first 32 bytes: ${decrypted.slice(0, 32).toString('hex')}`);
        
        if (decrypted[0] === 0x47) {
          console.log(`    ✅ Decrypted segment starts with 0x47 — VALID TS!`);
        } else {
          console.log(`    ❌ Decrypted segment starts with 0x${decrypted[0].toString(16).padStart(2,'0')} — NOT a TS sync byte!`);
          console.log(`    This means the key is WRONG (poison key?) or the data is corrupted`);
          // Check if it's a known pattern
          if (decrypted.slice(0, 4).toString('utf8').match(/^[{<\[]/)) {
            console.log(`    Looks like JSON/HTML error: ${decrypted.slice(0, 200).toString('utf8')}`);
          }
        }
      } catch (e) {
        console.log(`    ❌ Decrypt failed: ${e.message}`);
        console.log(`    This usually means wrong key or corrupted data`);
        // Try to see if the raw data is actually text (error response)
        const asText = segResp.buf.slice(0, 200).toString('utf8');
        if (asText.match(/^[{\[<]|error|html|<!DOCTYPE/i)) {
          console.log(`    Raw data looks like text: ${asText}`);
        }
      }
    } else {
      console.log(`    ❌ First byte is 0x${segResp.buf[0].toString(16).padStart(2,'0')}, not 0x47`);
      console.log(`    No valid key to attempt decryption`);
      // Check if it's text
      const asText = segResp.buf.slice(0, 200).toString('utf8');
      if (asText.match(/^[{\[<]|error|html|<!DOCTYPE/i)) {
        console.log(`    Raw data looks like text/error: ${asText}`);
      }
    }
  }

  console.log('\n=== Done ===');
}

main().catch(console.error);
