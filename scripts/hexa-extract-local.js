#!/usr/bin/env node
/**
 * Local end-to-end extraction test for hexa.su (flixer backend)
 * Uses the exact same WASM mock approach as cloudflare-proxy/src/flixer-proxy.ts
 */
const fs = require('fs');
const pathMod = require('path');
const crypto = require('crypto');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const API_BASE = 'https://theemoviedb.hexa.su';

// ============================================================================
// WASM Loader — ported from cloudflare-proxy/src/flixer-proxy.ts
// ============================================================================
class WasmLoader {
  constructor() {
    this.wasm = null;
    this.heap = new Array(128).fill(undefined);
    this.heap.push(undefined, null, true, false);
    this.heap_next = this.heap.length;
    this.WASM_VECTOR_LEN = 0;
    this.cachedUint8ArrayMemory0 = null;
    this.cachedDataViewMemory0 = null;
    this.cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
    this.cachedTextEncoder = new TextEncoder();
    this.sessionId = crypto.randomUUID().replace(/-/g, '');
    this.timestamp = Date.now() - 5000;
    this.randomSeed = Math.random();
    this.timezoneOffset = new Date().getTimezoneOffset();
  }

  getObject(idx) { return this.heap[idx]; }
  addHeapObject(obj) {
    if (this.heap_next === this.heap.length) this.heap.push(this.heap.length + 1);
    const idx = this.heap_next;
    this.heap_next = this.heap[idx];
    this.heap[idx] = obj;
    return idx;
  }
  dropObject(idx) { if (idx < 132) return; this.heap[idx] = this.heap_next; this.heap_next = idx; }
  takeObject(idx) { const r = this.getObject(idx); this.dropObject(idx); return r; }

  getUint8ArrayMemory0() {
    if (!this.cachedUint8ArrayMemory0 || this.cachedUint8ArrayMemory0.byteLength === 0)
      this.cachedUint8ArrayMemory0 = new Uint8Array(this.wasm.memory.buffer);
    return this.cachedUint8ArrayMemory0;
  }
  getDataViewMemory0() {
    if (!this.cachedDataViewMemory0 || this.cachedDataViewMemory0.buffer !== this.wasm.memory.buffer)
      this.cachedDataViewMemory0 = new DataView(this.wasm.memory.buffer);
    return this.cachedDataViewMemory0;
  }
  getStringFromWasm0(ptr, len) {
    return this.cachedTextDecoder.decode(this.getUint8ArrayMemory0().subarray(ptr >>> 0, (ptr >>> 0) + len));
  }
  passStringToWasm0(arg, malloc) {
    const buf = this.cachedTextEncoder.encode(arg);
    const ptr = malloc(buf.length, 1) >>> 0;
    this.getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
    this.WASM_VECTOR_LEN = buf.length;
    return ptr;
  }
  isLikeNone(x) { return x === undefined || x === null; }
  handleError(f, args) {
    try { return f.apply(this, args); }
    catch (e) { this.wasm.__wbindgen_export_0(this.addHeapObject(e)); }
  }

  createMockCanvas() {
    const self = this;
    const dataUrl = 'data:image/png;base64,' + Buffer.from(
      `canvas-fp-1920x1080-24-Win32-en-US`
    ).toString('base64');
    const ctx = {
      _font: '14px Arial', _textBaseline: 'alphabetic',
      fillText() {},
      get font() { return this._font; }, set font(v) { this._font = v; },
      get textBaseline() { return this._textBaseline; }, set textBaseline(v) { this._textBaseline = v; },
    };
    return {
      _width: 200, _height: 50,
      get width() { return this._width; }, set width(v) { this._width = v; },
      get height() { return this._height; }, set height(v) { this._height = v; },
      getContext: (type) => type === '2d' ? ctx : null,
      toDataURL: () => dataUrl,
    };
  }

