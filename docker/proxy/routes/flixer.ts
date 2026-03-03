/**
 * Flixer WASM-based extraction.
 *
 * Loads the flixer.wasm module, obtains an API key via the WASM keygen,
 * signs requests with HMAC, syncs server time, and extracts stream URLs
 * with retry logic.
 *
 * /flixer/extract — extract stream URL from Flixer
 * /flixer/stream  — delegates to generic stream proxy (handled in server.ts)
 */

import { USER_AGENT, errorResponse, jsonResponse } from "../lib/helpers";
import { fetchText, fetchJson } from "../lib/fetch";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { createHmac, randomBytes, randomUUID } from "crypto";

// flixer.sh went NXDOMAIN ~Feb 2026, flixer.su is the current domain.
// flixer.su has a Joken JWT JS challenge — switched to hexa.su backend (same API, no challenge).
const FLIXER_API_BASE = "https://themoviedb.hexa.su";
const SERVER_NAMES: Record<string, string> = {
  alpha: "Ares",
  bravo: "Balder",
  charlie: "Circe",
  delta: "Dionysus",
  echo: "Eros",
  foxtrot: "Freya",
  golf: "Gaia",
  hotel: "Hades",
  india: "Isis",
  juliet: "Juno",
  kilo: "Kronos",
  lima: "Loki",
  mike: "Medusa",
  november: "Nyx",
  oscar: "Odin",
  papa: "Persephone",
  quebec: "Quirinus",
  romeo: "Ra",
  sierra: "Selene",
  tango: "Thor",
  uniform: "Uranus",
  victor: "Vulcan",
  whiskey: "Woden",
  xray: "Xolotl",
  yankee: "Ymir",
  zulu: "Zeus",
};

// Module-level state
let wasmInstance: FlixerWasmLoader | null = null;
let apiKey: string | null = null;
let serverTimeOffset = 0;
let initPromise: Promise<void> | null = null;
let initError: string | null = null;

// ---------------------------------------------------------------------------
// WASM Loader — provides a browser-like environment for the Flixer WASM
// ---------------------------------------------------------------------------

class FlixerWasmLoader {
  wasm: WebAssembly.Exports & Record<string, Function> = null!;
  private heap: unknown[] = new Array(128).fill(undefined);
  private heap_next: number;
  private WASM_VECTOR_LEN = 0;
  private cachedUint8ArrayMemory0: Uint8Array | null = null;
  private cachedDataViewMemory0: DataView | null = null;
  private cachedTextDecoder = new TextDecoder("utf-8", {
    ignoreBOM: true,
    fatal: true,
  });
  private cachedTextEncoder = new TextEncoder();
  private sessionId = randomUUID().replace(/-/g, "");
  private timestamp = Date.now() - 5000;
  private randomSeed = Math.random();
  private timezoneOffset = new Date().getTimezoneOffset();

  constructor() {
    this.heap.push(undefined, null, true, false);
    this.heap_next = this.heap.length;
  }

  private getObject(idx: number): unknown {
    return this.heap[idx];
  }

  private addHeapObject(obj: unknown): number {
    if (this.heap_next === this.heap.length)
      this.heap.push(this.heap.length + 1);
    const idx = this.heap_next;
    this.heap_next = this.heap[idx] as number;
    this.heap[idx] = obj;
    return idx;
  }

  private dropObject(idx: number): void {
    if (idx < 132) return;
    this.heap[idx] = this.heap_next;
    this.heap_next = idx;
  }

  private takeObject(idx: number): unknown {
    const r = this.getObject(idx);
    this.dropObject(idx);
    return r;
  }

  private getUint8ArrayMemory0(): Uint8Array {
    if (
      !this.cachedUint8ArrayMemory0 ||
      this.cachedUint8ArrayMemory0.byteLength === 0
    )
      this.cachedUint8ArrayMemory0 = new Uint8Array(
        (this.wasm.memory as WebAssembly.Memory).buffer,
      );
    return this.cachedUint8ArrayMemory0;
  }

  private getDataViewMemory0(): DataView {
    if (
      !this.cachedDataViewMemory0 ||
      this.cachedDataViewMemory0.buffer !==
        (this.wasm.memory as WebAssembly.Memory).buffer
    )
      this.cachedDataViewMemory0 = new DataView(
        (this.wasm.memory as WebAssembly.Memory).buffer,
      );
    return this.cachedDataViewMemory0;
  }

