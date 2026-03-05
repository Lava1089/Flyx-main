/**
 * DLHD Direct Backend Access Module
 * 
 * This module provides direct access to DLHD's backend APIs,
 * bypassing the frontend entirely for 100% channel coverage.
 */

export {
  fetchAuthData,
  findWorkingServer,
  buildM3U8Url,
  buildKeyUrl,
  extractDirectStream,
  getDirectChannelList,
  type DLHDAuthData,
  type DirectStreamInfo,
} from './dlhd-backend';

export {
  initWasm,
  initWasmFromUrl,
  computeNonce,
  getVersion,
  isInitialized,
  WASM_URL,
} from './pow-wasm';

export {
  fetchKeyWithAuth,
  parseKeyUrl,
  extractChannelFromKeyUrl,
  extractServerFromKeyUrl,
  type KeyFetchResult,
} from './key-fetcher';

// Fast extractor - optimized for speed with caching
export {
  extractFast,
  getServerForChannel,
  getCacheStats,
} from './fast-extractor';