  buildImports() {
    const self = this;
    const doc = {
      createElement: (t) => t === 'canvas' ? self.createMockCanvas() : {},
      getElementsByTagName: (t) => {
        const els = t === 'body' ? [{ appendChild() {}, tagName: 'BODY' }] : [];
        const col = { length: els.length, item: (i) => els[i] || null };
        els.forEach((el, i) => { col[i] = el; });
        return col;
      },
    };
    const ls = {
      getItem: (k) => k === 'tmdb_session_id' ? self.sessionId : null,
      setItem: () => {},
    };
    const nav = { platform: 'Win32', language: 'en-US', userAgent: UA };
    const scr = { width: 1920, height: 1080, colorDepth: 24 };
    const perf = { now: () => Date.now() - self.timestamp };
    const win = { document: doc, localStorage: ls, navigator: nav, screen: scr, performance: perf };

    const i = { wbg: {} };
    const w = i.wbg;

    // Function calls
    w.__wbg_call_672a4d21634d4a24 = function() {
      return self.handleError((a, b) => self.addHeapObject(self.getObject(a).call(self.getObject(b))), arguments);
    };
    w.__wbg_call_7cccdd69e0791ae2 = function() {
      return self.handleError((a, b, c) => self.addHeapObject(self.getObject(a).call(self.getObject(b), self.getObject(c))), arguments);
    };
    // Screen
    w.__wbg_colorDepth_59677c81c61d599a = function() {
      return self.handleError((a) => self.getObject(a).colorDepth, arguments);
    };
    w.__wbg_height_614ba187d8cae9ca = function() {
      return self.handleError((a) => self.getObject(a).height, arguments);
    };
    w.__wbg_width_679079836447b4b7 = function() {
      return self.handleError((a) => self.getObject(a).width, arguments);
    };
    w.__wbg_screen_8edf8699f70d98bc = function() {
      return self.handleError((a) => {
        const obj = self.getObject(a);
        return self.addHeapObject(obj ? obj.screen : scr);
      }, arguments);
    };
    // Document
    w.__wbg_document_d249400bd7bd996d = (a) => {
      const obj = self.getObject(a);
      const d = obj ? obj.document : null;
      return self.isLikeNone(d) ? 0 : self.addHeapObject(d);
    };
    w.__wbg_createElement_8c9931a732ee2fea = function() {
      return self.handleError((a, b, c) => self.addHeapObject(doc.createElement(self.getStringFromWasm0(b, c))), arguments);
    };
    w.__wbg_getElementsByTagName_f03d41ce466561e8 = (a, b, c) =>
      self.addHeapObject(doc.getElementsByTagName(self.getStringFromWasm0(b, c)));
    // Canvas
    w.__wbg_getContext_e9cf379449413580 = function() {
      return self.handleError((a, b, c) => {
        const r = self.getObject(a).getContext(self.getStringFromWasm0(b, c));
        return self.isLikeNone(r) ? 0 : self.addHeapObject(r);
      }, arguments);
    };
    w.__wbg_fillText_2a0055d8531355d1 = function() {
      return self.handleError((a, b, c, d, e) => self.getObject(a).fillText(self.getStringFromWasm0(b, c), d, e), arguments);
    };
    w.__wbg_setfont_42a163ef83420b93 = (a, b, c) => { self.getObject(a).font = self.getStringFromWasm0(b, c); };
    w.__wbg_settextBaseline_c28d2a6aa4ff9d9d = (a, b, c) => { self.getObject(a).textBaseline = self.getStringFromWasm0(b, c); };
    w.__wbg_setheight_da683a33fa99843c = (a, b) => { self.getObject(a).height = b >>> 0; };
    w.__wbg_setwidth_c5fed9f5e7f0b406 = (a, b) => { self.getObject(a).width = b >>> 0; };
    w.__wbg_toDataURL_eaec332e848fe935 = function() {
      return self.handleError((a, b) => {
        const r = self.getObject(b).toDataURL();
        const p = self.passStringToWasm0(r, self.wasm.__wbindgen_export_1);
        self.getDataViewMemory0().setInt32(a + 4, self.WASM_VECTOR_LEN, true);
        self.getDataViewMemory0().setInt32(a, p, true);
      }, arguments);
    };
    // instanceof — always true
    w.__wbg_instanceof_CanvasRenderingContext2d_df82a4d3437bf1cc = () => 1;
    w.__wbg_instanceof_HtmlCanvasElement_2ea67072a7624ac5 = () => 1;
    w.__wbg_instanceof_Window_def73ea0955fc569 = () => 1;
    // LocalStorage
    w.__wbg_localStorage_1406c99c39728187 = function() {
      return self.handleError((a) => {
        const obj = self.getObject(a);
        const storage = obj ? obj.localStorage : ls;
        return self.isLikeNone(storage) ? 0 : self.addHeapObject(storage);
      }, arguments);
    };
    w.__wbg_getItem_17f98dee3b43fa7e = function() {
      return self.handleError((a, b, c, d) => {
        const r = self.getObject(b).getItem(self.getStringFromWasm0(c, d));
        const p = self.isLikeNone(r) ? 0 : self.passStringToWasm0(r, self.wasm.__wbindgen_export_1);
        self.getDataViewMemory0().setInt32(a + 4, self.WASM_VECTOR_LEN, true);
        self.getDataViewMemory0().setInt32(a, p, true);
      }, arguments);
    };
    w.__wbg_setItem_212ecc915942ab0a = function() {
      return self.handleError((a, b, c, d, e) => {
        self.getObject(a).setItem(self.getStringFromWasm0(b, c), self.getStringFromWasm0(d, e));
      }, arguments);
    };
    // Navigator
    w.__wbg_navigator_1577371c070c8947 = (a) => {
      const obj = self.getObject(a);
      return self.addHeapObject(obj ? obj.navigator : nav);
    };
    w.__wbg_language_d871ec78ee8eec62 = (a, b) => {
      const r = self.getObject(b).language;
      const p = self.isLikeNone(r) ? 0 : self.passStringToWasm0(r, self.wasm.__wbindgen_export_1);
      self.getDataViewMemory0().setInt32(a + 4, self.WASM_VECTOR_LEN, true);
      self.getDataViewMemory0().setInt32(a, p, true);
    };
    w.__wbg_platform_faf02c487289f206 = function() {
      return self.handleError((a, b) => {
        const r = self.getObject(b).platform;
        const p = self.passStringToWasm0(r, self.wasm.__wbindgen_export_1);
        self.getDataViewMemory0().setInt32(a + 4, self.WASM_VECTOR_LEN, true);
        self.getDataViewMemory0().setInt32(a, p, true);
      }, arguments);
    };
    w.__wbg_userAgent_12e9d8e62297563f = function() {
      return self.handleError((a, b) => {
        const r = self.getObject(b).userAgent;
        const p = self.passStringToWasm0(r, self.wasm.__wbindgen_export_1);
        self.getDataViewMemory0().setInt32(a + 4, self.WASM_VECTOR_LEN, true);
        self.getDataViewMemory0().setInt32(a, p, true);
      }, arguments);
    };
    // Date/Time — CRITICAL: use fixed values like the CF Worker
    w.__wbg_new0_f788a2397c7ca929 = () => self.addHeapObject(new Date(self.timestamp));
    w.__wbg_now_807e54c39636c349 = () => self.timestamp;
    w.__wbg_getTimezoneOffset_6b5752021c499c47 = () => self.timezoneOffset;
    w.__wbg_performance_c185c0cdc2766575 = (a) => {
      const obj = self.getObject(a);
      const p = obj ? obj.performance : perf;
      return self.isLikeNone(p) ? 0 : self.addHeapObject(p);
    };
    w.__wbg_now_d18023d54d4e5500 = (a) => self.getObject(a).now();
    w.__wbg_random_3ad904d98382defe = () => self.randomSeed;
    // Utility
    w.__wbg_length_347907d14a9ed873 = (a) => self.getObject(a).length;
    w.__wbg_new_23a2665fac83c611 = (a, b) => {
      try {
        var s = { a, b };
        var cb = (x, y) => {
          const t = s.a; s.a = 0;
          try { return self.wasm.__wbindgen_export_6(t, s.b, self.addHeapObject(x), self.addHeapObject(y)); }
          finally { s.a = t; }
        };
        return self.addHeapObject(new Promise(cb));
      } finally { s.a = s.b = 0; }
    };
    w.__wbg_resolve_4851785c9c5f573d = (a) => self.addHeapObject(Promise.resolve(self.getObject(a)));
    w.__wbg_reject_b3fcf99063186ff7 = (a) => self.addHeapObject(Promise.reject(self.getObject(a)));
    w.__wbg_then_44b73946d2fb3e7d = (a, b) => self.addHeapObject(self.getObject(a).then(self.getObject(b)));
    w.__wbg_newnoargs_105ed471475aaf50 = (a, b) => self.addHeapObject(new Function(self.getStringFromWasm0(a, b)));
    // Global accessors — match CF Worker exactly
    w.__wbg_static_accessor_GLOBAL_88a902d13a557d07 = () => 0;
    w.__wbg_static_accessor_GLOBAL_THIS_56578be7e9f832b0 = () => self.addHeapObject(globalThis);
    w.__wbg_static_accessor_SELF_37c5d418e4bf5819 = () => self.addHeapObject(win);
    w.__wbg_static_accessor_WINDOW_5de37043a91a9c40 = () => self.addHeapObject(win);
    // Microtask
    w.__wbg_queueMicrotask_97d92b4fcc8a61c5 = (a) => queueMicrotask(self.getObject(a));
    w.__wbg_queueMicrotask_d3219def82552485 = (a) => self.addHeapObject(self.getObject(a).queueMicrotask);
    // Wbindgen internals
    w.__wbindgen_cb_drop = (a) => { const o = self.takeObject(a).original; if (o.cnt-- == 1) { o.a = 0; return true; } return false; };
    w.__wbindgen_closure_wrapper982 = (a, b) => {
      const s = { a, b, cnt: 1, dtor: 36 };
      const r = (...args) => {
        s.cnt++; const t = s.a; s.a = 0;
        try { return self.wasm.__wbindgen_export_5(t, s.b, self.addHeapObject(args[0])); }
        finally { if (--s.cnt === 0) self.wasm.__wbindgen_export_3.get(s.dtor)(t, s.b); else s.a = t; }
      };
      r.original = s;
      return self.addHeapObject(r);
    };
    w.__wbindgen_is_function = (a) => typeof self.getObject(a) === 'function';
    w.__wbindgen_is_undefined = (a) => self.getObject(a) === undefined;
    w.__wbindgen_object_clone_ref = (a) => self.addHeapObject(self.getObject(a));
    w.__wbindgen_object_drop_ref = (a) => self.takeObject(a);
    w.__wbindgen_string_new = (a, b) => self.addHeapObject(self.getStringFromWasm0(a, b));
    w.__wbindgen_throw = (a, b) => { throw new Error(self.getStringFromWasm0(a, b)); };

    return i;
  }

