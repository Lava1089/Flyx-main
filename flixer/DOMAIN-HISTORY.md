# Domain Migration History

## Timeline

| Date | Domain | Status | Notes |
|------|--------|--------|-------|
| Pre-2026 | `flixer.sh` | NXDOMAIN | Original domain, confirmed dead |
| ~Feb 2026 | `flixer.su` | **Active** | New frontend domain, uses `api.flixer.su` + `plsdontscrapemelove.flixer.su` |
| ~Feb 2026 | `hexa.su` | **Active** | Separate frontend, uses `api.hexa.su` + `themoviedb.hexa.su` |

**Note**: All codebase references have been corrected to use `flixer.su`.

## Validated Live Domains (March 2026)

| Domain | Type | Status |
|--------|------|--------|
| `flixer.su` | Frontend (SPA) | ✅ Live — title "FLIXER - Your Premium Streaming Platform" |
| `api.flixer.su` | User API (auth, progress, etc.) | ✅ Live — referenced in flixer.su JS bundle |
| `plsdontscrapemelove.flixer.su` | TMDB/Stream API backend | ✅ Live — returns JSON from `/api/time`, serves WASM + client modules |
| `hexa.su` | Frontend (SPA) | ✅ Live — title "Hexa Watch - Stream Movies & TV Shows" |
| `api.hexa.su` | User API (auth, progress, watch parties, websocket) | ✅ Live — referenced in hexa.su JS bundle |
| `themoviedb.hexa.su` | TMDB/Stream API backend | ✅ Live — returns JSON from `/api/time`, serves WASM + client modules |
| `flixer.sh` | Original domain | ❌ NXDOMAIN — confirmed dead |

## Key Observations

- `flixer.su` and `hexa.su` are **two separate frontends** backed by the **same infrastructure**.
- Both frontends load client-side JS modules from their respective TMDB API backends:
  - flixer.su → `plsdontscrapemelove.flixer.su/assets/client/`
  - hexa.su → `themoviedb.hexa.su/assets/client/`
- Both TMDB backends serve identical WASM modules and client JS (same `tmdb-image-enhancer.js`, `tmdb-poster-utils.js`, `img_data.js`, `img_data_bg.wasm`).
- The API subdomain naming is deliberately obfuscated:
  - `plsdontscrapemelove` = "please don't scrape me love" (anti-scraping humor)
  - `themoviedb` = mimics TMDB's domain to look legitimate
- Both TMDB backends respond to `/api/time` with `{"time":<ms>,"timestamp":<seconds>}`.
- Calling `/api/tmdb/movie/550/images` **without auth headers** returns real TMDB image data (backdrops, posters). With proper WASM auth + `bW90aGFmYWth` header, it returns encrypted stream data.

## Architecture: Two Frontends, One Backend

```
flixer.su (frontend)                    hexa.su (frontend)
    │                                       │
    ├── api.flixer.su (user API)            ├── api.hexa.su (user API + websocket)
    │   └── /api/progress                   │   └── /api/progress, /api/discord/webhook
    │                                       │       /api/watch-party/public
    │                                       │
    └── plsdontscrapemelove.flixer.su       └── themoviedb.hexa.su
        ├── /api/time                           ├── /api/time
        ├── /api/tmdb/movie/<id>/images         ├── /api/tmdb/movie/<id>/images
        ├── /api/tmdb/tv/<id>/season/...        ├── /api/tmdb/tv/<id>/season/...
        ├── /assets/client/*.js                 ├── /assets/client/*.js
        └── /assets/wasm/img_data*.{js,wasm}    └── /assets/wasm/img_data*.{js,wasm}
```

## Frontend Differences

| Feature | flixer.su | hexa.su |
|---------|-----------|---------|
| Bundle size | ~505 KB | ~1.78 MB |
| PWA | Yes (manifest.webmanifest) | Yes (manifest.webmanifest + registerSW.js) |
| Analytics | Monetag ads, stats.menochi.su (commented out) | stats.menochi.su (commented out) |
| Watch parties | Not visible in bundle | Yes (websocket via api.hexa.su) |
| Discord webhook | Not visible in bundle | Yes (/api/discord/webhook) |
| Theme color | #E50914 (Netflix red) | Default |
| WASM loading | Via `plsdontscrapemelove.flixer.su` | Via `themoviedb.hexa.su` |

## DNS / Infrastructure

- All domains sit behind Cloudflare (CF error codes observed: 1016 DNS, 1015 rate limit).
- The CDN subdomains for actual stream delivery are separate from the API domain (e.g., `*.frostcomet.com`, `*.thunderleaf.com`, `*.skyember.com`).
- CDN subdomains use Cloudflare Workers (`p.XXXXX.workers.dev` pattern observed).
- Both `stats.menochi.su` analytics scripts are currently commented out in production HTML.
