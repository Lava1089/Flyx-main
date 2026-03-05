#!/usr/bin/env node
/**
 * Reverse engineer the WASM PoW algorithm by testing different hash methods
 */

const crypto = require('crypto');
const fs = require('fs');

const WASM_SECRET_KEY = '444c44cc8888888844444444';

// Load WASM and get nonce
async function getWASMNonce(resource, keyNumber, timestamp) {
  const wasmBuffer = fs.readFileSync('pow_wasm_bg.wasm');
  
  let wasm;
  let cachedUint8ArrayMemory0 = null;
  let WASM_VECTOR_LEN = 0;
  
  function getUint8ArrayMemory0() {
    if (!cachedUint8ArrayMemory0 || cachedUint8ArrayMemory0.byteLength === 0) {
      cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
  }
  
  const enc = new TextEncoder();
  function passStringToWasm0(arg, malloc) {
    const buf = enc.encode(arg);
    const ptr = malloc(buf.length, 1) >>> 0;
    getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
    WASM_VECTOR_LEN = buf.length;
    return ptr;
  }
  
  const { instance } = await WebAssembly.instantiate(wasmBuffer, { './pow_wasm_bg.js': {} });
  wasm = instance.exports;
  
  const ptr0 = passStringToWasm0(resource, wasm.__wbindgen_export);
  const len0 = WASM_VECTOR_LEN;
  const ptr1 = passStringToWasm0(keyNumber, wasm.__wbindgen_export);
  const len1 = WASM_VECTOR_LEN;
  
  return Number(wasm.compute_nonce(ptr0, len0, ptr1, len1, BigInt(timestamp)));
}

// Test different hash algorithms and data formats
async function testAlgorithms() {
  const resource = 'premium51';
  const keyNumber = '5893400';
  const timestamp = 1769533898;
  
  const wasmNonce = await getWASMNonce(resource, keyNumber, timestamp);
  console.log(`WASM nonce for ${resource}/${keyNumber}@${timestamp}: ${wasmNonce}`);
  console.log();
  
  // Try different data formats
  const formats = [
    // Format 1: secret + resource + number + timestamp + nonce
    (n) => `${WASM_SECRET_KEY}${resource}${keyNumber}${timestamp}${n}`,
    // Format 2: resource + number + timestamp + nonce + secret
    (n) => `${resource}${keyNumber}${timestamp}${n}${WASM_SECRET_KEY}`,
    // Format 3: resource + number + timestamp + nonce (no secret)
    (n) => `${resource}${keyNumber}${timestamp}${n}`,
    // Format 4: secret:resource:number:timestamp:nonce
    (n) => `${WASM_SECRET_KEY}:${resource}:${keyNumber}:${timestamp}:${n}`,
    // Format 5: HMAC with secret as key
    (n) => crypto.createHmac('sha256', WASM_SECRET_KEY).update(`${resource}${keyNumber}${timestamp}${n}`).digest('hex'),
    // Format 6: resource|number|timestamp|nonce
    (n) => `${resource}|${keyNumber}|${timestamp}|${n}`,
  ];
  
  const hashAlgos = ['sha256', 'md5', 'sha1'];
  const thresholds = [0x0100, 0x1000, 0x0010, 0x00FF, 0x0080];
  
  // Test each combination
  for (let fi = 0; fi < formats.length; fi++) {
    for (const algo of hashAlgos) {
      for (const threshold of thresholds) {
        // Find nonce with this combination
        for (let nonce = 0; nonce <= wasmNonce + 100; nonce++) {
          let data;
          if (fi === 4) {
            // HMAC format returns hex string
            data = formats[fi](nonce);
          } else {
            data = formats[fi](nonce);
          }
          
          let hash;
          if (fi === 4) {
            // Already hashed
            hash = Buffer.from(data, 'hex');
          } else {
            hash = crypto.createHash(algo).update(data).digest();
          }
          
          const prefix = (hash[0] << 8) | hash[1];
          
          if (prefix < threshold) {
            if (nonce === wasmNonce) {
              console.log(`✅ MATCH! Format ${fi + 1}, ${algo}, threshold 0x${threshold.toString(16)}`);
              console.log(`   Data: ${formats[fi](nonce).substring(0, 80)}...`);
              console.log(`   Hash: ${hash.toString('hex').substring(0, 32)}...`);
              console.log(`   Prefix: 0x${prefix.toString(16)}`);
            }
            break;
          }
        }
      }
    }
  }
}

testAlgorithms().catch(console.error);
