# Anti-Bot Defenses

## Defense Layers

### 1. Dual-Domain Strategy

The infrastructure runs on two parallel frontend domains (`flixer.su` and `hexa.su`) with two parallel TMDB API backends (`plsdontscrapemelove.flixer.su` and `themoviedb.hexa.su`). If one gets blocked or rate-limited, the other remains available.

The original domain `flixer.sh` is now NXDOMAIN. All codebase references have been corrected to use `flixer.su`.

**Bypass**: Use either TMDB backend — both serve identical APIs.

### 2. WASM-Based Key Generation

The API key is generated inside a Rust-compiled WASM module that:
- Reads browser environment data (screen, navigator, canvas, localStorage)
- Generates a canvas fingerprint via `fillText()` + `toDataURL()`
- Derives a session-specific key from the collected fingerprint data
- The key generation logic is obfuscated inside compiled WASM bytecode

**Bypass**: Mock the browser environment with consistent values. The WASM module doesn't validate that it's running in a real browser — it just reads the values from the import bindings.

### 3. Client-Side Rate Limiting

The `tmdb-image-enhancer.js` client module enforces a 50-call limit per session on `process_img_data()`:
- Call count tracked in `localStorage` key `cc`
- Last call time tracked in `localStorage` key `lc`
- 200ms minimum delay enforced between calls
- After 50 calls: throws error, requires page refresh to reset
- `clearImageEnhancementSession()` / `window.clearImageEnhancementSession()` resets the counter

**Bypass**: Our server-side implementation doesn't use this client module — we call the WASM directly without the rate limiter wrapper.

### 4. HMAC-SHA256 Request Signing

Every request must include:
- Server-synced timestamp (±few seconds tolerance)
- Unique nonce per request
- HMAC-SHA256 signature over `key:timestamp:nonce:path`
- Client fingerprint hash

Replay attacks are prevented by the nonce. Clock skew attacks are prevented by server time sync.

### 5. Header Trap: `bW90aGFmYWth`

This header (`bW90aGFmYWth` = base64 of "mothafaka") is a trap/toggle:
- **Warm-up request**: MUST be present with value `"1"` — triggers the server to prepare encrypted stream data
- **Per-server fetch**: Must NOT be present — sending it blocks the request

This is a deliberate anti-bot measure: naive scrapers that copy all headers from the warm-up request will fail on the actual extraction.

### 6. Forbidden Headers

Sending any of these headers will block the request:
- `Origin`
- `sec-fetch-site`
- `sec-fetch-mode`
- `sec-fetch-dest`

These are headers that browsers automatically add but that reveal the request is cross-origin. The API expects them to be absent (as if the request comes from the same origin or a non-browser client that knows to omit them).

### 7. Warm-Up Requirement

A "warm-up" request (without `X-Server` or `X-Only-Sources`) must be made before per-server extraction requests. Without the warm-up, per-server requests may return empty or invalid data.

The warm-up appears to initialize server-side session state tied to the API key.

### 8. Canvas Fingerprinting

The WASM module creates a canvas element, renders text with specific fonts, and reads the `toDataURL()` output. This fingerprint is incorporated into the API key derivation.

For server-side mocking, a deterministic data URL is sufficient:
```
data:image/png;base64,<base64("canvas-fp-1920x1080-24-Win32-en-US")>
```

### 9. CDN IP Restrictions

The HLS CDN subdomains (frostcomet, thunderleaf, skyember) may block requests from Cloudflare Worker IPs (same-network detection). This requires:
- Direct fetch attempt first (some CDN subdomains allow it)
- Fallback to RPI residential proxy for segment delivery

### 10. Rate Limiting

Cloudflare-level rate limiting is in place (error code 1015). The extraction pipeline handles this by:
- Deduplicating warm-up requests across concurrent extractions
- Caching WASM state across requests
- Using a 30-minute WASM refresh cycle instead of per-request initialization

### 11. Decoy API Responses

Calling `/api/tmdb/movie/<id>/images` **without** the `bW90aGFmYWth` header and WASM auth returns legitimate TMDB image data (backdrops, posters, etc.). This makes the endpoint look like a normal TMDB proxy to casual inspection. Only with proper auth does it return encrypted stream data.

**Bypass**: Always include proper WASM auth headers.

## Summary of Bypasses

| Defense | Bypass |
|---------|--------|
| Dual-domain strategy | Use either backend |
| WASM keygen | Mock browser environment |
| Client-side rate limit | Call WASM directly, skip wrapper |
| HMAC signing | Implement the signing protocol |
| Header trap | Conditional header inclusion |
| Forbidden headers | Don't send Origin/sec-fetch-* |
| Warm-up requirement | Always warm up before extraction |
| Canvas fingerprint | Deterministic mock canvas |
| CDN IP blocks | RPI residential proxy fallback |
| Rate limiting | Request deduplication + caching |
| Decoy responses | Always send proper auth |
