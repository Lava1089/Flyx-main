#!/usr/bin/env node
/**
 * Investigate WASM functions for segment decryption
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');

const API_URL = 'http://127.0.0.1:8787';
const API_KEY = 'test';

// Load WASM
async function loadWasm() {
  const wasmPath = path.join(__dirname, '../../pow_wasm_bg.wasm');
  const wasmBuffer = fs.readFileSync(wasmPath);
  
  // Create the imports object
  const imports = {
    "./pow_wasm_bg.js": {}
  };
  
  const { instance } = await WebAssembly.instantiate(wasmBuffer, imports);
  return instance.exports;
}

// Helper to get string from WASM memory
function getStringFromWasm(wasm, ptr, len) {
  const memory = new Uint8Array(wasm.memory.buffer);
  return new TextDecoder().decode(memory.subarray(ptr, ptr + len));
}

// Helper to pass string to WASM
function passStringToWasm(wasm, str) {
  const encoded = new TextEncoder().encode(str);
  const ptr = wasm.__wbindgen_export(encoded.length, 1);
  const memory = new Uint8Array(wasm.memory.buffer);
  memory.set(encoded, ptr);
  return { ptr, len: encoded.length };
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

async function main() {
  console.log('═'.repeat(70));
  console.log('INVESTIGATE WASM FUNCTIONS');
  console.log('═'.repeat(70));
  
  // Load WASM
  console.log('\n1. Loading WASM...');
  const wasm = await loadWasm();
  
  console.log('   Exported functions:');
  for (const [name, value] of Object.entries(wasm)) {
    if (typeof value === 'function') {
      console.log(`   - ${name}`);
    }
  }
  
  // Test get_secret_key
  console.log('\n2. Testing get_secret_key()...');
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    wasm.get_secret_key(retptr);
    const memory = new DataView(wasm.memory.buffer);
    const r0 = memory.getInt32(retptr + 0, true);
    const r1 = memory.getInt32(retptr + 4, true);
    wasm.__wbindgen_add_to_stack_pointer(16);
    
    const secretKey = getStringFromWasm(wasm, r0, r1);
    console.log(`   Secret key: ${secretKey}`);
    console.log(`   Secret key hex: ${Buffer.from(secretKey).toString('hex')}`);
    
    // Free the string
    wasm.__wbindgen_export3(r0, r1, 1);
  } catch (e) {
    console.log(`   Error: ${e.message}`);
  }
  
  // Test get_version
  console.log('\n3. Testing get_version()...');
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    wasm.get_version(retptr);
    const memory = new DataView(wasm.memory.buffer);
    const r0 = memory.getInt32(retptr + 0, true);
    const r1 = memory.getInt32(retptr + 4, true);
    wasm.__wbindgen_add_to_stack_pointer(16);
    
    const version = getStringFromWasm(wasm, r0, r1);
    console.log(`   Version: ${version}`);
    
    wasm.__wbindgen_export3(r0, r1, 1);
  } catch (e) {
    console.log(`   Error: ${e.message}`);
  }
  
  // Test compute_key_hash
  console.log('\n4. Testing compute_key_hash()...');
  try {
    const testInput = 'premium31';
    const { ptr: inputPtr, len: inputLen } = passStringToWasm(wasm, testInput);
    
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    wasm.compute_key_hash(retptr, inputPtr, inputLen);
    const memory = new DataView(wasm.memory.buffer);
    const r0 = memory.getInt32(retptr + 0, true);
    const r1 = memory.getInt32(retptr + 4, true);
    wasm.__wbindgen_add_to_stack_pointer(16);
    
    const hash = getStringFromWasm(wasm, r0, r1);
    console.log(`   Input: ${testInput}`);
    console.log(`   Hash: ${hash}`);
    
    wasm.__wbindgen_export3(r0, r1, 1);
  } catch (e) {
    console.log(`   Error: ${e.message}`);
  }
  
  // Get actual key and segment to test decryption
  console.log('\n5. Getting actual key and segment...');
  const streamRes = await fetchLocal(`${API_URL}/stream/31`);
  const streamData = JSON.parse(streamRes.data.toString());
  
  const m3u8Res = await fetchLocal(streamData.streamUrl + '&key=' + API_KEY);
  const m3u8Content = m3u8Res.data.toString();
  
  // Parse M3U8
  let keyUrl = null;
  let ivHex = null;
  let segmentUrl = null;
  
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
  
  // Fetch key
  const keyRes = await fetchLocal(keyUrl);
  const key = keyRes.data;
  console.log(`   Key: ${key.toString('hex')}`);
  console.log(`   IV: ${ivHex}`);
  
  // Fetch segment
  const segRes = await fetchLocal(segmentUrl);
  const segment = segRes.data;
  console.log(`   Segment size: ${segment.length}`);
  
  // Try using secret key for decryption
  console.log('\n6. Trying secret key for decryption...');
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    wasm.get_secret_key(retptr);
    const memory = new DataView(wasm.memory.buffer);
    const r0 = memory.getInt32(retptr + 0, true);
    const r1 = memory.getInt32(retptr + 4, true);
    wasm.__wbindgen_add_to_stack_pointer(16);
    
    const secretKey = getStringFromWasm(wasm, r0, r1);
    wasm.__wbindgen_export3(r0, r1, 1);
    
    console.log(`   Secret key: ${secretKey}`);
    
    // Try secret key as decryption key
    const secretKeyBuffer = Buffer.from(secretKey, 'hex').slice(0, 16);
    if (secretKeyBuffer.length === 16) {
      console.log(`   Secret key (16 bytes): ${secretKeyBuffer.toString('hex')}`);
      
      const iv = Buffer.from(ivHex, 'hex');
      
      try {
        const decipher = crypto.createDecipheriv('aes-128-cbc', secretKeyBuffer, iv);
        decipher.setAutoPadding(false);
        const decrypted = Buffer.concat([decipher.update(segment.slice(0, 1024)), decipher.final()]);
        
        if (decrypted[0] === 0x47) {
          console.log(`   ✅ SECRET KEY WORKS! First byte is 0x47`);
        } else {
          console.log(`   ❌ First byte is 0x${decrypted[0].toString(16)}`);
        }
      } catch (e) {
        console.log(`   Decryption error: ${e.message}`);
      }
    }
    
    // Try XOR of key and secret key
    console.log('\n7. Trying XOR combinations...');
    const xorKey = Buffer.alloc(16);
    for (let i = 0; i < 16; i++) {
      xorKey[i] = key[i] ^ secretKeyBuffer[i % secretKeyBuffer.length];
    }
    console.log(`   Key XOR Secret: ${xorKey.toString('hex')}`);
    
    try {
      const iv = Buffer.from(ivHex, 'hex');
      const decipher = crypto.createDecipheriv('aes-128-cbc', xorKey, iv);
      decipher.setAutoPadding(false);
      const decrypted = Buffer.concat([decipher.update(segment.slice(0, 1024)), decipher.final()]);
      
      if (decrypted[0] === 0x47) {
        console.log(`   ✅ XOR KEY WORKS!`);
      } else {
        console.log(`   ❌ First byte is 0x${decrypted[0].toString(16)}`);
      }
    } catch (e) {
      console.log(`   Error: ${e.message}`);
    }
    
  } catch (e) {
    console.log(`   Error: ${e.message}`);
  }
  
  // Try compute_key_hash on various inputs
  console.log('\n8. Testing compute_key_hash with various inputs...');
  const testInputs = [
    'premium31',
    key.toString('hex'),
    ivHex,
    key.toString('hex') + ivHex,
  ];
  
  for (const input of testInputs) {
    try {
      const { ptr: inputPtr, len: inputLen } = passStringToWasm(wasm, input);
      
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.compute_key_hash(retptr, inputPtr, inputLen);
      const memory = new DataView(wasm.memory.buffer);
      const r0 = memory.getInt32(retptr + 0, true);
      const r1 = memory.getInt32(retptr + 4, true);
      wasm.__wbindgen_add_to_stack_pointer(16);
      
      const hash = getStringFromWasm(wasm, r0, r1);
      console.log(`   Input: ${input.substring(0, 30)}... -> Hash: ${hash.substring(0, 32)}...`);
      
      // Try hash as key
      const hashKey = Buffer.from(hash, 'hex').slice(0, 16);
      if (hashKey.length === 16) {
        try {
          const iv = Buffer.from(ivHex, 'hex');
          const decipher = crypto.createDecipheriv('aes-128-cbc', hashKey, iv);
          decipher.setAutoPadding(false);
          const decrypted = Buffer.concat([decipher.update(segment.slice(0, 1024)), decipher.final()]);
          
          if (decrypted[0] === 0x47) {
            console.log(`   ✅ HASH KEY WORKS!`);
          }
        } catch (e) {}
      }
      
      wasm.__wbindgen_export3(r0, r1, 1);
    } catch (e) {
      console.log(`   Error for ${input.substring(0, 20)}: ${e.message}`);
    }
  }
}

main().catch(console.error);
