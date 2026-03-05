#!/usr/bin/env node
/**
 * Check correlation between segment URL, key, and IV
 */

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function fetchHttps(url, headers = {}) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
        'Origin': 'https://hitsplay.fun',
        'Referer': 'https://hitsplay.fun/',
        ...headers,
      },
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, data: Buffer.concat(chunks), headers: res.headers }));
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.end();
  });
}

// Load WASM
async function loadWasm() {
  const wasmPath = path.join(__dirname, '../../pow_wasm_bg.wasm');
  const wasmBuffer = fs.readFileSync(wasmPath);
  
  const imports = { "./pow_wasm_bg.js": {} };
  const { instance } = await WebAssembly.instantiate(wasmBuffer, imports);
  return instance.exports;
}

function getStringFromWasm(wasm, ptr, len) {
  const memory = new Uint8Array(wasm.memory.buffer);
  return new TextDecoder().decode(memory.subarray(ptr, ptr + len));
}

function passStringToWasm(wasm, str) {
  const encoded = new TextEncoder().encode(str);
  const ptr = wasm.__wbindgen_export(encoded.length, 1);
  const memory = new Uint8Array(wasm.memory.buffer);
  memory.set(encoded, ptr);
  return { ptr, len: encoded.length };
}

async function main() {
  console.log('═'.repeat(70));
  console.log('SEGMENT-KEY CORRELATION ANALYSIS');
  console.log('═'.repeat(70));
  
  // Load WASM
  const wasm = await loadWasm();
  
  // Get secret key
  const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
  wasm.get_secret_key(retptr);
  const memory = new DataView(wasm.memory.buffer);
  const r0 = memory.getInt32(retptr + 0, true);
  const r1 = memory.getInt32(retptr + 4, true);
  wasm.__wbindgen_add_to_stack_pointer(16);
  const secretKey = getStringFromWasm(wasm, r0, r1);
  wasm.__wbindgen_export3(r0, r1, 1);
  
  console.log(`\nSecret key from WASM: ${secretKey}`);
  
  // Get M3U8
  console.log('\n1. Fetching M3U8...');
  const lookupRes = await fetchHttps('https://chevy.dvalna.ru/server_lookup?channel_id=premium31');
  const lookupData = JSON.parse(lookupRes.data.toString());
  const sk = lookupData.server_key;
  const m3u8Url = `https://${sk}new.dvalna.ru/${sk}/premium31/mono.css`;
  
  const m3u8Res = await fetchHttps(m3u8Url);
  const m3u8Content = m3u8Res.data.toString();
  
  // Parse M3U8
  let keyUrl = null;
  let ivHex = null;
  let segmentUrls = [];
  
  for (const line of m3u8Content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.includes('#EXT-X-KEY')) {
      const uriMatch = trimmed.match(/URI="([^"]+)"/);
      if (uriMatch) keyUrl = uriMatch[1];
      const ivMatch = trimmed.match(/IV=0x([0-9a-fA-F]+)/i);
      if (ivMatch) ivHex = ivMatch[1];
    }
    if (trimmed.startsWith('http') && !trimmed.startsWith('#')) {
      segmentUrls.push(trimmed);
    }
  }
  
  // Extract key number
  const keyMatch = keyUrl.match(/\/key\/([^/]+)\/(\d+)/);
  const keyNumber = keyMatch ? keyMatch[2] : 'unknown';
  
  console.log(`   Key URL: ${keyUrl}`);
  console.log(`   Key number: ${keyNumber}`);
  console.log(`   IV: ${ivHex}`);
  console.log(`   Segments: ${segmentUrls.length}`);
  
  // Analyze IV
  const ivSuffix = ivHex.substring(24);
  const ivTimestamp = parseInt(ivSuffix, 16);
  console.log(`\n2. IV Analysis:`);
  console.log(`   IV suffix: ${ivSuffix}`);
  console.log(`   As timestamp: ${ivTimestamp} = ${new Date(ivTimestamp * 1000).toISOString()}`);
  console.log(`   Current time: ${Math.floor(Date.now()/1000)}`);
  
  // Fetch key
  console.log('\n3. Fetching key...');
  const keyRes = await fetchHttps(keyUrl);
  const key = keyRes.data;
  console.log(`   Key: ${key.toString('hex')}`);
  
  // Analyze segment URL
  console.log('\n4. Segment URL Analysis:');
  const segUrl = new URL(segmentUrls[0]);
  const segPath = segUrl.pathname.substring(1); // Remove leading /
  console.log(`   Path: ${segPath.substring(0, 80)}...`);
  console.log(`   Path length: ${segPath.length} chars = ${segPath.length / 2} bytes`);
  
  // Decode segment path
  const segPathBuf = Buffer.from(segPath, 'hex');
  console.log(`   First 32 bytes: ${segPathBuf.slice(0, 32).toString('hex')}`);
  
  // Check if key number is in segment path
  console.log(`\n5. Looking for key number in segment path...`);
  const keyNumHex = parseInt(keyNumber).toString(16);
  console.log(`   Key number as hex: ${keyNumHex}`);
  console.log(`   Found in path: ${segPath.includes(keyNumHex)}`);
  
  // Check if IV suffix is in segment path
  console.log(`   IV suffix in path: ${segPath.includes(ivSuffix)}`);
  
  // XOR segment path with key
  console.log('\n6. XOR analysis with key...');
  const xorWithKey = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) {
    xorWithKey[i] = segPathBuf[i] ^ key[i];
  }
  console.log(`   First 16 bytes XOR key: ${xorWithKey.toString('hex')}`);
  console.log(`   As ASCII: ${xorWithKey.toString('ascii')}`);
  
  // XOR with secret key
  const secretKeyBuf = Buffer.from(secretKey, 'hex');
  const xorWithSecret = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) {
    xorWithSecret[i] = segPathBuf[i] ^ secretKeyBuf[i % secretKeyBuf.length];
  }
  console.log(`   First 16 bytes XOR secret: ${xorWithSecret.toString('hex')}`);
  
  // Fetch segment and analyze
  console.log('\n7. Fetching segment...');
  const segRes = await fetchHttps(segmentUrls[0]);
  
  if (segRes.status === 302) {
    const redirectUrl = segRes.headers.location;
    console.log(`   Redirect to: ${redirectUrl.substring(0, 80)}...`);
    
    const segRes2 = await fetchHttps(redirectUrl);
    if (segRes2.status === 200) {
      const segment = segRes2.data;
      console.log(`   Size: ${segment.length} bytes`);
      console.log(`   First 32 bytes: ${segment.slice(0, 32).toString('hex')}`);
      
      // Try various decryption approaches
      console.log('\n8. Decryption attempts...');
      const iv = Buffer.from(ivHex, 'hex');
      
      const attempts = [
        { name: 'Standard', key: key, iv: iv },
        { name: 'Zero IV', key: key, iv: Buffer.alloc(16, 0) },
        { name: 'Key as IV', key: key, iv: key },
        { name: 'Secret as key', key: Buffer.concat([secretKeyBuf, Buffer.alloc(16)]).slice(0, 16), iv: iv },
        { name: 'Key XOR Secret', key: Buffer.from(key.map((b, i) => b ^ secretKeyBuf[i % secretKeyBuf.length])), iv: iv },
        { name: 'Segment prefix as IV', key: key, iv: segPathBuf.slice(0, 16) },
      ];
      
      for (const attempt of attempts) {
        try {
          const decipher = crypto.createDecipheriv('aes-128-cbc', attempt.key, attempt.iv);
          decipher.setAutoPadding(false);
          const decrypted = Buffer.concat([decipher.update(segment.slice(0, 2048)), decipher.final()]);
          
          let syncCount = 0;
          for (let i = 0; i < Math.min(decrypted.length, 10 * 188); i += 188) {
            if (decrypted[i] === 0x47) syncCount++;
          }
          
          if (syncCount >= 5) {
            console.log(`   ✅ ${attempt.name}: ${syncCount}/10 sync bytes!`);
          } else if (decrypted[0] === 0x47) {
            console.log(`   ⚠️  ${attempt.name}: First byte 0x47, ${syncCount} sync bytes`);
          }
        } catch (e) {
          // Silent fail
        }
      }
      
      // Check if segment has a header we need to skip
      console.log('\n9. Checking for segment header...');
      for (const offset of [16, 32, 64, 128, 188, 256, 512]) {
        try {
          const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
          decipher.setAutoPadding(false);
          const decrypted = Buffer.concat([decipher.update(segment.slice(offset, offset + 2048)), decipher.final()]);
          
          if (decrypted[0] === 0x47) {
            console.log(`   ✅ Offset ${offset}: First byte is 0x47!`);
            
            let syncCount = 0;
            for (let i = 0; i < Math.min(decrypted.length, 10 * 188); i += 188) {
              if (decrypted[i] === 0x47) syncCount++;
            }
            console.log(`      Sync bytes: ${syncCount}/10`);
          }
        } catch (e) {
          // Silent fail
        }
      }
    }
  }
}

main().catch(console.error);
