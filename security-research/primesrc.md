# PrimeSrc (primesrc.me) — Security & Anti-Scraping Research

**Status:** ✅ Integrated — DEFAULT PROVIDER (pure CF Worker, no RPI)  
**Extractor:** `primesrc-proxy.ts` (CF Worker) + `primesrc-extractor.ts` (client)  
**Last Updated:** 2026-03-21

---

## Overview

PrimeSrc.me is a streaming embed API provider that aggregates 14+ file hosting servers. It uses TMDB IDs (also supports IMDB and TVMaze). The backend is an Elixir/Phoenix app behind Cloudflare. The frontend is a React SPA using playerjs for iframe communication.

Operated by "1337 Services LLC" (Charlestown, KN). Domain created 2025-09-05.

## Architecture

```
Browser → /embed/movie?tmdb=550
  → Inline JS calls /api/v1/s?type=movie&tmdb=550  (server list, NO AUTH)
  → User picks server → Turnstile challenge renders
  → Turnstile token obtained → /api/v1/l?key={key}&token={token}  (CF Turnstile-gated)
  → Response: {link: "https://embed-provider.com/embed/..."}
  → Link loaded in iframe via playerjs
```

## Our Extraction Chain (Browser Turnstile + CF Worker)

```
Browser:
  1. Renders invisible Turnstile widget (sitekey 0x4AAAAAACox-LngVREu55Y4)
  2. Obtains token automatically (interaction-only appearance)
  3. Passes token to CF Worker

CF Worker /primesrc/extract?tmdbId=550&type=movie&token={turnstileToken}
  ├── /api/v1/s → server list with keys (NO AUTH, ~300ms)
  └── For EACH server (parallel, batches of 6):
      ├── /api/v1/l?key={key}&token={turnstileToken} → {link: "https://embed.com/..."}
      └── Fetch embed page → extract m3u8/mp4 URL
          ├── Filemoon: packed JS → m3u8
          ├── Streamtape: robotlink + token → mp4
          ├── Voe: hls/mp4 in source
          ├── Mixdrop: MDCore.wurl → mp4
          ├── Dood: /pass_md5/ → mp4
          └── Generic: find m3u8/mp4 in page
```

Total extraction time: ~2-5s (parallel resolution of all servers)

## API Endpoints

### GET /api/v1/s — Server List (NO AUTH REQUIRED)

Returns available servers/sources for a given title. Works with plain server-side fetch.

**Movie:**
```
GET /api/v1/s?type=movie&tmdb={tmdbId}
GET /api/v1/s?type=movie&imdb={imdbId}
```

**TV:**
```
GET /api/v1/s?type=tv&tmdb={tmdbId}&season={N}&episode={N}
```

**Response:**
```json
{
  "servers": [
    {
      "name": "PrimeVid",
      "key": "8l7ry",
      "quality": "1080p",
      "file_size": null,
      "file_name": "Fight.Club.1999.REMASTERED.1080p.BluRay.DDP5.1.x265.10bit-GalaxyRG265.mkv"
    }
  ]
}
```

### GET /api/v1/l — Link Resolution (TURNSTILE REQUIRED — NOT USED)

Protected by Cloudflare managed challenge. Returns 403 without valid Turnstile token.
We bypass this entirely by extracting PrimeVid streams directly from cloudnestra.

**Turnstile sitekey:** `0x4AAAAAACox-LngVREu55Y4`

## PrimeVid Extraction (cloudnestra chain)

PrimeVid is the primary server and maps to `vidsrcme.ru`. The extraction chain:

1. `vidsrcme.ru/embed/movie/{tmdbId}` → HTML page with iframe to cloudnestra
2. `cloudnestra.com/rcp/{base64_token}` → HTML page with prorcp path + play button
3. `cloudnestra.com/prorcp/{base64_token2}` → Full Playerjs page with m3u8 URLs

The prorcp page contains:
- Playerjs initialization with `file:` property containing m3u8 URLs
- URLs use template variables `{v1}` through `{v5}` for CDN domain rotation
- Multiple quality variants (1080p, 720p) as " or " separated alternatives
- Audio track via `app2.{v5}/cdnstr/{hash}/list.m3u8`

### CDN Domain Mapping

