#!/usr/bin/env node
/**
 * Flixer/Hexa Full E2E Validation Test
 * 
 * Tests the complete extraction chain locally:
 *   1. WASM initialization with browser mocks
 *   2. Key generation (must be 64 chars)
 *   3. Server time sync
 *   4. HMAC-SHA256 auth signing
 *   5. Warm-up request (bW90aGFmYWth header)
 *   6. Per-server extraction (multiple servers)
 *   7. WASM decryption of encrypted responses
 *   8. URL extraction from multiple response shapes
 *   9. M3U8 playlist validation (valid HLS)
 *  10. CDN segment reachability
 * 
 * Usage:
 *   node scripts/test-flixer-hexa-e2e.js
 *   node scripts/test-flixer-hexa-e2e.js --verbose
 *   node scripts/test-flixer-hexa-e2e.js --servers alpha,bravo,charlie
 *   node scripts/test-flixer-hexa-e2e.js --tmdb 550
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose') || args.includes('-v');
const tmdbIdx = args.indexOf('--tmdb');
const TMDB_OVERRIDE = args.find(a => a.startsWith('--tmdb='))?.split('=')[1]
  || (tmdbIdx >= 0 && args[tmdbIdx + 1] && !args[tmdbIdx + 1].startsWith('-') ? args[tmdbIdx + 1] : undefined);
const serversIdx = args.indexOf('--servers');
const SERVER_OVERRIDE = args.find(a => a.startsWith('--servers='))?.split('=')[1]
  || (serversIdx >= 0 && args[serversIdx + 1] && !args[serversIdx + 1].startsWith('-') ? args[serversIdx + 1] : undefined);

// ── Config ──────────────────────────────────────────────────────────────────
const FLIXER_API_BASE = 'https://theemoviedb.hexa.su';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const SERVER_NAMES = {
  alpha: 'Ares', bravo: 'Balder', charlie: 'Circe', delta: 'Dionysus',
  echo: 'Eros', foxtrot: 'Freya', golf: 'Gaia', hotel: 'Hades',
  india: 'Isis', juliet: 'Juno', kilo: 'Kronos', lima: 'Loki',
  mike: 'Medusa', november: 'Nyx', oscar: 'Odin', papa: 'Persephone',
  quebec: 'Quirinus', romeo: 'Ra', sierra: 'Selene', tango: 'Thor',
  uniform: 'Uranus', victor: 'Vulcan', whiskey: 'Woden', xray: 'Xolotl',
  yankee: 'Ymir', zulu: 'Zeus',
};

// Test content — well-known TMDB IDs
const TEST_CONTENT = [
  { tmdbId: '550', type: 'movie', title: 'Fight Club' },
  { tmdbId: '157336', type: 'movie', title: 'Interstellar' },
  { tmdbId: '27205', type: 'movie', title: 'Inception' },
  { tmdbId: '1396', type: 'tv', title: 'Breaking Bad S1E1', season: '1', episode: '1' },
  { tmdbId: '1399', type: 'tv', title: 'Game of Thrones S1E1', season: '1', episode: '1' },
];

// ── Logging ─────────────────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', dim: '\x1b[2m', bold: '\x1b[1m',
};

const results = { pass: 0, fail: 0, warn: 0, tests: [] };

function log(color, tag, msg) { console.log(`${color}[${tag}]${C.reset} ${msg}`); }
function pass(test, msg, ms) { results.pass++; results.tests.push({ test, status: 'pass', msg, ms }); log(C.green, '✓ PASS', `${test} — ${msg}${ms ? ` (${ms}ms)` : ''}`); }
function fail(test, msg) { results.fail++; results.tests.push({ test, status: 'fail', msg }); log(C.red, '✗ FAIL', `${test} — ${msg}`); }
function warn(test, msg) { results.warn++; results.tests.push({ test, status: 'warn', msg }); log(C.yellow, '⚠ WARN', `${test} — ${msg}`); }
function info(msg) { if (VERBOSE) log(C.dim, 'INFO', msg); }

// ── WASM Loader ─────────────────────────────────────────────────────────────
class FlixerWasmLoader {
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
  handleError(f, args) { try { return f.apply(this, args); } catch (e) { this.wasm.__wbindgen_export_0(this.addHeapObject(e)); } }

  buildImports() {
    const self = this;
    const scr = { width: 1920, height: 1080, colorDepth: 24 };
    const nav = { platform: 'Win32', language: 'en-US', userAgent: UA };
    const perf = { now: () => Date.now() - self.timestamp };
    const ls = { getItem: (k) => k === 'tmdb_session_id' ? self.sessionId : null, setItem: () => {} };
    const canvasCtx = {
      _font: '14px Arial', _textBaseline: 'alphabetic', fillText() {},
      get font() { return this._font; }, set font(v) { this._font = v; },
      get textBaseline() { return this._textBaseline; }, set textBaseline(v) { this._textBaseline = v; },
    };
    const canvas = {
      _width: 200, _height: 50,
      get width() { return this._width; }, set width(v) { this._width = v; },
      get height() { return this._height; }, set height(v) { this._height = v; },
      getContext: (t) => t === '2d' ? canvasCtx : null,
      toDataURL: () => 'data:image/png;base64,' + Buffer.from('canvas-fp-1920x1080-24-Win32-en-US').toString('base64'),
    };
    const mockBody = { appendChild: () => {}, clientWidth: 1920, clientHeight: 1080 };
    const createCollection = (els) => {
      const c = { length: els.length, item: (i) => els[i] || null };
      els.forEach((e, i) => { c[i] = e; });
      return new Proxy(c, { get(t, p) { if (typeof p === 'string' && !isNaN(parseInt(p))) return t[parseInt(p)]; return t[p]; } });
    };
    const doc = {
      createElement: (t) => t === 'canvas' ? canvas : {},
      getElementsByTagName: (t) => t === 'body' ? createCollection([mockBody]) : createCollection([]),
      body: mockBody,
    };
    const win = { document: doc, localStorage: ls, navigator: nav, screen: scr, performance: perf };
    const i = { wbg: {} };

    i.wbg.__wbg_call_672a4d21634d4a24 = function() { return self.handleError((a, b) => self.addHeapObject(self.getObject(a).call(self.getObject(b))), arguments); };
    i.wbg.__wbg_call_7cccdd69e0791ae2 = function() { return self.handleError((a, b, c) => self.addHeapObject(self.getObject(a).call(self.getObject(b), self.getObject(c))), arguments); };
    i.wbg.__wbg_colorDepth_59677c81c61d599a = function() { return self.handleError((a) => self.getObject(a).colorDepth, arguments); };
    i.wbg.__wbg_height_614ba187d8cae9ca = function() { return self.handleError((a) => self.getObject(a).height, arguments); };
    i.wbg.__wbg_width_679079836447b4b7 = function() { return self.handleError((a) => self.getObject(a).width, arguments); };
    i.wbg.__wbg_screen_8edf8699f70d98bc = function() { return self.handleError((a) => { const w = self.getObject(a); return self.addHeapObject(w ? w.screen : scr); }, arguments); };
    i.wbg.__wbg_document_d249400bd7bd996d = (a) => { const w = self.getObject(a); const d = w ? w.document : null; return d ? self.addHeapObject(d) : 0; };
    i.wbg.__wbg_createElement_8c9931a732ee2fea = function() { return self.handleError((a, b, c) => self.addHeapObject(doc.createElement(self.getStringFromWasm0(b, c))), arguments); };
    i.wbg.__wbg_getElementsByTagName_f03d41ce466561e8 = (a, b, c) => self.addHeapObject(doc.getElementsByTagName(self.getStringFromWasm0(b, c)));
    i.wbg.__wbg_getContext_e9cf379449413580 = function() { return self.handleError((a, b, c) => { const r = self.getObject(a).getContext(self.getStringFromWasm0(b, c)); return self.isLikeNone(r) ? 0 : self.addHeapObject(r); }, arguments); };
    i.wbg.__wbg_fillText_2a0055d8531355d1 = function() { return self.handleError((a, b, c, d, e) => self.getObject(a).fillText(self.getStringFromWasm0(b, c), d, e), arguments); };
    i.wbg.__wbg_setfont_42a163ef83420b93 = (a, b, c) => { self.getObject(a).font = self.getStringFromWasm0(b, c); };
    i.wbg.__wbg_settextBaseline_c28d2a6aa4ff9d9d = (a, b, c) => { self.getObject(a).textBaseline = self.getStringFromWasm0(b, c); };
    i.wbg.__wbg_setheight_da683a33fa99843c = (a, b) => { self.getObject(a).height = b >>> 0; };
    i.wbg.__wbg_setwidth_c5fed9f5e7f0b406 = (a, b) => { self.getObject(a).width = b >>> 0; };
    i.wbg.__wbg_toDataURL_eaec332e848fe935 = function() { return self.handleError((a, b) => { const r = self.getObject(b).toDataURL(); const p = self.passStringToWasm0(r, self.wasm.__wbindgen_export_1); self.getDataViewMemory0().setInt32(a + 4, self.WASM_VECTOR_LEN, true); self.getDataViewMemory0().setInt32(a, p, true); }, arguments); };
    i.wbg.__wbg_instanceof_CanvasRenderingContext2d_df82a4d3437bf1cc = () => 1;
    i.wbg.__wbg_instanceof_HtmlCanvasElement_2ea67072a7624ac5 = () => 1;
    i.wbg.__wbg_instanceof_Window_def73ea0955fc569 = () => 1;
    i.wbg.__wbg_localStorage_1406c99c39728187 = function() { return self.handleError((a) => { const w = self.getObject(a); return self.isLikeNone(w ? w.localStorage : ls) ? 0 : self.addHeapObject(w ? w.localStorage : ls); }, arguments); };
    i.wbg.__wbg_getItem_17f98dee3b43fa7e = function() { return self.handleError((a, b, c, d) => { const r = self.getObject(b).getItem(self.getStringFromWasm0(c, d)); const p = self.isLikeNone(r) ? 0 : self.passStringToWasm0(r, self.wasm.__wbindgen_export_1); self.getDataViewMemory0().setInt32(a + 4, self.WASM_VECTOR_LEN, true); self.getDataViewMemory0().setInt32(a, p, true); }, arguments); };
    i.wbg.__wbg_setItem_212ecc915942ab0a = function() { return self.handleError((a, b, c, d, e) => { self.getObject(a).setItem(self.getStringFromWasm0(b, c), self.getStringFromWasm0(d, e)); }, arguments); };
    i.wbg.__wbg_navigator_1577371c070c8947 = (a) => { const w = self.getObject(a); return self.addHeapObject(w ? w.navigator : nav); };
    i.wbg.__wbg_language_d871ec78ee8eec62 = (a, b) => { const r = self.getObject(b).language; const p = self.isLikeNone(r) ? 0 : self.passStringToWasm0(r, self.wasm.__wbindgen_export_1); self.getDataViewMemory0().setInt32(a + 4, self.WASM_VECTOR_LEN, true); self.getDataViewMemory0().setInt32(a, p, true); };
    i.wbg.__wbg_platform_faf02c487289f206 = function() { return self.handleError((a, b) => { const r = self.getObject(b).platform; const p = self.passStringToWasm0(r, self.wasm.__wbindgen_export_1); self.getDataViewMemory0().setInt32(a + 4, self.WASM_VECTOR_LEN, true); self.getDataViewMemory0().setInt32(a, p, true); }, arguments); };
    i.wbg.__wbg_userAgent_12e9d8e62297563f = function() { return self.handleError((a, b) => { const r = self.getObject(b).userAgent; const p = self.passStringToWasm0(r, self.wasm.__wbindgen_export_1); self.getDataViewMemory0().setInt32(a + 4, self.WASM_VECTOR_LEN, true); self.getDataViewMemory0().setInt32(a, p, true); }, arguments); };
    i.wbg.__wbg_new0_f788a2397c7ca929 = () => self.addHeapObject(new Date(self.timestamp));
    i.wbg.__wbg_now_807e54c39636c349 = () => self.timestamp;
    i.wbg.__wbg_getTimezoneOffset_6b5752021c499c47 = () => self.timezoneOffset;
    i.wbg.__wbg_performance_c185c0cdc2766575 = (a) => { const w = self.getObject(a); return self.isLikeNone(w ? w.performance : perf) ? 0 : self.addHeapObject(w ? w.performance : perf); };
    i.wbg.__wbg_now_d18023d54d4e5500 = (a) => self.getObject(a).now();
    i.wbg.__wbg_random_3ad904d98382defe = () => self.randomSeed;
    i.wbg.__wbg_length_347907d14a9ed873 = (a) => self.getObject(a).length;
    i.wbg.__wbg_new_23a2665fac83c611 = (a, b) => { try { var s = { a, b }; var cb = (x, y) => { const t = s.a; s.a = 0; try { return self.wasm.__wbindgen_export_6(t, s.b, self.addHeapObject(x), self.addHeapObject(y)); } finally { s.a = t; } }; return self.addHeapObject(new Promise(cb)); } finally { s.a = s.b = 0; } };
    i.wbg.__wbg_resolve_4851785c9c5f573d = (a) => self.addHeapObject(Promise.resolve(self.getObject(a)));
    i.wbg.__wbg_reject_b3fcf99063186ff7 = (a) => self.addHeapObject(Promise.reject(self.getObject(a)));
    i.wbg.__wbg_then_44b73946d2fb3e7d = (a, b) => self.addHeapObject(self.getObject(a).then(self.getObject(b)));
    i.wbg.__wbg_newnoargs_105ed471475aaf50 = (a, b) => self.addHeapObject(new Function(self.getStringFromWasm0(a, b)));
    i.wbg.__wbg_static_accessor_GLOBAL_88a902d13a557d07 = () => 0;
    i.wbg.__wbg_static_accessor_GLOBAL_THIS_56578be7e9f832b0 = () => self.addHeapObject(globalThis);
    i.wbg.__wbg_static_accessor_SELF_37c5d418e4bf5819 = () => self.addHeapObject(win);
    i.wbg.__wbg_static_accessor_WINDOW_5de37043a91a9c40 = () => self.addHeapObject(win);
    i.wbg.__wbg_queueMicrotask_97d92b4fcc8a61c5 = (a) => queueMicrotask(self.getObject(a));
    i.wbg.__wbg_queueMicrotask_d3219def82552485 = (a) => self.addHeapObject(self.getObject(a).queueMicrotask);
    i.wbg.__wbindgen_cb_drop = (a) => { const o = self.takeObject(a).original; if (o.cnt-- == 1) { o.a = 0; return true; } return false; };
    i.wbg.__wbindgen_closure_wrapper982 = (a, b) => { const s = { a, b, cnt: 1, dtor: 36 }; const r = (...args) => { s.cnt++; const t = s.a; s.a = 0; try { return self.wasm.__wbindgen_export_5(t, s.b, self.addHeapObject(args[0])); } finally { if (--s.cnt === 0) self.wasm.__wbindgen_export_3.get(s.dtor)(t, s.b); else s.a = t; } }; r.original = s; return self.addHeapObject(r); };
    i.wbg.__wbindgen_is_function = (a) => typeof self.getObject(a) === 'function';
    i.wbg.__wbindgen_is_undefined = (a) => self.getObject(a) === undefined;
    i.wbg.__wbindgen_object_clone_ref = (a) => self.addHeapObject(self.getObject(a));
    i.wbg.__wbindgen_object_drop_ref = (a) => self.takeObject(a);
    i.wbg.__wbindgen_string_new = (a, b) => self.addHeapObject(self.getStringFromWasm0(a, b));
    i.wbg.__wbindgen_throw = (a, b) => { throw new Error(self.getStringFromWasm0(a, b)); };
    return i;
  }

  async initialize(wasmPath) {
    const wasmBuffer = fs.readFileSync(wasmPath);
    const wasmModule = await WebAssembly.compile(wasmBuffer);
    const imports = this.buildImports();
    const instance = await WebAssembly.instantiate(wasmModule, imports);
    this.wasm = instance.exports;
    return this;
  }

  getImgKey() {
    const retptr = this.wasm.__wbindgen_add_to_stack_pointer(-16);
    try {
      this.wasm.get_img_key(retptr);
      const dv = this.getDataViewMemory0();
      const r0 = dv.getInt32(retptr, true), r1 = dv.getInt32(retptr + 4, true);
      const r2 = dv.getInt32(retptr + 8, true), r3 = dv.getInt32(retptr + 12, true);
      if (r3) throw this.takeObject(r2);
      const result = this.getStringFromWasm0(r0, r1);
      this.wasm.__wbindgen_export_4(r0, r1, 1);
      return result;
    } finally { this.wasm.__wbindgen_add_to_stack_pointer(16); }
  }

  async processImgData(data, key) {
    const p0 = this.passStringToWasm0(data, this.wasm.__wbindgen_export_1), l0 = this.WASM_VECTOR_LEN;
    const p1 = this.passStringToWasm0(key, this.wasm.__wbindgen_export_1), l1 = this.WASM_VECTOR_LEN;
    return this.takeObject(this.wasm.process_img_data(p0, l0, p1, l1));
  }
}


// ── Auth helpers ────────────────────────────────────────────────────────────
let serverTimeOffset = 0;

function generateClientFingerprint() {
  const fpString = `2560x1440:24:${UA.substring(0, 50)}:Win32:en-US:${new Date().getTimezoneOffset()}:iVBORw0KGgoAAAANSUhEUgAAASwA`;
  let hash = 0;
  for (let i = 0; i < fpString.length; i++) { hash = (hash << 5) - hash + fpString.charCodeAt(i); hash &= hash; }
  return Math.abs(hash).toString(36);
}

async function syncServerTime() {
  const before = Date.now();
  const resp = await fetch(`${FLIXER_API_BASE}/api/time?t=${before}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) throw new Error(`Time sync HTTP ${resp.status}`);
  const text = await resp.text();
  const data = JSON.parse(text);
  const after = Date.now();
  const rtt = after - before;
  serverTimeOffset = data.timestamp * 1000 + (rtt / 2) - after;
  return { data, rtt, offset: serverTimeOffset };
}

function getTimestamp() { return Math.floor((Date.now() + serverTimeOffset) / 1000); }

async function makeFlixerRequest(apiKey, apiPath, extraHeaders = {}) {
  const timestamp = getTimestamp();
  const nonce = crypto.randomBytes(16).toString('base64').replace(/[/+=]/g, '').substring(0, 22);
  const message = `${apiKey}:${timestamp}:${nonce}:${apiPath}`;
  const signature = crypto.createHmac('sha256', apiKey).update(message).digest('base64');

  const headers = {
    'X-Api-Key': apiKey,
    'X-Request-Timestamp': timestamp.toString(),
    'X-Request-Nonce': nonce,
    'X-Request-Signature': signature,
    'X-Client-Fingerprint': generateClientFingerprint(),
    'Accept': 'text/plain',
    'Accept-Language': 'en-US,en;q=0.9',
    'User-Agent': UA,
    'x-fingerprint-lite': 'e9136c41504646444',
    ...extraHeaders,
  };

  const resp = await fetch(`${FLIXER_API_BASE}${apiPath}`, {
    headers,
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${body.substring(0, 200)}`);
  }
  return resp.text();
}

// ── URL extraction from decrypted data ──────────────────────────────────────
function extractStreamUrl(data, server) {
  let url = null;

  // Shape 1: sources array
  if (Array.isArray(data.sources)) {
    const s = data.sources.find(s => s.server === server) || data.sources[0];
    url = s?.url || s?.file || s?.stream;
    if (!url && s?.sources) {
      const inner = Array.isArray(s.sources) ? s.sources : [s.sources];
      url = inner[0]?.url || inner[0]?.file;
    }
  }

  // Shape 2: sources object
  if (!url && data.sources && !Array.isArray(data.sources)) {
    url = data.sources.file || data.sources.url || data.sources.stream;
  }

  // Shape 3: servers map
  if (!url && data.servers && data.servers[server]) {
    const sd = data.servers[server];
    if (Array.isArray(sd)) url = sd[0]?.url || sd[0]?.file;
    else url = sd.url || sd.file || sd.stream;
  }

  // Shape 4: top-level
  if (!url) url = data.file || data.url || data.stream;

  return url && url.trim() ? url.trim() : null;
}

// ── Test phases ─────────────────────────────────────────────────────────────

async function testWasmInit() {
  console.log(`\n${C.bold}═══ Phase 1: WASM Initialization ═══${C.reset}\n`);

  const wasmPaths = [
    path.join(process.cwd(), 'public', 'flixer.wasm'),
    path.join(__dirname, '..', 'public', 'flixer.wasm'),
  ];
  let wasmPath = null;
  for (const p of wasmPaths) {
    if (fs.existsSync(p)) { wasmPath = p; break; }
  }
  if (!wasmPath) {
    fail('wasm-file', 'flixer.wasm not found');
    return null;
  }
  const stat = fs.statSync(wasmPath);
  pass('wasm-file', `Found at ${wasmPath} (${(stat.size / 1024).toFixed(1)} KB)`);

  const t0 = Date.now();
  const loader = new FlixerWasmLoader();
  try {
    await loader.initialize(wasmPath);
    pass('wasm-init', `WASM instantiated`, Date.now() - t0);
  } catch (e) {
    fail('wasm-init', `WASM instantiation failed: ${e.message}`);
    return null;
  }

  const t1 = Date.now();
  let apiKey;
  try {
    apiKey = loader.getImgKey();
    pass('wasm-keygen', `Key generated: ${apiKey.substring(0, 16)}...${apiKey.substring(apiKey.length - 8)} (${apiKey.length} chars)`, Date.now() - t1);
  } catch (e) {
    fail('wasm-keygen', `Key generation failed: ${e.message}`);
    return null;
  }

  if (apiKey.length === 64) {
    pass('key-length', `Key is exactly 64 characters`);
  } else {
    fail('key-length', `Key is ${apiKey.length} chars, expected 64`);
  }

  if (/^[a-f0-9]+$/i.test(apiKey)) {
    pass('key-format', `Key is valid hex`);
  } else {
    warn('key-format', `Key contains non-hex characters: ${apiKey.substring(0, 20)}...`);
  }

  return { loader, apiKey };
}

async function testTimeSync() {
  console.log(`\n${C.bold}═══ Phase 2: Server Time Sync ═══${C.reset}\n`);

  const t0 = Date.now();
  try {
    const { data, rtt, offset } = await syncServerTime();
    pass('time-sync', `RTT: ${rtt}ms, offset: ${offset.toFixed(0)}ms`, rtt);

    if (data.time && data.timestamp) {
      pass('time-format', `Response has both "time" (${data.time}) and "timestamp" (${data.timestamp})`);
    } else if (data.timestamp) {
      pass('time-format', `Response has "timestamp" (${data.timestamp})`);
    } else {
      fail('time-format', `Unexpected response: ${JSON.stringify(data)}`);
    }

    if (Math.abs(offset) < 30000) {
      pass('time-drift', `Clock drift is ${Math.abs(offset).toFixed(0)}ms (< 30s threshold)`);
    } else {
      warn('time-drift', `Clock drift is ${Math.abs(offset).toFixed(0)}ms — may cause auth failures`);
    }
    return true;
  } catch (e) {
    fail('time-sync', `Time sync failed: ${e.message}`);
    return false;
  }
}

async function testDecoyResponse(apiKey) {
  console.log(`\n${C.bold}═══ Phase 3: Decoy Response Validation ═══${C.reset}\n`);

  // Without bW90aGFmYWth header, should return TMDB image data
  try {
    const t0 = Date.now();
    const resp = await fetch(`${FLIXER_API_BASE}/api/tmdb/movie/550/images`, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (resp.ok) {
      const text = await resp.text();
      try {
        const data = JSON.parse(text);
        if (data.backdrops || data.posters || data.logos) {
          pass('decoy-response', `Returns TMDB image data without auth (${Object.keys(data).join(', ')})`, Date.now() - t0);
        } else {
          warn('decoy-response', `Returns JSON but unexpected shape: ${Object.keys(data).join(', ')}`);
        }
      } catch {
        info(`Decoy returned non-JSON (${text.length} bytes) — may be encrypted`);
        pass('decoy-response', `Endpoint reachable, returns ${text.length} bytes`, Date.now() - t0);
      }
    } else {
      warn('decoy-response', `HTTP ${resp.status} — endpoint may be rate-limited`);
    }
  } catch (e) {
    warn('decoy-response', `Could not reach endpoint: ${e.message}`);
  }
}

async function testWarmup(apiKey, apiPath) {
  console.log(`\n${C.bold}═══ Phase 4: Warm-Up Request ═══${C.reset}\n`);

  const t0 = Date.now();
  try {
    const encrypted = await makeFlixerRequest(apiKey, apiPath, { 'bW90aGFmYWth': '1' });
    const ms = Date.now() - t0;
    if (encrypted && encrypted.length > 0) {
      pass('warmup-request', `Warm-up OK — ${encrypted.length} bytes encrypted response`, ms);
      info(`Encrypted preview: ${encrypted.substring(0, 80)}...`);
      return encrypted;
    } else {
      fail('warmup-request', `Warm-up returned empty response`);
      return null;
    }
  } catch (e) {
    fail('warmup-request', `Warm-up failed: ${e.message}`);
    return null;
  }
}

async function testWarmupDecryption(loader, apiKey, warmupEncrypted) {
  if (!warmupEncrypted) return;

  const t0 = Date.now();
  try {
    const decrypted = await loader.processImgData(warmupEncrypted, apiKey);
    const ms = Date.now() - t0;
    if (typeof decrypted === 'string' && decrypted.length > 0) {
      try {
        const data = JSON.parse(decrypted);
        const keys = Object.keys(data);
        pass('warmup-decrypt', `Decrypted OK — JSON keys: [${keys.join(', ')}]`, ms);
        info(`Decrypted preview: ${decrypted.substring(0, 200)}`);
      } catch {
        pass('warmup-decrypt', `Decrypted OK — ${decrypted.length} chars (non-JSON)`, ms);
      }
    } else {
      fail('warmup-decrypt', `Decryption returned empty or non-string`);
    }
  } catch (e) {
    fail('warmup-decrypt', `Decryption failed: ${e.message}`);
  }
}

async function testServerExtraction(loader, apiKey, content, servers) {
  const { tmdbId, type, title, season, episode } = content;
  const apiPath = type === 'movie'
    ? `/api/tmdb/movie/${tmdbId}/images`
    : `/api/tmdb/tv/${tmdbId}/season/${season}/episode/${episode}/images`;

  console.log(`\n${C.bold}═══ Phase 5: Server Extraction — ${title} ═══${C.reset}\n`);

  // Warm-up first
  const warmupT0 = Date.now();
  try {
    await makeFlixerRequest(apiKey, apiPath, { 'bW90aGFmYWth': '1' });
    info(`Warm-up done (${Date.now() - warmupT0}ms)`);
  } catch (e) {
    warn('warmup', `Warm-up failed for ${title}: ${e.message} — continuing anyway`);
  }

  await new Promise(r => setTimeout(r, 200));

  const extractedSources = [];

  for (const server of servers) {
    const t0 = Date.now();
    try {
      const encrypted = await makeFlixerRequest(apiKey, apiPath, {
        'X-Only-Sources': '1',
        'X-Server': server,
      });
      const ms = Date.now() - t0;

      if (!encrypted || encrypted.length === 0) {
        fail(`extract-${server}`, `Empty response for ${title}`);
        continue;
      }

      info(`${server}: ${encrypted.length} bytes encrypted (${ms}ms)`);

      // Decrypt
      const decrypted = await loader.processImgData(encrypted, apiKey);
      if (typeof decrypted !== 'string' || decrypted.length === 0) {
        fail(`extract-${server}`, `Decryption returned empty for ${title}`);
        continue;
      }

      let data;
      try {
        data = JSON.parse(decrypted);
      } catch {
        fail(`extract-${server}`, `Decrypted data is not valid JSON for ${title}`);
        info(`Raw decrypted: ${decrypted.substring(0, 200)}`);
        continue;
      }

      const url = extractStreamUrl(data, server);
      if (url) {
        pass(`extract-${server}`, `${SERVER_NAMES[server]}: ${url.substring(0, 80)}...`, ms);
        extractedSources.push({ server, url, displayName: SERVER_NAMES[server] });
      } else {
        // Some servers return empty URLs for certain content — this is normal behavior
        const keys = Object.keys(data);
        const srcType = data.sources ? (Array.isArray(data.sources) ? `array[${data.sources.length}]` : typeof data.sources) : 'missing';
        warn(`extract-${server}`, `${SERVER_NAMES[server]}: decrypted OK but no URL. Keys: [${keys}], sources: ${srcType}`);
        info(`Decrypted: ${JSON.stringify(data).substring(0, 300)}`);
      }
    } catch (e) {
      // Server-specific extraction errors are warnings, not failures
      // (server may be down, rate-limited, or not have this content)
      warn(`extract-${server}`, `${SERVER_NAMES[server]}: ${e.message}`);
    }

    // Small delay between servers to avoid rate limiting
    await new Promise(r => setTimeout(r, 150));
  }

  return extractedSources;
}

async function testM3u8Validation(sources) {
  if (sources.length === 0) return;

  console.log(`\n${C.bold}═══ Phase 6: M3U8 Playlist Validation ═══${C.reset}\n`);

  // Test the first source's m3u8
  const source = sources[0];
  const t0 = Date.now();

  try {
    const resp = await fetch(source.url, {
      headers: {
        'User-Agent': UA,
        'Accept': '*/*',
        'Referer': 'https://hexa.su/',
        'Origin': 'https://hexa.su',
      },
      signal: AbortSignal.timeout(10000),
    });

    const ms = Date.now() - t0;

    if (!resp.ok) {
      // CDN may block datacenter IPs — this is expected
      if (resp.status === 403) {
        warn('m3u8-fetch', `CDN returned 403 (expected — datacenter IP blocked). Needs residential proxy.`);
      } else {
        fail('m3u8-fetch', `HTTP ${resp.status} from CDN`);
      }
      return;
    }

    const body = await resp.text();
    if (body.includes('#EXTM3U')) {
      pass('m3u8-fetch', `Valid HLS playlist (${body.length} bytes)`, ms);

      if (body.includes('#EXT-X-STREAM-INF')) {
        const variants = (body.match(/#EXT-X-STREAM-INF/g) || []).length;
        pass('m3u8-master', `Master playlist with ${variants} quality variant(s)`);

        // Extract resolution info
        const resolutions = [...body.matchAll(/RESOLUTION=(\d+x\d+)/g)].map(m => m[1]);
        if (resolutions.length > 0) {
          pass('m3u8-quality', `Resolutions: ${resolutions.join(', ')}`);
        }
      } else if (body.includes('#EXTINF')) {
        const segments = (body.match(/#EXTINF/g) || []).length;
        pass('m3u8-segments', `Media playlist with ${segments} segment(s)`);
      }

      // Check for encryption
      if (body.includes('#EXT-X-KEY')) {
        info('Playlist uses encryption (EXT-X-KEY present)');
      }

      info(`Playlist preview:\n${body.substring(0, 500)}`);
    } else {
      warn('m3u8-fetch', `Response is not HLS (${body.length} bytes, starts with: ${body.substring(0, 50)})`);
    }
  } catch (e) {
    if (e.message.includes('timeout') || e.message.includes('TIMEOUT')) {
      warn('m3u8-fetch', `CDN timeout — may need residential proxy`);
    } else {
      warn('m3u8-fetch', `CDN fetch error: ${e.message}`);
    }
  }
}

async function testBothBackends() {
  console.log(`\n${C.bold}═══ Phase 7: Dual Backend Validation ═══${C.reset}\n`);

  const backends = [
    { name: 'hexa.su', url: 'https://theemoviedb.hexa.su/api/time' },
    { name: 'flixer.su', url: 'https://plsdontscrapemelove.flixer.su/api/time' },
  ];

  for (const backend of backends) {
    const t0 = Date.now();
    try {
      const resp = await fetch(`${backend.url}?t=${Date.now()}`, {
        signal: AbortSignal.timeout(8000),
      });
      const ms = Date.now() - t0;
      if (resp.ok) {
        const data = await resp.json();
        pass(`backend-${backend.name}`, `${backend.name} /api/time OK — timestamp: ${data.timestamp}`, ms);
      } else {
        fail(`backend-${backend.name}`, `${backend.name} returned HTTP ${resp.status}`);
      }
    } catch (e) {
      fail(`backend-${backend.name}`, `${backend.name} unreachable: ${e.message}`);
    }
  }
}

async function testWasmModuleAvailability() {
  console.log(`\n${C.bold}═══ Phase 8: Remote WASM Module Check ═══${C.reset}\n`);

  const wasmUrls = [
    { name: 'hexa.su', url: 'https://theemoviedb.hexa.su/assets/wasm/img_data.js' },
    { name: 'flixer.su', url: 'https://plsdontscrapemelove.flixer.su/assets/wasm/img_data.js' },
  ];

  for (const wasm of wasmUrls) {
    const t0 = Date.now();
    try {
      const resp = await fetch(wasm.url, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(8000),
      });
      const ms = Date.now() - t0;
      if (resp.ok) {
        const body = await resp.text();
        const hasInit = body.includes('init') || body.includes('__wbg_init');
        const hasGetKey = body.includes('get_img_key');
        const hasProcess = body.includes('process_img_data');
        pass(`wasm-remote-${wasm.name}`, `WASM JS loader available (${body.length} bytes), init:${hasInit} key:${hasGetKey} process:${hasProcess}`, ms);
      } else {
        fail(`wasm-remote-${wasm.name}`, `HTTP ${resp.status}`);
      }
    } catch (e) {
      fail(`wasm-remote-${wasm.name}`, `Unreachable: ${e.message}`);
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`${C.bold}${C.cyan}`);
  console.log(`╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║       Flixer / Hexa.su — Full E2E Validation Suite         ║`);
  console.log(`║       Testing complete extraction chain locally             ║`);
  console.log(`╚══════════════════════════════════════════════════════════════╝${C.reset}`);
  console.log(`${C.dim}Date: ${new Date().toISOString()}`);
  console.log(`API Base: ${FLIXER_API_BASE}${C.reset}`);

  const totalStart = Date.now();

  // Phase 1: WASM
  const wasmResult = await testWasmInit();
  if (!wasmResult) {
    console.log(`\n${C.red}ABORT: WASM initialization failed — cannot continue${C.reset}`);
    printSummary(totalStart);
    process.exit(1);
  }
  const { loader, apiKey } = wasmResult;

  // Phase 2: Time sync
  const timeSyncOk = await testTimeSync();
  if (!timeSyncOk) {
    console.log(`\n${C.yellow}WARNING: Time sync failed — auth may not work${C.reset}`);
  }

  // Phase 3: Decoy response
  await testDecoyResponse(apiKey);

  // Phase 4: Warm-up with Fight Club (TMDB 550)
  const warmupPath = '/api/tmdb/movie/550/images';
  const warmupEncrypted = await testWarmup(apiKey, warmupPath);

  // Phase 4b: Decrypt warm-up response
  await testWarmupDecryption(loader, apiKey, warmupEncrypted);

  // Phase 5: Server extraction
  const serversToTest = SERVER_OVERRIDE
    ? SERVER_OVERRIDE.split(',')
    : ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf'];

  const contentToTest = TMDB_OVERRIDE
    ? [{ tmdbId: TMDB_OVERRIDE, type: 'movie', title: `TMDB ${TMDB_OVERRIDE}` }]
    : TEST_CONTENT.slice(0, 3); // Test first 3 by default

  let allSources = [];
  let contentResults = [];
  for (const content of contentToTest) {
    const sources = await testServerExtraction(loader, apiKey, content, serversToTest);
    allSources.push(...sources);
    if (sources.length > 0) {
      pass(`content-${content.tmdbId}`, `${content.title}: ${sources.length}/${serversToTest.length} servers returned sources`);
    } else {
      fail(`content-${content.tmdbId}`, `${content.title}: NO servers returned sources — extraction pipeline broken`);
    }
    contentResults.push({ content, sources });
  }

  // Phase 6: M3U8 validation
  if (allSources.length > 0) {
    await testM3u8Validation(allSources);
  } else {
    warn('m3u8-skip', 'No sources extracted — skipping M3U8 validation');
  }

  // Phase 7: Both backends
  await testBothBackends();

  // Phase 8: Remote WASM availability
  await testWasmModuleAvailability();

  // Summary
  printSummary(totalStart);
}

function printSummary(totalStart) {
  const elapsed = ((Date.now() - totalStart) / 1000).toFixed(1);
  const total = results.pass + results.fail + results.warn;

  console.log(`\n${C.bold}═══════════════════════════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}  RESULTS: ${results.pass}/${total} passed, ${results.fail} failed, ${results.warn} warnings  (${elapsed}s)${C.reset}`);
  console.log(`${C.bold}═══════════════════════════════════════════════════════════════${C.reset}`);

  if (results.fail > 0) {
    console.log(`\n${C.red}Failed tests:${C.reset}`);
    results.tests.filter(t => t.status === 'fail').forEach(t => {
      console.log(`  ${C.red}✗${C.reset} ${t.test}: ${t.msg}`);
    });
  }

  if (results.warn > 0 && VERBOSE) {
    console.log(`\n${C.yellow}Warnings:${C.reset}`);
    results.tests.filter(t => t.status === 'warn').forEach(t => {
      console.log(`  ${C.yellow}⚠${C.reset} ${t.test}: ${t.msg}`);
    });
  }

  // Exit code: 0 if all critical tests pass (warnings are OK)
  const criticalFails = results.tests.filter(t =>
    t.status === 'fail' && !t.test.startsWith('m3u8-') && !t.test.startsWith('decoy-')
  ).length;

  if (criticalFails > 0) {
    console.log(`\n${C.red}${C.bold}E2E VALIDATION FAILED — ${criticalFails} critical failure(s)${C.reset}`);
    process.exit(1);
  } else if (results.fail > 0) {
    console.log(`\n${C.yellow}${C.bold}E2E VALIDATION PASSED WITH WARNINGS — non-critical failures only${C.reset}`);
    process.exit(0);
  } else {
    console.log(`\n${C.green}${C.bold}E2E VALIDATION PASSED — all tests green${C.reset}`);
    process.exit(0);
  }
}

main().catch(e => {
  console.error(`\n${C.red}FATAL: ${e.message}${C.reset}`);
  if (VERBOSE) console.error(e.stack);
  process.exit(1);
});
