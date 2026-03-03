# Proxy Architecture

## Overview

The extraction pipeline has three deployment targets, all sharing the same core logic:

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Next.js App │────▶│  CF Worker Proxy  │────▶│  hexa.su API    │
│  (Frontend)  │     │  (WASM + Auth)    │     │  (Encrypted)    │
└─────────────┘     └──────────────────┘     └─────────────────┘
                           │                         │
                           ▼                         ▼
                    ┌──────────────┐          ┌──────────────┐
                    │  RPI Proxy   │          │  CDN Servers  │
                    │  (Fallback)  │          │  (HLS m3u8)   │
                    └──────────────┘          └──────────────┘
```

## Component 1: Cloudflare Worker (`cloudflare-proxy/src/flixer-proxy.ts`)

Primary extraction endpoint. Runs on `media-proxy.vynx.workers.dev`.

**Routes:**
| Route | Purpose |
|-------|---------|
| `GET /flixer/extract` | Single server extraction |
| `GET /flixer/extract-all` | Parallel 26-server extraction |
| `GET /flixer/health` | Health check + diagnostics |
| `GET /flixer/debug` | Raw decrypted data inspection |
| `GET /flixer/stream` | HLS playlist/segment proxy |

**Key features:**
- WASM bundled at build time (wrangler `import` syntax)
- Cached WASM instance reused across requests (30-min TTL)
- Warm-up request deduplication (30s TTL)
- WASM init lock prevents parallel initialization
- Auto-reset after 5 consecutive failures
- Direct fetch to hexa.su (no RPI needed for API calls)

**Stream proxy strategy:**
1. Try direct CF Worker fetch to CDN
2. Fallback to RPI residential proxy
3. Rewrite m3u8 playlist URLs to route through `/flixer/stream`

## Component 2: Docker Proxy (`docker/proxy/routes/flixer.ts`)

Alternative for local/self-hosted deployment. Runs on Node.js/Bun.

**Differences from CF Worker:**
- WASM loaded from disk (`readFileSync`)
- Uses Node.js `crypto.createHmac()` instead of `crypto.subtle`
- No RPI proxy integration (direct fetch only)
- Single-server extraction only (no `/extract-all`)

## Component 3: Next.js Frontend (`app/lib/services/flixer-extractor.ts`)

Client-side orchestration layer. Does NOT run WASM directly.

**Flow:**
1. Calls `getFlixerExtractAllUrl()` to build the CF Worker URL
2. Uses `cfFetch()` to make the request (handles CF Pages → CF Worker routing)
3. Receives pre-extracted sources from the CF Worker
4. Fetches subtitles in parallel from `sub.wyzie.ru`

**CF Pages routing issue:**
On Cloudflare Pages, direct `fetch()` to a same-account CF Worker returns 404. The `cfFetch()` utility routes through the RPI proxy to work around this.

## Component 4: RPI Residential Proxy (`rpi-proxy/`)

Raspberry Pi running on a residential IP. Used as fallback when CF Worker IPs are blocked.

**Used for:**
- CDN segment delivery when direct CF fetch fails
- CF Pages → CF Worker routing workaround

**Not used for:**
- hexa.su API calls (direct fetch works from CF Workers)

## Request Flow: Extract-All

```
1. Frontend calls: GET /flixer/extract-all?tmdbId=550&type=movie
2. CF Worker receives request
3. Initialize WASM (if not cached)
   a. Sync server time
   b. Instantiate WASM with browser mocks
   c. Generate API key via get_img_key()
4. Warm-up request to hexa.su (deduplicated)
   a. GET /api/tmdb/movie/550/images with bW90aGFmYWth:1
5. Race 26 servers in parallel
   a. For each server: GET /api/tmdb/movie/550/images with X-Server:<name>
   b. Decrypt response via processImgData()
   c. Extract URL from decrypted JSON
6. Promise.any() resolves on first success
7. Wait 1.5s grace period for more sources
8. Return JSON with all collected sources
```

## Codebase Issues Found During Validation (All Fixed ✅)

1. ~~**Wrong domain**: Multiple files referenced `flixer.cc`~~ → Fixed to `flixer.su`
2. ~~**Wrong server name**: `india: "Iris"`~~ → Fixed to `india: "Isis"`
3. ~~**Legacy domain in allowlist**: `flixer.sh` only~~ → Added `flixer.su`
4. ~~**Old API base in docker**: `plsdontscrapemelove.flixer.sh`~~ → Fixed to `themoviedb.hexa.su`

## Environment Variables

| Variable | Used By | Purpose |
|----------|---------|---------|
| `NEXT_PUBLIC_CF_STREAM_PROXY_URL` | Frontend | CF Worker base URL |
| `CF_STREAM_PROXY_URL` | Frontend (SSR) | CF Worker base URL |
| `RPI_PROXY_URL` | CF Worker | RPI proxy base URL |
| `RPI_PROXY_KEY` | CF Worker | RPI proxy auth key |
| `LOG_LEVEL` | CF Worker | Logging verbosity |