  private getStringFromWasm0(ptr: number, len: number): string {
    return this.cachedTextDecoder.decode(
      this.getUint8ArrayMemory0().subarray(ptr >>> 0, (ptr >>> 0) + len),
    );
  }

  private passStringToWasm0(arg: string, malloc: Function): number {
    const buf = this.cachedTextEncoder.encode(arg);
    const ptr = (malloc(buf.length, 1) as number) >>> 0;
    this.getUint8ArrayMemory0()
      .subarray(ptr, ptr + buf.length)
      .set(buf);
    this.WASM_VECTOR_LEN = buf.length;
    return ptr;
  }

  private isLikeNone(x: unknown): boolean {
    return x === undefined || x === null;
  }

  private handleError(f: Function, args: IArguments): unknown {
    try {
      return f.apply(this, args);
    } catch (e) {
      (this.wasm.__wbindgen_export_0 as Function)(this.addHeapObject(e));
    }
  }

  private buildImports(): WebAssembly.Imports {
    const self = this;
    const scr = { width: 1920, height: 1080, colorDepth: 24 };
    const nav = { platform: "Win32", language: "en-US", userAgent: USER_AGENT };
    const perf = { now: () => Date.now() - self.timestamp };
    const ls = {
      getItem: (k: string) =>
        k === "tmdb_session_id" ? self.sessionId : null,
      setItem: (_key: string, _value: string) => {},
    };
    const canvasCtx = {
      _font: "14px Arial",
      _textBaseline: "alphabetic",
      fillText(_text: string, _x: number, _y: number) {},
      get font() { return this._font; },
      set font(v: string) { this._font = v; },
      get textBaseline() { return this._textBaseline; },
      set textBaseline(v: string) { this._textBaseline = v; },
    };
    const canvas = {
      _width: 200,
      _height: 50,
      get width() { return this._width; },
      set width(v: number) { this._width = v; },
      get height() { return this._height; },
      set height(v: number) { this._height = v; },
      getContext: (t: string) => (t === "2d" ? canvasCtx : null),
      toDataURL: () =>
        "data:image/png;base64," +
        Buffer.from("canvas-fp-1920x1080-24-Win32-en-US").toString("base64"),
    };
    const mockBody = {
      appendChild: () => {},
      clientWidth: 1920,
      clientHeight: 1080,
    };
    const createCollection = (els: unknown[]) => {
      const c: Record<string | number, unknown> = {
        length: els.length,
        item: (i: number) => els[i] || null,
      };
      els.forEach((e, i) => { c[i] = e; });
      return new Proxy(c, {
        get(t, p) {
          if (typeof p === "string" && !isNaN(parseInt(p)))
            return t[parseInt(p)];
          return t[p as string];
        },
      });
    };
    const doc = {
      createElement: (t: string) => (t === "canvas" ? canvas : {}),
      getElementsByTagName: (t: string) =>
        t === "body"
          ? createCollection([mockBody])
          : createCollection([]),
      body: mockBody,
    };
    const win = {
      document: doc,
      localStorage: ls,
      navigator: nav,
      screen: scr,
      performance: perf,
    };

    const i: Record<string, Record<string, Function>> = { wbg: {} };

    // Call bindings
    i.wbg.__wbg_call_672a4d21634d4a24 = function () {
      return self.handleError(
        (a: number, b: number) =>
          self.addHeapObject(
            (self.getObject(a) as Function).call(self.getObject(b)),
          ),
        arguments,
      );
    };
    i.wbg.__wbg_call_7cccdd69e0791ae2 = function () {
      return self.handleError(
        (a: number, b: number, c: number) =>
          self.addHeapObject(
            (self.getObject(a) as Function).call(
              self.getObject(b),
              self.getObject(c),
            ),
          ),
        arguments,
      );
    };

    // Screen bindings
    i.wbg.__wbg_colorDepth_59677c81c61d599a = function () {
      return self.handleError(
        (a: number) => (self.getObject(a) as typeof scr).colorDepth,
        arguments,
      );
    };
    i.wbg.__wbg_height_614ba187d8cae9ca = function () {
      return self.handleError(
        (a: number) => (self.getObject(a) as typeof scr).height,
        arguments,
      );
    };
    i.wbg.__wbg_width_679079836447b4b7 = function () {
      return self.handleError(
        (a: number) => (self.getObject(a) as typeof scr).width,
        arguments,
      );
    };
    i.wbg.__wbg_screen_8edf8699f70d98bc = function () {
      return self.handleError(
        (a: number) => {
          const w = self.getObject(a) as typeof win | null;
          return self.addHeapObject(w ? w.screen : scr);
        },
        arguments,
      );
    };

    // Document bindings
    i.wbg.__wbg_document_d249400bd7bd996d = (a: number) => {
      const w = self.getObject(a) as typeof win | null;
      const d = w ? w.document : null;
      return d ? self.addHeapObject(d) : 0;
    };
    i.wbg.__wbg_createElement_8c9931a732ee2fea = function () {
      return self.handleError(
        (_a: number, b: number, c: number) =>
          self.addHeapObject(
            doc.createElement(self.getStringFromWasm0(b, c)),
          ),
        arguments,
      );
    };
    i.wbg.__wbg_getElementsByTagName_f03d41ce466561e8 = (
      _a: number,
      b: number,
      c: number,
    ) =>
      self.addHeapObject(
        doc.getElementsByTagName(self.getStringFromWasm0(b, c)),
      );

    // Canvas bindings
    i.wbg.__wbg_getContext_e9cf379449413580 = function () {
      return self.handleError(
        (a: number, b: number, c: number) => {
          const r = (self.getObject(a) as typeof canvas).getContext(
            self.getStringFromWasm0(b, c),
          );
          return self.isLikeNone(r) ? 0 : self.addHeapObject(r);
        },
        arguments,
      );
    };
    i.wbg.__wbg_fillText_2a0055d8531355d1 = function () {
      return self.handleError(
        (a: number, b: number, c: number, d: number, e: number) =>
          (self.getObject(a) as typeof canvasCtx).fillText(
            self.getStringFromWasm0(b, c),
            d,
            e,
          ),
        arguments,
      );
    };
    i.wbg.__wbg_setfont_42a163ef83420b93 = (
      a: number,
      b: number,
      c: number,
    ) => {
      (self.getObject(a) as typeof canvasCtx).font =
        self.getStringFromWasm0(b, c);
    };
    i.wbg.__wbg_settextBaseline_c28d2a6aa4ff9d9d = (
      a: number,
      b: number,
      c: number,
    ) => {
      (self.getObject(a) as typeof canvasCtx).textBaseline =
        self.getStringFromWasm0(b, c);
    };
    i.wbg.__wbg_setheight_da683a33fa99843c = (a: number, b: number) => {
      (self.getObject(a) as typeof canvas).height = b >>> 0;
    };
    i.wbg.__wbg_setwidth_c5fed9f5e7f0b406 = (a: number, b: number) => {
      (self.getObject(a) as typeof canvas).width = b >>> 0;
    };
    i.wbg.__wbg_toDataURL_eaec332e848fe935 = function () {
      return self.handleError(
        (a: number, b: number) => {
          const r = (self.getObject(b) as typeof canvas).toDataURL();
          const p = self.passStringToWasm0(
            r,
            self.wasm.__wbindgen_export_1 as Function,
          );
          self
            .getDataViewMemory0()
            .setInt32(a + 4, self.WASM_VECTOR_LEN, true);
          self.getDataViewMemory0().setInt32(a, p, true);
        },
        arguments,
      );
    };
    i.wbg.__wbg_instanceof_CanvasRenderingContext2d_df82a4d3437bf1cc =
      () => 1;
    i.wbg.__wbg_instanceof_HtmlCanvasElement_2ea67072a7624ac5 = () => 1;
    i.wbg.__wbg_instanceof_Window_def73ea0955fc569 = () => 1;

    // LocalStorage bindings
    i.wbg.__wbg_localStorage_1406c99c39728187 = function () {
      return self.handleError(
        (a: number) => {
          const w = self.getObject(a) as typeof win | null;
          return self.isLikeNone(w ? w.localStorage : ls)
            ? 0
            : self.addHeapObject(w ? w.localStorage : ls);
        },
        arguments,
      );
    };
    i.wbg.__wbg_getItem_17f98dee3b43fa7e = function () {
      return self.handleError(
        (a: number, b: number, c: number, d: number) => {
          const r = (self.getObject(b) as typeof ls).getItem(
            self.getStringFromWasm0(c, d),
          );
          const p = self.isLikeNone(r)
            ? 0
            : self.passStringToWasm0(
                r!,
                self.wasm.__wbindgen_export_1 as Function,
              );
          self
            .getDataViewMemory0()
            .setInt32(a + 4, self.WASM_VECTOR_LEN, true);
          self.getDataViewMemory0().setInt32(a, p, true);
        },
        arguments,
      );
    };
    i.wbg.__wbg_setItem_212ecc915942ab0a = function () {
      return self.handleError(
        (a: number, b: number, c: number, d: number, e: number) => {
          (self.getObject(a) as typeof ls).setItem(
            self.getStringFromWasm0(b, c),
            self.getStringFromWasm0(d, e),
          );
        },
        arguments,
      );
    };

    // Navigator bindings
    i.wbg.__wbg_navigator_1577371c070c8947 = (a: number) => {
      const w = self.getObject(a) as typeof win | null;
      return self.addHeapObject(w ? w.navigator : nav);
    };
    i.wbg.__wbg_language_d871ec78ee8eec62 = (a: number, b: number) => {
      const r = (self.getObject(b) as typeof nav).language;
      const p = self.isLikeNone(r)
        ? 0
        : self.passStringToWasm0(
            r,
            self.wasm.__wbindgen_export_1 as Function,
          );
      self.getDataViewMemory0().setInt32(a + 4, self.WASM_VECTOR_LEN, true);
      self.getDataViewMemory0().setInt32(a, p, true);
    };
    i.wbg.__wbg_platform_faf02c487289f206 = function () {
      return self.handleError(
        (a: number, b: number) => {
          const r = (self.getObject(b) as typeof nav).platform;
          const p = self.passStringToWasm0(
            r,
            self.wasm.__wbindgen_export_1 as Function,
          );
          self
            .getDataViewMemory0()
            .setInt32(a + 4, self.WASM_VECTOR_LEN, true);
          self.getDataViewMemory0().setInt32(a, p, true);
        },
        arguments,
      );
    };
    i.wbg.__wbg_userAgent_12e9d8e62297563f = function () {
      return self.handleError(
        (a: number, b: number) => {
          const r = (self.getObject(b) as typeof nav).userAgent;
          const p = self.passStringToWasm0(
            r,
            self.wasm.__wbindgen_export_1 as Function,
          );
          self
            .getDataViewMemory0()
            .setInt32(a + 4, self.WASM_VECTOR_LEN, true);
          self.getDataViewMemory0().setInt32(a, p, true);
        },
        arguments,
      );
    };

    // Date/time bindings
    i.wbg.__wbg_new0_f788a2397c7ca929 = () =>
      self.addHeapObject(new Date(self.timestamp));
    i.wbg.__wbg_now_807e54c39636c349 = () => self.timestamp;
    i.wbg.__wbg_getTimezoneOffset_6b5752021c499c47 = () =>
      self.timezoneOffset;
    i.wbg.__wbg_performance_c185c0cdc2766575 = (a: number) => {
      const w = self.getObject(a) as typeof win | null;
      return self.isLikeNone(w ? w.performance : perf)
        ? 0
        : self.addHeapObject(w ? w.performance : perf);
    };
    i.wbg.__wbg_now_d18023d54d4e5500 = (a: number) =>
      (self.getObject(a) as typeof perf).now();
    i.wbg.__wbg_random_3ad904d98382defe = () => self.randomSeed;

    // Collection/array bindings
    i.wbg.__wbg_length_347907d14a9ed873 = (a: number) =>
      (self.getObject(a) as { length: number }).length;

    // Promise bindings
    i.wbg.__wbg_new_23a2665fac83c611 = (a: number, b: number) => {
      try {
        const s = { a, b };
        const cb = (x: unknown, y: unknown) => {
          const t = s.a;
          s.a = 0;
          try {
            return (self.wasm.__wbindgen_export_6 as Function)(
              t,
              s.b,
              self.addHeapObject(x),
              self.addHeapObject(y),
            );
          } finally {
            s.a = t;
          }
        };
        return self.addHeapObject(new Promise(cb));
      } finally {
        // cleanup handled by WASM
      }
    };
    i.wbg.__wbg_resolve_4851785c9c5f573d = (a: number) =>
      self.addHeapObject(Promise.resolve(self.getObject(a)));
    i.wbg.__wbg_reject_b3fcf99063186ff7 = (a: number) =>
      self.addHeapObject(Promise.reject(self.getObject(a)));
    i.wbg.__wbg_then_44b73946d2fb3e7d = (a: number, b: number) =>
      self.addHeapObject(
        (self.getObject(a) as Promise<unknown>).then(
          self.getObject(b) as (v: unknown) => unknown,
        ),
      );

    // Function/global bindings
    i.wbg.__wbg_newnoargs_105ed471475aaf50 = (a: number, b: number) =>
      self.addHeapObject(new Function(self.getStringFromWasm0(a, b)));
    i.wbg.__wbg_static_accessor_GLOBAL_88a902d13a557d07 = () => 0;
    i.wbg.__wbg_static_accessor_GLOBAL_THIS_56578be7e9f832b0 = () =>
      self.addHeapObject(globalThis);
    i.wbg.__wbg_static_accessor_SELF_37c5d418e4bf5819 = () =>
      self.addHeapObject(win);
    i.wbg.__wbg_static_accessor_WINDOW_5de37043a91a9c40 = () =>
      self.addHeapObject(win);

    // Microtask bindings
    i.wbg.__wbg_queueMicrotask_97d92b4fcc8a61c5 = (a: number) =>
      queueMicrotask(self.getObject(a) as () => void);
    i.wbg.__wbg_queueMicrotask_d3219def82552485 = (a: number) =>
      self.addHeapObject(
        (self.getObject(a) as { queueMicrotask: unknown }).queueMicrotask,
      );

    // Wbindgen core bindings
    i.wbg.__wbindgen_cb_drop = (a: number) => {
      const o = self.takeObject(a) as { original: { cnt: number; a: number } };
      if (o.original.cnt-- === 1) {
        o.original.a = 0;
        return true;
      }
      return false;
    };
    i.wbg.__wbindgen_closure_wrapper982 = (a: number, b: number) => {
      const s = { a, b, cnt: 1, dtor: 36 };
      const r = (...args: unknown[]) => {
        s.cnt++;
        const t = s.a;
        s.a = 0;
        try {
          return (self.wasm.__wbindgen_export_5 as Function)(
            t,
            s.b,
            self.addHeapObject(args[0]),
          );
        } finally {
          if (--s.cnt === 0)
            (self.wasm.__wbindgen_export_3 as { get: Function }).get(s.dtor)(
              t,
              s.b,
            );
          else s.a = t;
        }
      };
      (r as unknown as { original: typeof s }).original = s;
      return self.addHeapObject(r);
    };
    i.wbg.__wbindgen_is_function = (a: number) =>
      typeof self.getObject(a) === "function";
    i.wbg.__wbindgen_is_undefined = (a: number) =>
      self.getObject(a) === undefined;
    i.wbg.__wbindgen_object_clone_ref = (a: number) =>
      self.addHeapObject(self.getObject(a));
    i.wbg.__wbindgen_object_drop_ref = (a: number) => self.takeObject(a);
    i.wbg.__wbindgen_string_new = (a: number, b: number) =>
      self.addHeapObject(self.getStringFromWasm0(a, b));
    i.wbg.__wbindgen_throw = (a: number, b: number) => {
      throw new Error(self.getStringFromWasm0(a, b));
    };

    return i as unknown as WebAssembly.Imports;
  }