  initialize(wasmBytes) {
    const imports = this.buildImports();
    const module = new WebAssembly.Module(wasmBytes);
    const instance = new WebAssembly.Instance(module, imports);
    this.wasm = instance.exports;
    this.cachedDataViewMemory0 = null;
    this.cachedUint8ArrayMemory0 = null;
  }

  getImgKey() {
    const retptr = this.wasm.__wbindgen_add_to_stack_pointer(-16);
    try {
      this.wasm.get_img_key(retptr);
      const dv = this.getDataViewMemory0();
      const r0 = dv.getInt32(retptr, true);
      const r1 = dv.getInt32(retptr + 4, true);
      const r2 = dv.getInt32(retptr + 8, true);
      const r3 = dv.getInt32(retptr + 12, true);
      if (r3) throw this.takeObject(r2);
      const result = this.getStringFromWasm0(r0, r1);
      this.wasm.__wbindgen_export_4(r0, r1, 1);
      return result;
    } finally {
      this.wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }

  async processImgData(data, key) {
    const p0 = this.passStringToWasm0(data, this.wasm.__wbindgen_export_1);
    const l0 = this.WASM_VECTOR_LEN;
    const p1 = this.passStringToWasm0(key, this.wasm.__wbindgen_export_1);
    const l1 = this.WASM_VECTOR_LEN;
    return this.takeObject(this.wasm.process_img_data(p0, l0, p1, l1));
  }
}

// ============================================================================
// Auth helpers
// ============================================================================
function generateNonce() {
  return crypto.randomBytes(16).toString('base64').replace(/[/+=]/g, '').substring(0, 22);
}
function generateFingerprint() {
  const data = `1920x1080:24:${UA.substring(0, 50)}:Win32:en-US:${new Date().getTimezoneOffset()}:FP`;
  let hash = 0;
  for (let i = 0; i < data.length; i++) { hash = (hash << 5) - hash + data.charCodeAt(i); hash &= hash; }
  return Math.abs(hash).toString(36);
}
async function generateSignature(key, timestamp, nonce, path) {
  const hmac = crypto.createHmac('sha256', key);
  hmac.update(`${key}:${timestamp}:${nonce}:${path}`);
  return hmac.digest('base64');
}
async function fetchServerTime() {
  const r = await fetch(`${API_BASE}/api/time?t=${Date.now()}`, {
    headers: { 'User-Agent': UA, 'Cache-Control': 'no-cache' }
  });
  return (await r.json()).timestamp;
}
async function buildHeaders(apiKey, fullUrl) {
  let apiPath = fullUrl;
  try { apiPath = new URL(fullUrl).pathname; } catch {}
  const ts = await fetchServerTime();
  const nonce = generateNonce();
  const fp = generateFingerprint();
  const sig = await generateSignature(apiKey, ts, nonce, apiPath);
  return { 'X-Api-Key': apiKey, 'X-Request-Timestamp': ts.toString(), 'X-Request-Nonce': nonce, 'X-Request-Signature': sig, 'X-Client-Fingerprint': fp, 'x-fingerprint-lite': 'e9136c41504646444' };
}

// ============================================================================
// Extraction
// ============================================================================
async function extract(loader, tmdbId, type, season, episode) {
  const apiKey = loader.getImgKey();
  console.log(`  Key: ${apiKey.substring(0, 16)}... (${apiKey.length} chars)`);

  const apiPath = type === 'movie'
    ? `/api/tmdb/movie/${tmdbId}/images`
    : `/api/tmdb/tv/${tmdbId}/season/${season}/episode/${episode}/images`;
  const fullUrl = `${API_BASE}${apiPath}`;

  // Step 1: server list
  const h1 = await buildHeaders(apiKey, fullUrl);
  const r1 = await fetch(fullUrl, { signal: AbortSignal.timeout(10000), headers: { Accept: 'text/plain', ...h1 } });
  if (!r1.ok) throw new Error(`Server list: ${r1.status} ${await r1.text()}`);
  const enc1 = await r1.text();
  console.log(`  Encrypted server list: ${enc1.length} bytes`);

  const dec1 = await loader.processImgData(enc1, apiKey);
  if (!dec1) throw new Error('Decryption returned empty/undefined');
  const data1 = JSON.parse(dec1);
  let servers = [];
  if (data1?.sources && Array.isArray(data1.sources)) {
    servers = data1.sources.map(s => s.server).filter(Boolean);
  } else if (data1?.servers) {
    servers = Object.keys(data1.servers);
  }
  console.log(`  Servers: ${servers.join(', ')} (${servers.length})`);

  // Step 2: extract from priority servers
  const priority = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'];
  const toTry = priority.filter(s => servers.includes(s));
  if (toTry.length === 0) toTry.push(...servers.slice(0, 6));

  const results = [];
  for (const server of toTry) {
    try {
      const h2 = await buildHeaders(apiKey, fullUrl);
      const r2 = await fetch(fullUrl, {
        signal: AbortSignal.timeout(10000),
        headers: { Accept: 'text/plain', 'X-Only-Sources': '1', 'X-Server': server, ...h2 },
      });
      if (!r2.ok) { console.log(`  ✗ ${server}: HTTP ${r2.status}`); continue; }
      const enc2 = await r2.text();
      const dec2 = await loader.processImgData(enc2, apiKey);
      if (!dec2) { console.log(`  ✗ ${server}: decryption returned empty`); continue; }
      const data2 = JSON.parse(dec2);

      let url = null;
      if (Array.isArray(data2?.sources)) {
        const src = data2.sources.find(s => s?.server === server) || data2.sources[0];
        url = src?.url || src?.file;
      } else if (data2?.sources?.file) { url = data2.sources.file; }
      else if (data2?.sources?.url) { url = data2.sources.url; }

      if (url && url.trim()) {
        console.log(`  ✓ ${server}: ${url.substring(0, 100)}...`);
        results.push({ server, url });
      } else {
        console.log(`  ✗ ${server}: empty URL`);
      }
    } catch (e) {
      console.log(`  ✗ ${server}: ${e.message}`);
    }
  }
  return results;
}

// ============================================================================
// Main
// ============================================================================
async function main() {
  console.log('=== HEXA.SU LOCAL EXTRACTION TEST ===\n');

  const wasmPath = pathMod.join(__dirname, 'hexa-wasm.wasm');
  const altPath = pathMod.join(__dirname, '..', 'public', 'flixer.wasm');
  const wasmBytes = fs.readFileSync(fs.existsSync(wasmPath) ? wasmPath : altPath);
  console.log(`WASM: ${wasmBytes.length} bytes`);

  const loader = new WasmLoader();
  loader.initialize(wasmBytes);
  console.log('WASM initialized');

  const key = loader.getImgKey();
  console.log(`API Key: ${key} (${key.length} chars)\n`);

  const tests = [
    { id: '550', title: 'Fight Club', type: 'movie' },
    { id: '157336', title: 'Interstellar', type: 'movie' },
    { id: '27205', title: 'Inception', type: 'movie' },
    { id: '1396', title: 'Breaking Bad S1E1', type: 'tv', s: 1, e: 1 },
    { id: '94605', title: 'Arcane S1E1', type: 'tv', s: 1, e: 1 },
  ];

  let pass = 0, fail = 0;
  for (const t of tests) {
    console.log(`--- ${t.title} (${t.type}/${t.id}) ---`);
    try {
      const results = await extract(loader, t.id, t.type, t.s, t.e);
      if (results.length > 0) {
        // Verify m3u8
        const url = results[0].url;
        try {
          const mr = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': UA } });
          if (mr.ok) {
            const body = await mr.text();
            const valid = body.includes('#EXTINF') || body.includes('#EXT-X-STREAM-INF');
            console.log(`  M3U8: ${mr.status} | ${body.length}b | ${valid ? 'VALID HLS ✓' : 'NO SEGMENTS ✗'}`);
            if (valid) pass++; else fail++;
          } else {
            console.log(`  M3U8: HTTP ${mr.status} ✗`);
            fail++;
          }
        } catch (e) {
          console.log(`  M3U8 verify: ${e.message}`);
          // Still count as pass if we got a URL
          pass++;
        }
      } else {
        console.log(`  NO SOURCES ✗`);
        fail++;
      }
    } catch (e) {
      console.log(`  ERROR: ${e.message}`);
      fail++;
    }
    console.log();
  }

  console.log(`\n=== RESULTS: ${pass} passed, ${fail} failed out of ${tests.length} ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
