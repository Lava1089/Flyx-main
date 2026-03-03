# WASM Module Reverse Engineering

## Overview

The WASM module is a Rust-compiled WebAssembly binary using `wasm-bindgen` for JS interop. It serves two critical functions:

1. **API Key Generation** (`get_img_key`) — generates a 64-character HMAC signing key
2. **Response Decryption** (`process_img_data`) — decrypts encrypted API responses

## Live WASM Module Locations (Validated March 2026)

The WASM module is served from the TMDB API backends as a JS+WASM pair:

| Backend | JS Wrapper | WASM Binary |
|---------|-----------|-------------|
| `themoviedb.hexa.su` | `/assets/wasm/img_data.js` (20,462 bytes) | `/assets/wasm/img_data_bg.wasm` |
| `plsdontscrapemelove.flixer.su` | `/assets/wasm/img_data.js` (20,462 bytes) | `/assets/wasm/img_data_bg.wasm` |

The JS wrapper (`img_data.js`) is an ES module that exports `init`, `process_img_data`, and `get_img_key`. The frontend loads it dynamically via a `<script type="module">` injected into the page.

Our local copy is `public/flixer.wasm` — this is the `img_data_bg.wasm` binary.

## Exported Functions

### `get_img_key() -> String`
Generates a 64-character API key used for HMAC-SHA256 request signing. The key length is validated client-side — if it's not exactly 64 characters, the client throws an error. The key is derived from browser environment data collected via the WASM imports (screen resolution, canvas fingerprint, localStorage session ID, etc.).

Stack pointer manipulation pattern:
```
__wbindgen_add_to_stack_pointer(-16)  // allocate return space
get_img_key(retptr)                    // write result to stack
// Read 4 int32s from retptr:
//   r0 = string pointer
//   r1 = string length
//   r2 = error object (if r3 is truthy)
//   r3 = error flag
__wbindgen_export_4(r0, r1, 1)        // free the string memory
__wbindgen_add_to_stack_pointer(16)    // restore stack
```

### `process_img_data(data: String, key: String) -> Any`
Decrypts an encrypted API response using the API key. Returns a JS object (parsed JSON internally).

```
// Pass strings to WASM memory via __wbindgen_export_1 (malloc)
p0 = passStringToWasm0(data, __wbindgen_export_1)
p1 = passStringToWasm0(key, __wbindgen_export_1)
result = process_img_data(p0, len0, p1, len1)
// Result is a heap object index — retrieve via takeObject()
```

## Required Browser API Mocks

The WASM module expects a full browser environment. These must be mocked for server-side execution:

### Window Object
- `window.document` — DOM access
- `window.localStorage` — session persistence
- `window.navigator` — platform/UA/language
- `window.screen` — resolution/color depth
- `window.performance` — timing
- `globalThis`, `self`, `WINDOW` — global accessors

### Document APIs
- `document.createElement('canvas')` — canvas fingerprinting
- `document.getElementsByTagName('body')` — DOM traversal
- `document.body.clientWidth/clientHeight` — viewport dimensions

### Canvas Fingerprinting
The WASM creates a canvas element, sets font properties, calls `fillText()`, and reads `toDataURL()` to generate a browser fingerprint. The mock must return a consistent base64 data URL:
```
data:image/png;base64,<base64_of("canvas-fp-1920x1080-24-Win32-en-US")>
```

Canvas mock requirements:
- `width`/`height` getters and setters
- `getContext('2d')` returning a context with `font`, `textBaseline`, `fillText()`
- `toDataURL()` returning a deterministic data URL

### LocalStorage
- `getItem('tmdb_session_id')` — returns a UUID-like session ID (32 hex chars, no dashes)
- `setItem()` — no-op

### Navigator
- `platform` → `"Win32"`
- `language` → `"en-US"`
- `userAgent` → Chrome UA string

### Screen
- `width` → `1920`
- `height` → `1080`
- `colorDepth` → `24`

### Date/Time
- `Date.now()` → fixed timestamp (offset by ~5000ms from init time)
- `new Date().getTimezoneOffset()` → local timezone offset
- `performance.now()` → relative to init timestamp
- `Math.random()` → fixed seed value

## wasm-bindgen Import Signatures

