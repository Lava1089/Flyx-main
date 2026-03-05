#!/usr/bin/env node
/**
 * Test fetching key with proper PoW authentication
 * Compares key from proxy (no PoW) vs direct with PoW
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

const API_URL = 'http://127.0.0.1:8787';
const API_KEY = 'test';

// Load WASM
async function loadWasm() {
  const wasmPath = path.join(__dirname, '../../pow_wasm_bg.wasm');
  const wasmBuffer = fs.readFileSync(wasmPath);
  
  const imports = {
    "./pow_wasm_bg.js": {}
  };
  
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
  
  const nonce = wasm.compute_nonce(resPtr, resLen, numPtr, numLen, BigInt(timestamp));
  return nonce;
}

function fetchLocal(url) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const req = http.request({
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: { 'X-API-Key': API_KEY },
      timeout: 60000,
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, data: Buffer.concat(chunks) }));
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.end();
  });
}

function fetchHttps(url, headers) {
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
        'Origin': 'https://dlhd.link',
        'Referer': 'https://dlhd.link/',
        ...headers,
      },
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, data: Buffer.concat(chunks) }));
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.end();
  });
}

function tryDecrypt(segment, key, iv, name) {
  try {
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(segment.slice(0, 2048)), decipher.final()]);
    
    let syncCount = 0;
    for (let i = 0; i < Math.min(decrypted.length, 10 * 188); i += 188) {
      if (decrypted[i] === 0x47) syncCount++;
    }
    
    if (syncCount >= 5) {
      console.log(`   ✅ ${name}: ${syncCount}/10 sync bytes!`);
      return true;
    } else if (decrypted[0] === 0x47) {
      console.log(`   ⚠️  ${name}: First byte 0x47 but only ${syncCount} sync bytes`);
    }
    return false;
  } catch (e) {
    return false;
  }
}

async function main() {
  console.log('═'.repeat(70));
  console.log('TEST POW KEY AUTHENTICATION');
  console.log('═'.repeat(70));
  
  // Load WASM
  console.log('\n1. Loading WASM...');
  const wasm = await loadWasm();
  console.log('   ✅ WASM loaded');
  
  // Get stream data
  console.log('\n2. Getting stream data...');
  const streamRes = await fetchLocal(`${API_URL}/stream/31`);
  const streamData = JSON.parse(streamRes.data.toString());
  console.log(`   Stream URL: ${streamData.streamUrl.substring(0, 80)}...`);
  console.log(`   JWT: ${streamData.jwt?.substring(0, 50)}...`);
  
  // Get M3U8
  console.log('\n3. Getting M3U8...');
  const m3u8Res = await fetchLocal(streamData.streamUrl + '&key=' + API_KEY);
  const m3u8Content = m3u8Res.data.toString();
  
  // Parse M3U8
  let keyUrl = null;
  let ivHex = null;
  let segmentUrl = null;
  let originalKeyUrl = null;
  
  for (const line of m3u8Content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.includes('#EXT-X-KEY')) {
      const uriMatch = trimmed.match(/URI="([^"]+)"/);
      if (uriMatch) keyUrl = uriMatch[1];
      const ivMatch = trimmed.match(/IV=0x([0-9a-fA-F]+)/i);
      if (ivMatch) ivHex = ivMatch[1];
    }
    if (!segmentUrl && trimmed.startsWith('http') && trimmed.includes('/live/ts')) {
      segmentUrl = trimmed;
    }
  }
  
  // Extract original key URL from proxy URL
  const keyUrlObj = new URL(keyUrl);
  const encodedUrl = keyUrlObj.searchParams.get('url');
  if (encodedUrl) {
    // URL-safe base64 decode
    let base64 = encodedUrl.replace(/-/g, '+').replace(/_/g, '/');
    const padding = base64.length % 4;
    if (padding) base64 += '='.repeat(4 - padding);
    originalKeyUrl = Buffer.from(base64, 'base64').toString();
  }
  
  console.log(`   Key URL (proxy): ${keyUrl.substring(0, 80)}...`);
  console.log(`   Original Key URL: ${originalKeyUrl}`);
  console.log(`   IV: ${ivHex}`);
  
  // Fetch key via proxy (no PoW)
  console.log('\n4. Fetching key via proxy (NO PoW)...');
  const proxyKeyRes = await fetchLocal(keyUrl);
  const proxyKey = proxyKeyRes.data;
  console.log(`   Proxy key: ${proxyKey.toString('hex')}`);
  console.log(`   Length: ${proxyKey.length} bytes`);
  
  // Parse key URL for PoW
  const keyMatch = originalKeyUrl.match(/\/key\/([^/]+)\/(\d+)/);
  if (!keyMatch) {
    console.log('   ❌ Could not parse key URL');
    return;
  }
  
  const resource = keyMatch[1];
  const keyNumber = keyMatch[2];
  console.log(`   Resource: ${resource}, Key Number: ${keyNumber}`);
  
  // Compute PoW nonce
  console.log('\n5. Computing PoW nonce...');
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = computeNonce(wasm, resource, keyNumber, timestamp);
  console.log(`   Timestamp: ${timestamp}`);
  console.log(`   Nonce: ${nonce}`);
  
  // Fetch key directly with PoW
  console.log('\n6. Fetching key directly WITH PoW...');
  const directKeyRes = await fetchHttps(originalKeyUrl, {
    'Authorization': `Bearer ${streamData.jwt}`,
    'X-Key-Timestamp': timestamp.toString(),
    'X-Key-Nonce': nonce.toString(),
  });
  
  console.log(`   Status: ${directKeyRes.status}`);
  if (directKeyRes.error) {
    console.log(`   Error: ${directKeyRes.error}`);
  } else {
    const directKey = directKeyRes.data;
    console.log(`   Direct key: ${directKey.toString('hex')}`);
    console.log(`   Length: ${directKey.length} bytes`);
    
    // Compare keys
    console.log('\n7. Comparing keys...');
    if (proxyKey.equals(directKey)) {
      console.log('   ⚠️  Keys are IDENTICAL - PoW might not be required');
    } else {
      console.log('   🔑 Keys are DIFFERENT!');
      console.log(`   Proxy key:  ${proxyKey.toString('hex')}`);
      console.log(`   Direct key: ${directKey.toString('hex')}`);
    }
    
    // Fetch segment
    console.log('\n8. Fetching segment...');
    const segRes = await fetchLocal(segmentUrl);
    const segment = segRes.data;
    console.log(`   Segment size: ${segment.length} bytes`);
    
    // Try decryption with both keys
    console.log('\n9. Testing decryption...');
    const iv = Buffer.from(ivHex, 'hex');
    
    console.log('   With PROXY key:');
    tryDecrypt(segment, proxyKey, iv, 'Proxy key + M3U8 IV');
    
    console.log('   With DIRECT key:');
    tryDecrypt(segment, directKey, iv, 'Direct key + M3U8 IV');
    
    // Try zero IV
    const zeroIv = Buffer.alloc(16, 0);
    console.log('   With zero IV:');
    tryDecrypt(segment, proxyKey, zeroIv, 'Proxy key + Zero IV');
    tryDecrypt(segment, directKey, zeroIv, 'Direct key + Zero IV');
  }
}

main().catch(console.error);
