#!/usr/bin/env node
/**
 * Compare our JS PoW implementation against the actual WASM
 */

const crypto = require('crypto');
const fs = require('fs');

// Our reverse-engineered constants
const WASM_SECRET_KEY = '444c44cc8888888844444444';
const POW_THRESHOLD = 0x0100;

// Our JS implementation
function computePoWNonceJS(resource, keyNumber, timestamp) {
  for (let nonce = 0; nonce < 1000000; nonce++) {
    const data = `${WASM_SECRET_KEY}${resource}${keyNumber}${timestamp}${nonce}`;
    const hash = crypto.createHash('sha256').update(data).digest();
    const prefix = (hash[0] << 8) | hash[1];
    if (prefix < POW_THRESHOLD) {
      return nonce;
    }
  }
  return -1;
}

// Load and run WASM
async function computePoWNonceWASM(resource, keyNumber, timestamp) {
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
  
  return wasm.compute_nonce(ptr0, len0, ptr1, len1, BigInt(timestamp));
}

async function main() {
  const testCases = [
    { resource: 'premium51', keyNumber: '5893400', timestamp: 1769533898 },
    { resource: 'premium51', keyNumber: '5893401', timestamp: 1769533898 },
    { resource: 'premium35', keyNumber: '1234567', timestamp: 1769534000 },
  ];
  
  console.log('=== PoW Algorithm Comparison ===\n');
  
  for (const tc of testCases) {
    console.log(`Test: ${tc.resource}/${tc.keyNumber} @ ${tc.timestamp}`);
    
    const wasmNonce = await computePoWNonceWASM(tc.resource, tc.keyNumber, tc.timestamp);
    const jsNonce = computePoWNonceJS(tc.resource, tc.keyNumber, tc.timestamp);
    
    console.log(`  WASM nonce: ${wasmNonce}`);
    console.log(`  JS nonce:   ${jsNonce}`);
    console.log(`  Match: ${wasmNonce.toString() === jsNonce.toString() ? '✅' : '❌'}`);
    console.log();
  }
}

main().catch(console.error);
