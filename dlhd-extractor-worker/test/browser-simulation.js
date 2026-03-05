#!/usr/bin/env node
/**
 * Simulate exactly what the browser does to fetch and decrypt
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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
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

function computeNonce(wasm, resource, number, timestamp) {
  const { ptr: resPtr, len: resLen } = passStringToWasm(wasm, resource);
  const { ptr: numPtr, len: numLen } = passStringToWasm(wasm, number);
  return wasm.compute_nonce(resPtr, resLen, numPtr, numLen, BigInt(timestamp));
}

async function main() {
  console.log('═'.repeat(70));
  console.log('BROWSER SIMULATION');
  console.log('═'.repeat(70));
  
  // Load WASM
  const wasm = await loadWasm();
  console.log('✅ WASM loaded');
  
  // Simulate browser: get JWT token (from the page)
  // In the real page, this is embedded in the HTML
  // Let's extract it from a fresh page load
  
  console.log('\n1. Getting server lookup...');
  const lookupRes = await fetchHttps('https://chevy.dvalna.ru/server_lookup?channel_id=premium31');
  const lookupData = JSON.parse(lookupRes.data.toString());
  console.log(`   Server key: ${lookupData.server_key}`);
  
  // Construct M3U8 URL
  const sk = lookupData.server_key;
  const m3u8Url = `https://${sk}new.dvalna.ru/${sk}/premium31/mono.css`;
  console.log(`   M3U8 URL: ${m3u8Url}`);
  
  // Fetch M3U8
  console.log('\n2. Fetching M3U8...');
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
  
  console.log(`   Key URL: ${keyUrl}`);
  console.log(`   IV: ${ivHex}`);
  console.log(`   Segments: ${segmentUrls.length}`);
  
  // Parse key URL for PoW
  const keyMatch = keyUrl.match(/\/key\/([^/]+)\/(\d+)/);
  const resource = keyMatch[1];
  const keyNumber = keyMatch[2];
  
  // Compute PoW nonce (like browser does)
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = computeNonce(wasm, resource, keyNumber, timestamp);
  
  console.log('\n3. Fetching key with PoW...');
  console.log(`   Resource: ${resource}`);
  console.log(`   Key number: ${keyNumber}`);
  console.log(`   Timestamp: ${timestamp}`);
  console.log(`   Nonce: ${nonce}`);
  
  // Fetch key with PoW headers (like browser does)
  // Note: Browser also sends Authorization header with JWT
  const keyRes = await fetchHttps(keyUrl, {
    'X-Key-Timestamp': timestamp.toString(),
    'X-Key-Nonce': nonce.toString(),
    // Browser would also send: 'Authorization': 'Bearer ' + SESSION_TOKEN
  });
  
  console.log(`   Key status: ${keyRes.status}`);
  const key = keyRes.data;
  console.log(`   Key: ${key.toString('hex')}`);
  console.log(`   Key length: ${key.length} bytes`);
  
  // Fetch segment
  console.log('\n4. Fetching segment...');
  let segment;
  const segRes = await fetchHttps(segmentUrls[0]);
  
  if (segRes.status === 302) {
    const redirectUrl = segRes.headers.location;
    console.log(`   Redirect to: ${redirectUrl.substring(0, 60)}...`);
    const segRes2 = await fetchHttps(redirectUrl);
    segment = segRes2.data;
  } else {
    segment = segRes.data;
  }
  
  console.log(`   Segment size: ${segment.length} bytes`);
  console.log(`   First 32 bytes: ${segment.slice(0, 32).toString('hex')}`);
  
  // Try standard HLS.js decryption
  console.log('\n5. Standard HLS.js decryption...');
  const iv = Buffer.from(ivHex, 'hex');
  
  try {
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(segment), decipher.final()]);
    
    console.log(`   Decrypted size: ${decrypted.length} bytes`);
    console.log(`   First 32 bytes: ${decrypted.slice(0, 32).toString('hex')}`);
    console.log(`   First byte: 0x${decrypted[0].toString(16)}`);
    
    // Check for MPEG-TS sync
    let syncCount = 0;
    for (let i = 0; i < Math.min(decrypted.length, 20 * 188); i += 188) {
      if (decrypted[i] === 0x47) syncCount++;
    }
    console.log(`   Sync bytes: ${syncCount}/20`);
    
    if (syncCount >= 10) {
      console.log('   ✅ DECRYPTION SUCCESSFUL!');
      
      // Save decrypted segment
      fs.writeFileSync('decrypted-segment.ts', decrypted);
      console.log('   Saved to decrypted-segment.ts');
    } else {
      console.log('   ❌ Decryption failed - not valid MPEG-TS');
    }
  } catch (e) {
    console.log(`   Error: ${e.message}`);
  }
  
  // Let's also check what the key looks like when fetched WITHOUT PoW
  console.log('\n6. Fetching key WITHOUT PoW...');
  const keyResNoPoW = await fetchHttps(keyUrl);
  const keyNoPoW = keyResNoPoW.data;
  console.log(`   Key (no PoW): ${keyNoPoW.toString('hex')}`);
  console.log(`   Keys match: ${key.equals(keyNoPoW)}`);
  
  // Check if the segment URL contains any decryption hints
  console.log('\n7. Analyzing segment URL...');
  const segUrlPath = new URL(segmentUrls[0]).pathname.substring(1);
  console.log(`   Path length: ${segUrlPath.length} chars`);
  
  // The path is hex-encoded, decode it
  const pathDecoded = Buffer.from(segUrlPath, 'hex');
  console.log(`   Decoded length: ${pathDecoded.length} bytes`);
  console.log(`   First 32 decoded: ${pathDecoded.slice(0, 32).toString('hex')}`);
  
  // Check if any part of the path could be a key or IV
  console.log('\n8. Checking if path contains key/IV info...');
  
  // XOR first 16 bytes of path with key
  const pathXorKey = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) {
    pathXorKey[i] = pathDecoded[i] ^ key[i];
  }
  console.log(`   Path[0:16] XOR Key: ${pathXorKey.toString('hex')}`);
  
  // Check if this could be the real IV
  console.log('\n9. Trying path-derived IV...');
  try {
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, pathDecoded.slice(0, 16));
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(segment.slice(0, 2048)), decipher.final()]);
    
    if (decrypted[0] === 0x47) {
      console.log('   ✅ Path-derived IV works!');
    } else {
      console.log(`   First byte: 0x${decrypted[0].toString(16)}`);
    }
  } catch (e) {
    console.log(`   Error: ${e.message}`);
  }
}

main().catch(console.error);
