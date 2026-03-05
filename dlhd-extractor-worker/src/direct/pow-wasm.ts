/**
 * WASM Proof-of-Work Module for DLHD Authentication
 * 
 * This module wraps the DLHD WASM PoW computation for use in Cloudflare Workers.
 * The WASM binary is bundled with the worker at build time.
 * 
 * Required for key requests:
 * - X-Key-Timestamp: Unix timestamp
 * - X-Key-Nonce: Computed PoW nonce
 */

// Import WASM module - bundled at build time by wrangler
// @ts-ignore - WASM module binding
import wasmModule from './pow_wasm_bg.wasm';

// WASM module state
let wasmInstance: WebAssembly.Instance | null = null;
let wasmExports: any = null;

// Memory helpers
let cachedUint8ArrayMemory: Uint8Array | null = null;
let WASM_VECTOR_LEN = 0;

const cachedTextEncoder = new TextEncoder();
const cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });

/**
 * Initialize WASM module from bundled binary
 */
export async function initWasm(): Promise<boolean> {
  if (wasmExports) return true;

  try {
    const imports = { './pow_wasm_bg.js': {} };
    const instance = await WebAssembly.instantiate(wasmModule, imports);
    wasmInstance = instance;
    wasmExports = instance.exports;
    console.log('[PoW-WASM] Module initialized');
    return true;
  } catch (e) {
    console.error('[PoW-WASM] Init failed:', e);
    return false;
  }
}

/**
 * Initialize WASM from URL (fetches the binary) - DEPRECATED
 * Use initWasm() instead which uses the bundled WASM
 */
export async function initWasmFromUrl(_url: string): Promise<boolean> {
  // Just use the bundled WASM
  return initWasm();
}

function getUint8ArrayMemory(): Uint8Array {
  if (!cachedUint8ArrayMemory || cachedUint8ArrayMemory.byteLength === 0) {
    cachedUint8ArrayMemory = new Uint8Array(wasmExports.memory.buffer);
  }
  return cachedUint8ArrayMemory;
}

function getDataViewMemory(): DataView {
  return new DataView(wasmExports.memory.buffer);
}

function passStringToWasm(arg: string, malloc: any): number {
  const buf = cachedTextEncoder.encode(arg);
  const ptr = malloc(buf.length, 1) >>> 0;
  getUint8ArrayMemory().subarray(ptr, ptr + buf.length).set(buf);
  WASM_VECTOR_LEN = buf.length;
  return ptr;
}

function getStringFromWasm(ptr: number, len: number): string {
  ptr = ptr >>> 0;
  return cachedTextDecoder.decode(getUint8ArrayMemory().subarray(ptr, ptr + len));
}

/**
 * Compute PoW nonce for a key request
 * 
 * @param resource - Channel key (e.g., "premium51")
 * @param keyNumber - Key segment number from URL
 * @param timestamp - Unix timestamp
 * @returns Computed nonce
 */
export async function computeNonce(
  resource: string,
  keyNumber: string,
  timestamp: number
): Promise<bigint> {
  if (!wasmExports) {
    throw new Error('WASM not initialized');
  }

  // Reset memory cache after potential reallocation
  cachedUint8ArrayMemory = null;

  const ptr0 = passStringToWasm(resource, wasmExports.__wbindgen_export);
  const len0 = WASM_VECTOR_LEN;
  const ptr1 = passStringToWasm(keyNumber, wasmExports.__wbindgen_export);
  const len1 = WASM_VECTOR_LEN;

  const nonce = wasmExports.compute_nonce(ptr0, len0, ptr1, len1, BigInt(timestamp));
  return BigInt.asUintN(64, nonce);
}

/**
 * Get WASM module version
 */
export async function getVersion(): Promise<string> {
  if (!wasmExports) return 'not-initialized';

  cachedUint8ArrayMemory = null;
  const retptr = wasmExports.__wbindgen_add_to_stack_pointer(-16);
  wasmExports.get_version(retptr);
  const r0 = getDataViewMemory().getInt32(retptr + 0, true);
  const r1 = getDataViewMemory().getInt32(retptr + 4, true);
  const version = getStringFromWasm(r0, r1);
  wasmExports.__wbindgen_add_to_stack_pointer(16);
  wasmExports.__wbindgen_export3(r0, r1, 1);
  return version;
}

/**
 * Check if WASM is initialized
 */
export function isInitialized(): boolean {
  return wasmExports !== null;
}

/**
 * WASM binary URL (DLHD's official WASM)
 */
export const WASM_URL = 'https://333418.fun/pow/pow_wasm_bg.wasm';