All imports are in the `wbg` namespace. Key bindings identified:

| Import | Purpose |
|--------|---------|
| `__wbg_call_672a4d21634d4a24` | `Function.call(thisArg)` |
| `__wbg_call_7cccdd69e0791ae2` | `Function.call(thisArg, arg1)` |
| `__wbg_colorDepth_59677c81c61d599a` | `screen.colorDepth` |
| `__wbg_height_614ba187d8cae9ca` | `screen.height` |
| `__wbg_width_679079836447b4b7` | `screen.width` |
| `__wbg_screen_8edf8699f70d98bc` | `window.screen` |
| `__wbg_document_d249400bd7bd996d` | `window.document` |
| `__wbg_createElement_8c9931a732ee2fea` | `document.createElement()` |
| `__wbg_getElementsByTagName_f03d41ce466561e8` | `document.getElementsByTagName()` |
| `__wbg_getContext_e9cf379449413580` | `canvas.getContext()` |
| `__wbg_fillText_2a0055d8531355d1` | `ctx.fillText()` |
| `__wbg_setfont_42a163ef83420b93` | `ctx.font = ...` |
| `__wbg_settextBaseline_c28d2a6aa4ff9d9d` | `ctx.textBaseline = ...` |
| `__wbg_toDataURL_eaec332e848fe935` | `canvas.toDataURL()` |
| `__wbg_localStorage_1406c99c39728187` | `window.localStorage` |
| `__wbg_getItem_17f98dee3b43fa7e` | `localStorage.getItem()` |
| `__wbg_setItem_212ecc915942ab0a` | `localStorage.setItem()` |
| `__wbg_navigator_1577371c070c8947` | `window.navigator` |
| `__wbg_language_d871ec78ee8eec62` | `navigator.language` |
| `__wbg_platform_faf02c487289f206` | `navigator.platform` |
| `__wbg_userAgent_12e9d8e62297563f` | `navigator.userAgent` |
| `__wbg_new0_f788a2397c7ca929` | `new Date()` |
| `__wbg_now_807e54c39636c349` | `Date.now()` |
| `__wbg_getTimezoneOffset_6b5752021c499c47` | `date.getTimezoneOffset()` |
| `__wbg_performance_c185c0cdc2766575` | `window.performance` |
| `__wbg_now_d18023d54d4e5500` | `performance.now()` |
| `__wbg_random_3ad904d98382defe` | `Math.random()` |
| `__wbg_length_347907d14a9ed873` | `collection.length` |
| `__wbg_new_23a2665fac83c611` | `new Promise()` |
| `__wbg_resolve_4851785c9c5f573d` | `Promise.resolve()` |
| `__wbg_then_44b73946d2fb3e7d` | `promise.then()` |
| `__wbg_newnoargs_105ed471475aaf50` | `new Function()` |
| `__wbindgen_closure_wrapper982` | Closure wrapper (dtor=36) |

## Internal WASM Exports

| Export | Purpose |
|--------|---------|
| `memory` | Linear memory |
| `get_img_key` | API key generation |
| `process_img_data` | Response decryption |
| `__wbindgen_add_to_stack_pointer` | Stack management |
| `__wbindgen_export_0` | Error handler |
| `__wbindgen_export_1` | Malloc (string allocation) |
| `__wbindgen_export_3` | Function table (closure destructors) |
| `__wbindgen_export_4` | Free (string deallocation) |
| `__wbindgen_export_5` | Closure invoke |
| `__wbindgen_export_6` | Promise callback invoke |

## Heap Management

The WASM uses a slab allocator for JS object references:
- Heap slots 0–131 are reserved (undefined, null, true, false, etc.)
- `addHeapObject()` pushes objects onto the heap, returning an index
- `dropObject()` / `takeObject()` free slots using a free-list pattern
- The `heap_next` pointer tracks the next free slot

## Deployment Considerations

- On Cloudflare Workers: WASM must be **bundled at build time** via wrangler's `import` syntax. Runtime `WebAssembly.compile()` is blocked ("Wasm code generation disallowed by embedder").
- On Node.js/Docker: WASM is loaded from disk via `readFileSync()` + `WebAssembly.compile()`.
- The WASM module should be re-initialized every ~30 minutes to avoid stale state (key rotation).
