# API Architecture

## Base URLs (Validated March 2026)

Two equivalent TMDB API backends exist:

| Backend | Base URL | Status |
|---------|----------|--------|
| Hexa | `https://themoviedb.hexa.su` | ✅ Live |
| Flixer | `https://plsdontscrapemelove.flixer.su` | ✅ Live |

Both serve identical APIs, WASM modules, and client JS. Our codebase currently uses `themoviedb.hexa.su`.

Additionally, each frontend has a separate user-facing API:
- `https://api.hexa.su` — user auth, progress tracking, watch parties, websocket
- `https://api.flixer.su` — user auth, progress tracking

## Endpoints

### Time Sync
```
GET /api/time?t=<local_timestamp_ms>
```
Returns: `{ "time": <unix_ms>, "timestamp": <unix_seconds> }`

Note: The response includes both `time` (milliseconds) and `timestamp` (seconds). Our code uses `timestamp`.

Server time is cached client-side for 5 minutes (`SERVER_TIME_CACHE_TTL = 300000ms`).

### Movie Sources
```
GET /api/tmdb/movie/<tmdb_id>/images
```

### TV Episode Sources
```
GET /api/tmdb/tv/<tmdb_id>/season/<season>/episode/<episode>/images
```

Note: The `/images` suffix is a deliberate obfuscation — these endpoints return encrypted stream data when called with proper WASM auth headers. Without auth, they return real TMDB image data (backdrops, posters) as a decoy.

## Client-Side Module Loading

The frontend dynamically loads two client modules from the TMDB backend:

```
/assets/client/tmdb-image-enhancer.js  — WASM loading, auth, encryption/decryption
/assets/client/tmdb-poster-utils.js    — server name mapping, M3U8 parsing, source analysis
/assets/wasm/img_data.js               — wasm-bindgen JS wrapper (ES module)
/assets/wasm/img_data_bg.wasm          — compiled Rust WASM binary
```

The loading chain:
1. Frontend injects `<script type="module">` that imports from `themoviedb.hexa.su/assets/client/`
2. `tmdb-image-enhancer.js` dynamically loads the WASM via another injected script
3. WASM `init()` is called with the `.wasm` URL
4. `get_img_key()` generates the 64-char API key
5. Key + WASM processor are cached on `window.wasmImgData`

## Rate Limiting

The client enforces a **50-call limit** per session on `process_img_data()`:
- Tracked via `localStorage` keys `cc` (call count) and `lc` (last call time)
- After 50 calls, throws "Image processing limit reached (50 calls) - refresh page to reset"
- 200ms minimum delay between processing calls
- `clearImageEnhancementSession()` resets the counter

## Request Flow

### Phase 1: Warm-up Request
```http
GET /api/tmdb/movie/550/images
X-Api-Key: <wasm_generated_key>
X-Request-Timestamp: <server_synced_timestamp>
X-Request-Nonce: <22_char_base64_nonce>
X-Request-Signature: <hmac_sha256_signature>
X-Client-Fingerprint: <canvas_based_fingerprint>
bW90aGFmYWth: 1
Accept: text/plain
```

The warm-up request with `bW90aGFmYWth: 1` header is **required**. Without it, the API returns plain TMDB image data instead of the encrypted server list. This header was previously a blocker (sending it would block requests), but hexa.su **flipped the logic** — it's now required on the initial fetch.

### Phase 2: Per-Server Source Fetch
```http
GET /api/tmdb/movie/550/images
X-Api-Key: <wasm_generated_key>
X-Request-Timestamp: <server_synced_timestamp>
X-Request-Nonce: <22_char_base64_nonce>
X-Request-Signature: <hmac_sha256_signature>
X-Client-Fingerprint: <canvas_based_fingerprint>
X-Only-Sources: 1
X-Server: alpha
Accept: text/plain
```

Do **NOT** send `bW90aGFmYWth` on per-server fetches.
Do **NOT** send `Origin` header.
Do **NOT** send `sec-fetch-*` headers.

## Response Format

Responses are encrypted text. After WASM decryption, the JSON structure varies:

### Shape 1: Sources Array
```json
{
  "sources": [
    { "server": "alpha", "url": "https://cdn.example.com/stream.m3u8", "file": "..." }
  ]
}
```

### Shape 2: Sources Object
```json
{
  "sources": { "file": "https://cdn.example.com/stream.m3u8", "url": "..." }
}
```

### Shape 3: Servers Map
```json
{
  "servers": {
    "alpha": { "url": "https://cdn.example.com/stream.m3u8" }
  }
}
```

### Shape 4: Top-level
```json
{
  "file": "https://cdn.example.com/stream.m3u8",
  "url": "...",
  "stream": "..."
}
```

The extraction code must handle all four shapes — the API rotates between them.

## Headers That Block Requests

| Header | Effect |
|--------|--------|
| `bW90aGFmYWth` | **Required** on warm-up, **blocks** on per-server fetch |
| `Origin` | Blocks when present |
| `sec-fetch-site` | Blocks when present |
| `sec-fetch-mode` | Blocks when present |
| `sec-fetch-dest` | Blocks when present |
