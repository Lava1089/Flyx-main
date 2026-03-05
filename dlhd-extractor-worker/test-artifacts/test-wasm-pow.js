#!/usr/bin/env node
/**
 * Test WASM PoW module
 * Extracts secret key and computes nonces
 */

const fs = require('fs');
const path = require('path');

// Load WASM binary
const wasmPath = path.join(__dirname, 'pow_wasm_bg.wasm');
const wasmBuffer = fs.readFileSync(wasmPath);

let wasm;
let cachedUint8ArrayMemory0 = null;
let cachedDataViewMemory0 = null;
let WASM_VECTOR_LEN = 0;

function getUint8ArrayMemory0() {
  if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
    cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
  }
  return cachedUint8ArrayMemory0;
}

function getDataViewMemory0() {
  if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer !== wasm.memory.buffer) {
    cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
  }
  return cachedDataViewMemory0;
}

const cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
const cachedTextEncoder = new TextEncoder();

function getStringFromWasm0(ptr, len) {
  ptr = ptr >>> 0;
  return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

function passStringToWasm0(arg, malloc, realloc) {
  const buf = cachedTextEncoder.encode(arg);
  const ptr = malloc(buf.length, 1) >>> 0;
  getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
  WASM_VECTOR_LEN = buf.length;
  return ptr;
}

function get_secret_key() {
  const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
  wasm.get_secret_key(retptr);
  const r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
  const r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
  const result = getStringFromWasm0(r0, r1);
  wasm.__wbindgen_add_to_stack_pointer(16);
  wasm.__wbindgen_export3(r0, r1, 1);
  return result;
}

function get_version() {
  const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
  wasm.get_version(retptr);
  const r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
  const r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
  const result = getStringFromWasm0(r0, r1);
  wasm.__wbindgen_add_to_stack_pointer(16);
  wasm.__wbindgen_export3(r0, r1, 1);
  return result;
}

function compute_nonce(resource, number, timestamp) {
  const ptr0 = passStringToWasm0(resource, wasm.__wbindgen_export, wasm.__wbindgen_export2);
  const len0 = WASM_VECTOR_LEN;
  const ptr1 = passStringToWasm0(number, wasm.__wbindgen_export, wasm.__wbindgen_export2);
  const len1 = WASM_VECTOR_LEN;
  const ret = wasm.compute_nonce(ptr0, len0, ptr1, len1, BigInt(timestamp));
  return ret;
}

function verify_nonce(resource, number, timestamp, nonce) {
  const ptr0 = passStringToWasm0(resource, wasm.__wbindgen_export, wasm.__wbindgen_export2);
  const len0 = WASM_VECTOR_LEN;
  const ptr1 = passStringToWasm0(number, wasm.__wbindgen_export, wasm.__wbindgen_export2);
  const len1 = WASM_VECTOR_LEN;
  const ret = wasm.verify_nonce(ptr0, len0, ptr1, len1, BigInt(timestamp), BigInt(nonce));
  return ret !== 0;
}

async function main() {
  // Instantiate WASM
  const imports = { "./pow_wasm_bg.js": {} };
  const { instance } = await WebAssembly.instantiate(wasmBuffer, imports);
  wasm = instance.exports;
  
  console.log('=== WASM PoW Module Test ===\n');
  
  // Get version
  const version = get_version();
  console.log(`Version: ${version}`);
  
  // Get secret key
  const secretKey = get_secret_key();
  console.log(`Secret Key: ${secretKey}`);
  console.log(`Secret Key Length: ${secretKey.length}`);
  
  // Test nonce computation
  const resource = 'premium51';
  const keyNumber = '5893400';
  const timestamp = Math.floor(Date.now() / 1000);
  
  console.log(`\n=== Testing Nonce Computation ===`);
  console.log(`Resource: ${resource}`);
  console.log(`Key Number: ${keyNumber}`);
  console.log(`Timestamp: ${timestamp}`);
  
  const nonce = compute_nonce(resource, keyNumber, timestamp);
  console.log(`Computed Nonce: ${nonce}`);
  
  // Verify the nonce
  const isValid = verify_nonce(resource, keyNumber, timestamp, nonce);
  console.log(`Nonce Valid: ${isValid}`);
  
  // Output for use in key fetch
  console.log(`\n=== Headers for Key Fetch ===`);
  console.log(`X-Key-Timestamp: ${timestamp}`);
  console.log(`X-Key-Nonce: ${nonce}`);
}

main().catch(console.error);
