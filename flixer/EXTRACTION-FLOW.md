# Extraction Flow — Step by Step

Complete walkthrough from TMDB ID to playable HLS stream.

## Input
- TMDB ID: `550` (Fight Club)
- Type: `movie`

## Step 1: WASM Initialization

The live frontend loads WASM dynamically from the TMDB backend:

```
1. Frontend injects <script type="module"> into <head>
2. Script imports from themoviedb.hexa.su/assets/wasm/img_data.js
3. img_data.js calls init({ module_or_path: '.../img_data_bg.wasm' })
4. On success, calls get_img_key() → 64-character key
5. Stores on window.wasmImgData = { init, process_img_data, get_img_key, key, ready: true }
6. Dispatches CustomEvent('wasmReady')
```

Our server-side implementation skips the dynamic loading and instantiates the WASM directly:

```
Load flixer.wasm (= img_data_bg.wasm, Rust-compiled)
├── Create browser environment mocks
│   ├── window.screen = { width: 1920, height: 1080, colorDepth: 24 }
│   ├── window.navigator = { platform: "Win32", language: "en-US", userAgent: "..." }
│   ├── window.localStorage = { getItem("tmdb_session_id") → "<uuid>" }
│   ├── document.createElement("canvas") → mock canvas with toDataURL()
│   └── Date.now() → fixed timestamp, Math.random() → fixed seed
├── Instantiate WASM with mock imports
└── Call get_img_key() → 64-character key (validated: must be exactly 64 chars)
```

## Step 2: Server Time Sync

```
GET https://themoviedb.hexa.su/api/time?t=1740000000000
→ { "time": 1740000005000, "timestamp": 1740000005 }

Note: Response includes both "time" (ms) and "timestamp" (seconds).
Server time is cached for 5 minutes (300,000ms TTL) in the live client.

Calculate offset:
  RTT = localTimeAfter - localTimeBefore  (e.g., 150ms)
  serverTimeMs = 1740000005 * 1000
  offset = serverTimeMs + (150/2) - localTimeAfter
```

## Step 3: Warm-Up Request

```
GET https://themoviedb.hexa.su/api/tmdb/movie/550/images

Headers:
  X-Api-Key: a1b2c3d4e5f6g7h8...
  X-Request-Timestamp: 1740000005
  X-Request-Nonce: abc123def456ghi789jk
  X-Request-Signature: <HMAC-SHA256 of "key:1740000005:nonce:/api/tmdb/movie/550/images">
  X-Client-Fingerprint: 1a2b3c
  bW90aGFmYWth: 1          ← REQUIRED on warm-up
  Accept: text/plain

→ 200 OK (encrypted text, ~2KB)
→ Decrypted: server list with available servers
```

## Step 4: Per-Server Extraction (×26 in parallel on server-side, sequential on client)

The live client iterates servers **sequentially** with a priority order (alpha first, then bravo, charlie, etc.) and stops at the first success. Our server-side implementation races all 26 in parallel.

The client also enforces a 200ms delay between calls and a 50-call session limit.

```
GET https://themoviedb.hexa.su/api/tmdb/movie/550/images

Headers:
  X-Api-Key: a1b2c3d4e5f6g7h8...
  X-Request-Timestamp: 1740000006
  X-Request-Nonce: xyz789abc123def456gh
  X-Request-Signature: <HMAC-SHA256>
  X-Client-Fingerprint: 1a2b3c
  X-Only-Sources: 1          ← Request sources only
  X-Server: alpha            ← Specific server
  Accept: text/plain
                              ← NO bW90aGFmYWth header!
                              ← NO Origin header!

→ 200 OK (encrypted text)
```

## Step 5: WASM Decryption

```
encrypted = "aGVsbG8gd29ybGQ..."  (base64-like encrypted response)
decrypted = await loader.processImgData(encrypted, apiKey)
→ '{"sources":[{"server":"alpha","url":"https://cdn.frostcomet.com/v/abc123/master.m3u8"}]}'
```

## Step 6: URL Extraction

Parse the decrypted JSON, handling multiple response shapes:

```javascript
// Shape 1: sources array
data.sources[0].url || data.sources[0].file

// Shape 2: sources object
data.sources.file || data.sources.url

// Shape 3: servers map
data.servers.alpha.url

// Shape 4: top-level
data.file || data.url || data.stream
```

## Step 7: HLS Playlist Proxy

The extracted URL is an HLS master playlist:
```
https://cdn.frostcomet.com/v/abc123/master.m3u8
```

This CDN may block CF Worker IPs, so it's proxied:

> **Debugging:** Use `GET /flixer/stream-debug?url=<cdn_url>` to test all three strategies against a given URL and compare status codes, latency, and response previews.

```
GET /flixer/stream?url=https%3A%2F%2Fcdn.frostcomet.com%2Fv%2Fabc123%2Fmaster.m3u8

Strategy 1: Direct CF Worker fetch → CDN
  ├── Success → rewrite playlist URLs, return
  └── Fail (403/blocked) → Strategy 2

Strategy 2: RPI /fetch-rust (Chrome TLS fingerprint from residential IP)
  ├── Success → rewrite playlist URLs, return
  └── Fail → Strategy 3

Strategy 3: RPI /flixer/stream legacy (Node.js https)
  ├── Success → rewrite playlist URLs, return
  └── Fail → 502 error
```

## Step 8: Playlist Rewriting

Master playlist URLs are rewritten to route through the proxy:

```m3u8
#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1920x1080
https://media-proxy.vynx.workers.dev/flixer/stream?url=https%3A%2F%2Fcdn.frostcomet.com%2Fv%2Fabc123%2F1080p.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720
https://media-proxy.vynx.workers.dev/flixer/stream?url=https%3A%2F%2Fcdn.frostcomet.com%2Fv%2Fabc123%2F720p.m3u8
```

## Step 9: Segment Delivery

Each `.ts` segment request follows the same proxy chain:
```
Player → /flixer/stream?url=<segment_url> → CF direct or RPI rust-fetch or RPI legacy → CDN → .ts data
```

Segments are cached with `Cache-Control: public, max-age=3600`.

## Output

```json
{
  "success": true,
  "sources": [
    {
      "quality": "auto",
      "title": "Flixer Ares",
      "url": "https://cdn.frostcomet.com/v/abc123/master.m3u8",
      "type": "hls",
      "referer": "https://hexa.su/",
      "requiresSegmentProxy": true,
      "status": "working",
      "language": "en",
      "server": "alpha"
    }
  ],
  "serverCount": 26,
  "successCount": 5,
  "elapsed_ms": 2847
}
```

## Timing Breakdown (typical)

| Phase | Duration |
|-------|----------|
| WASM init (first request) | ~500ms |
| Time sync | ~150ms |
| Warm-up request | ~300ms |
| Per-server extraction (parallel) | ~1000–2000ms |
| First source (Promise.any) | ~800ms |
| Grace period | 1500ms max |
| **Total (cold start)** | **~3–4s** |
| **Total (warm WASM)** | **~2–3s** |