  async initialize(wasmPath: string): Promise<this> {
    const wasmBuffer = readFileSync(wasmPath);
    const wasmModule = await WebAssembly.compile(wasmBuffer);
    const imports = this.buildImports();
    const instance = await WebAssembly.instantiate(wasmModule, imports);
    this.wasm = instance.exports as typeof this.wasm;
    return this;
  }

  getImgKey(): string {
    const retptr = (this.wasm.__wbindgen_add_to_stack_pointer as Function)(
      -16,
    ) as number;
    try {
      (this.wasm.get_img_key as Function)(retptr);
      const dv = this.getDataViewMemory0();
      const r0 = dv.getInt32(retptr, true);
      const r1 = dv.getInt32(retptr + 4, true);
      const r2 = dv.getInt32(retptr + 8, true);
      const r3 = dv.getInt32(retptr + 12, true);
      if (r3) throw this.takeObject(r2);
      const result = this.getStringFromWasm0(r0, r1);
      (this.wasm.__wbindgen_export_4 as Function)(r0, r1, 1);
      return result;
    } finally {
      (this.wasm.__wbindgen_add_to_stack_pointer as Function)(16);
    }
  }

  async processImgData(data: string, key: string): Promise<unknown> {
    const p0 = this.passStringToWasm0(
      data,
      this.wasm.__wbindgen_export_1 as Function,
    );
    const l0 = this.WASM_VECTOR_LEN;
    const p1 = this.passStringToWasm0(
      key,
      this.wasm.__wbindgen_export_1 as Function,
    );
    const l1 = this.WASM_VECTOR_LEN;
    return this.takeObject(
      (this.wasm.process_img_data as Function)(p0, l0, p1, l1) as number,
    );
  }
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

function generateClientFingerprint(): string {
  const fpString = `2560x1440:24:${USER_AGENT.substring(0, 50)}:Win32:en-US:${new Date().getTimezoneOffset()}:iVBORw0KGgoAAAANSUhEUgAAASwA`;
  let hash = 0;
  for (let i = 0; i < fpString.length; i++) {
    hash = (hash << 5) - hash + fpString.charCodeAt(i);
    hash &= hash;
  }
  return Math.abs(hash).toString(36);
}

async function syncServerTime(): Promise<void> {
  const before = Date.now();
  const { data } = await fetchJson<{ timestamp: number }>(
    `${FLIXER_API_BASE}/api/time?t=${before}`,
  );
  const after = Date.now();
  serverTimeOffset = data.timestamp * 1000 + (after - before) / 2 - after;
}

function getTimestamp(): number {
  return Math.floor((Date.now() + serverTimeOffset) / 1000);
}

async function makeFlixerRequest(
  key: string,
  apiPath: string,
  extraHeaders: Record<string, string> = {},
): Promise<string> {
  const timestamp = getTimestamp();
  const nonce = randomBytes(16)
    .toString("base64")
    .replace(/[/+=]/g, "")
    .substring(0, 22);
  const message = `${key}:${timestamp}:${nonce}:${apiPath}`;
  const signature = createHmac("sha256", key).update(message).digest("base64");

  const headers: Record<string, string> = {
    "X-Api-Key": key,
    "X-Request-Timestamp": timestamp.toString(),
    "X-Request-Nonce": nonce,
    "X-Request-Signature": signature,
    "X-Client-Fingerprint": generateClientFingerprint(),
    Accept: "text/plain",
    "Accept-Language": "en-US,en;q=0.9",
    ...extraHeaders,
  };

  const { text, status } = await fetchText(
    `${FLIXER_API_BASE}${apiPath}`,
    headers,
  );
  if (status >= 400)
    throw new Error(`HTTP ${status}: ${text.substring(0, 200)}`);
  return text;
}

// ---------------------------------------------------------------------------
// Stream URL extraction with retry logic
// ---------------------------------------------------------------------------

async function getFlixerSource(
  loader: FlixerWasmLoader,
  key: string,
  type: string,
  tmdbId: string,
  server: string,
  season?: string,
  episode?: string,
): Promise<string | null> {
  const apiPath =
    type === "movie"
      ? `/api/tmdb/movie/${tmdbId}/images`
      : `/api/tmdb/tv/${tmdbId}/season/${season}/episode/${episode}/images`;

  // Warm-up request
  try {
    await makeFlixerRequest(key, apiPath, {});
  } catch {
    // warm-up can fail — that's fine
  }
  await new Promise((r) => setTimeout(r, 100));

  for (let attempt = 1; attempt <= 5; attempt++) {
    const encrypted = await makeFlixerRequest(key, apiPath, {
      "X-Only-Sources": "1",
      "X-Server": server,
    });
    const decrypted = (await loader.processImgData(encrypted, key)) as string;
    const data = JSON.parse(decrypted) as Record<string, unknown>;

    let url: string | null = null;

    // Try sources array
    if (Array.isArray(data.sources)) {
      const s =
        (data.sources as Record<string, unknown>[]).find(
          (s) => s.server === server,
        ) || (data.sources as Record<string, unknown>[])[0];
      url =
        (s?.url as string) || (s?.file as string) || (s?.stream as string) || null;
      if (!url && s?.sources) {
        const inner = s.sources as Record<string, unknown>[];
        url = (inner[0]?.url as string) || (inner[0]?.file as string) || null;
      }
    }

    // Try other shapes
    if (!url) {
      const src = data.sources as Record<string, unknown> | undefined;
      url =
        (src?.file as string) ||
        (src?.url as string) ||
        (data.file as string) ||
        (data.url as string) ||
        (data.stream as string) ||
        null;
    }

    // Try servers map
    if (!url && data.servers) {
      const sd = (data.servers as Record<string, unknown>)[server];
      if (sd) {
        if (Array.isArray(sd)) {
          url =
            ((sd as Record<string, unknown>[])[0]?.url as string) ||
            ((sd as Record<string, unknown>[])[0]?.file as string) ||
            null;
        } else {
          url =
            ((sd as Record<string, unknown>).url as string) ||
            ((sd as Record<string, unknown>).file as string) ||
            ((sd as Record<string, unknown>).stream as string) ||
            null;
        }
      }
    }

    if (url && url.trim()) return url;
    if (attempt < 5) await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public handler
// ---------------------------------------------------------------------------

/** Check if the WASM module is loaded. */
export function isWasmLoaded(): boolean {
  return wasmInstance !== null;
}

/**
 * Ensure WASM is initialized exactly once, even under concurrent requests.
 */
async function ensureWasmInitialized(): Promise<void> {
  if (wasmInstance && apiKey) return;

  // If another request is already initializing, wait for it
  if (initPromise) {
    await initPromise;
    if (wasmInstance && apiKey) return;
    throw new Error(initError || "WASM initialization failed");
  }

  // We're the first — take the lock
  initPromise = (async () => {
    try {
      console.log("[Flixer] Initializing WASM...");
      const wasmPaths = [
        "/app/public/flixer.wasm",
        join(import.meta.dir, "..", "..", "public", "flixer.wasm"),
        join(process.cwd(), "public", "flixer.wasm"),
      ];
      let wasmPath: string | null = null;
      for (const p of wasmPaths) {
        if (existsSync(p)) {
          wasmPath = p;
          break;
        }
      }
      if (!wasmPath) {
        initError = "Flixer WASM not found";
        throw new Error(initError);
      }

      await syncServerTime();
      const loader = new FlixerWasmLoader();
      await loader.initialize(wasmPath);
      const key = loader.getImgKey();
      console.log(`[Flixer] WASM initialized, key prefix: ${key.substring(0, 16)}`);

      // Only assign after everything succeeds
      wasmInstance = loader;
      apiKey = key;
      initError = null;
    } catch (err) {
      initError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  })();

  try {
    await initPromise;
  } finally {
    initPromise = null;
  }
}

/**
 * Handle a Flixer extraction request.
 */
export async function handleFlixerExtract(
  _req: Request,
  url: URL,
): Promise<Response> {
  const tmdbId = url.searchParams.get("tmdbId");
  const type = url.searchParams.get("type") || "movie";
  const season = url.searchParams.get("season");
  const episode = url.searchParams.get("episode");
  const server = url.searchParams.get("server") || "alpha";

  if (!tmdbId) return errorResponse("Missing tmdbId", 400);
  if (type === "tv" && (!season || !episode))
    return errorResponse("Season and episode required for TV", 400);

  try {
    await ensureWasmInitialized();

    const streamUrl = await getFlixerSource(
      wasmInstance!,
      apiKey!,
      type,
      tmdbId,
      server,
      season || undefined,
      episode || undefined,
    );

    if (!streamUrl) {
      return jsonResponse(
        { success: false, error: "No stream URL found", server },
        404,
      );
    }

    return jsonResponse({
      success: true,
      sources: [
        {
          quality: "auto",
          title: `Flixer ${SERVER_NAMES[server] || server}`,
          url: streamUrl,
          type: "hls",
          referer: "https://flixer.su/",
          requiresSegmentProxy: true,
          status: "working",
          language: "en",
          server,
        },
      ],
      server,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Flixer] Error:", message);
    // Only reset WASM on initialization errors, not extraction errors
    if (!wasmInstance || !apiKey) {
      wasmInstance = null;
      apiKey = null;
    }
    return jsonResponse({ success: false, error: message }, 500);
  }
}