Template variables `{v1}`-`{v5}` resolve to rotating CDN domains:
- `neonhorizonworkshops.com`
- `wanderlynest.com`
- `orchidpixelgardens.com`
- `cloudnestra.com`
- `cloudnestra.net`
- `shadowlandschronicles.com`

URL pattern: `https://tmstr2.{domain}/pl/{gzip_hash}/master.m3u8`

### Rate Limiting

cloudnestra.com has bot detection that triggers after several requests:
- Normal RCP page: 7176 bytes (includes prorcp token)
- Rate-limited RCP page: 2618 bytes (no prorcp token, stripped page)
- Recovery: Wait ~5-10 minutes or use different IP

## Available Servers

| Server | Extractable | Notes |
|--------|-------------|-------|
| PrimeVid | ✅ Yes | Via Turnstile token + embed extraction |
| Streamtape | ✅ Yes | Via Turnstile token + embed extraction |
| Voe | ✅ Yes | Via Turnstile token + embed extraction |
| Filemoon | ✅ Yes | Via Turnstile token + embed extraction |
| Streamwish | ✅ Yes | Via Turnstile token + embed extraction |
| Dood | ✅ Yes | Via Turnstile token + embed extraction |
| Mixdrop | ✅ Yes | Via Turnstile token + embed extraction |
| Filelions | ✅ Yes | Via Turnstile token + embed extraction |
| Luluvdoo | ✅ Yes | Via Turnstile token + embed extraction |
| Vidmoly | ✅ Yes | Via Turnstile token + embed extraction |
| VidNest | ✅ Yes | Via Turnstile token + embed extraction |
| Streamplay | ✅ Yes | TV only, via Turnstile token |
| UpZur | ✅ Yes | TV only, via Turnstile token |
| Up4Fun | ✅ Yes | TV only, via Turnstile token |

## CF Worker Endpoints

```
GET /primesrc/extract?tmdbId={id}&type={movie|tv}[&season=N&episode=N][&token={turnstileToken}]
  → Full extraction: server list + resolve all servers + extract streams
  → Without token: returns server list metadata only
  → With token: resolves ALL servers and extracts playable streams

GET /primesrc/resolve?key={serverKey}&token={turnstileToken}&server={name}
  → Resolve a single server's embed link via /api/v1/l

GET /primesrc/embed?url={embedUrl}&server={name}
  → Extract stream URL from an embed page

GET /primesrc/servers?tmdbId={id}&type={movie|tv}[&season=N&episode=N]
  → Server list only (fast, no extraction)

GET /primesrc/stream?url={encoded_url}[&referer={referer}]
  → Proxy m3u8/segments with correct referer

GET /primesrc/health
  → Health check
```

## Anti-Scraping Measures

### 1. Cloudflare Turnstile on /api/v1/l (Primary Blocker)
- CF managed challenge (interactive, not JS-auto-solve)
- Returns `cf-mitigated: challenge` header with 403 status
- WAF-level rule — cannot be bypassed with headers or cookies
- **Bypassed by**: Not using /api/v1/l at all — extracting PrimeVid directly

### 2. cloudnestra Bot Detection
- Rate limits after several requests from same IP
- Returns stripped page (2618b) without prorcp token
- **Mitigation**: Use RPI proxy fallback, or space requests

### 3. CDN Domain Rotation
- m3u8 URLs use template variables `{v1}`-`{v5}`
- Actual domains rotate periodically
- **Mitigation**: Try all known CDN domains until one works

### 4. No Protection on Server List
- `/api/v1/s` works with plain fetch — no auth, no cookies, no challenge
- No rate limiting observed

## Tech Stack

- **Backend:** Elixir/Phoenix
- **Frontend:** React SPA using playerjs
- **CDN:** Cloudflare
- **Player:** cloudnestra.com Playerjs (prorcp pages)
- **Embed source:** vidsrcme.ru (for PrimeVid)

## What to Check When It Breaks

- [ ] Does `/api/v1/s` still return JSON without auth?
- [ ] Does vidsrcme.ru still return cloudnestra iframe?
- [ ] Does cloudnestra still have `/prorcp/` endpoint?
- [ ] Have CDN domains rotated? Check prorcp page for new domains
- [ ] Is cloudnestra rate-limiting? Check if RCP page is 7176b or 2618b
- [ ] Has the Turnstile sitekey changed from `0x4AAAAAACox-LngVREu55Y4`?
