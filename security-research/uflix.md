# Uflix (uflix.to) — Security & Anti-Scraping Research

**Status:** ✅ Integrated  
**Extractor:** `app/lib/services/uflix-extractor.ts`  
**Last Updated:** 2026-03-19

---

## Overview

Uflix.to is a free movie/TV streaming aggregator. Server-rendered with jQuery + Bootstrap (NOT a SPA). It proxies 5 embed providers through its `/gStream` API. Behind Cloudflare (analytics beacon only — no bot protection on server-side requests). Uses IMDB IDs internally.

Sister sites (same backend, different languages):
| Site | Language | Domain | Status |
|------|----------|--------|--------|
| uFlix | English | uflix.to | ✅ Up |
| uKino | Russian | ukino.to | ✅ Up |
| uTelevision | Spanish | utelevision.to | ✅ Up |
| uCinema | Portuguese | ucinema.so | ✅ Up |

---

## URL Patterns

| Pattern | Example |
|---------|---------|
| Homepage | `https://uflix.to/` |
| Search | `GET /search?keyword={query}` |
| Movie page | `/movie/{slug}` → `/movie/fight-club-1999` |
| Series page | `/serie/{slug}` → `/serie/breaking-bad-2008` |
| Episode page | `/episode/{slug}/{SxxExx}` → `/episode/breaking-bad-2008/S01E01` |
| Movie player iframe | `/mPlayer?movieid={slug}&stream=stream1` |
| TV player iframe | `/sPlayer?serieid={slug}&episodeid={SxxExx}&stream=stream1` |

---

## Critical API: `/gStream`

```
GET /gStream?id={streamId}&movie={streamId}&is_init=false&captcha=
```

**Required headers:**
```
X-Requested-With: XMLHttpRequest
Referer: https://uflix.to/mPlayer?movieid={slug}&stream={streamN}
```

**Response:**
```json
{"success": true, "data": {"link": "https://www.2embed.cc/embed/tt0137523", "token": "..."}}
```

### Stream ID Format

| Type | Format | Example |
|------|--------|---------|
| Movie (IMDB) | `stream{N}\|movie\|imdb:{imdbId}` | `stream1\|movie\|imdb:tt0137523` |
| Movie (TMDB) | `stream5\|movie\|tmdb:{tmdbId}` | `stream5\|movie\|tmdb:550` |
| TV (IMDB) | `stream{N}\|serie\|imdb:{imdbId}\|{SxxExx}` | `stream1\|serie\|imdb:tt0903747\|S01E01` |

### Available Embed Servers (verified working)

| Stream | Provider | Embed URL Pattern |
|--------|----------|-------------------|
| stream1 | 2Embed | `https://www.2embed.cc/embed/{imdbId}` |
| stream2 | SmashyStream | `https://embed.smashystream.com/playere.php?imdb={imdbId}` |
| stream3 | GDrivePlayer | `https://databasegdriveplayer.xyz/player.php?imdb={imdbId}` |
| stream4 | VidSrc.me | `https://vidsrc.me/embed/{imdbId}/` |
| stream5 | VidPlus | `https://player.vidplus.to/embed/movie/{tmdbId}` |

---

## Anti-Scraping Measures

### 1. Cloudflare (Analytics Only)
- CF-Ray header present but NO challenge pages
- No Turnstile, no JS challenge, no CAPTCHA on any endpoint
- Server-side requests work fine with standard User-Agent

### 2. reCAPTCHA (Optional/Inactive)
- Player JS references `grecaptcha` but only triggers if the global is defined
- The `captcha=` parameter in `/gStream` accepts empty string
- **No captcha solving needed** for server-side extraction

### 3. X-Requested-With Header
- `/gStream` requires `X-Requested-With: XMLHttpRequest`
- Without it, the API returns an error or empty response
- Standard AJAX header — trivial to add

### 4. Referer Check
- `/gStream` checks the Referer header
- Must match the player iframe URL pattern
- Easy to spoof: `https://uflix.to/mPlayer?movieid={slug}&stream={streamN}`

### 5. Rate Limiting
- No rate limiting observed during testing
- All 5 streams can be fetched in parallel without issues

---

## Current Bypass Strategy

1. **Search** → `GET /search?keyword={title}` with standard UA
2. **Extract slug** → Parse `href="/movie/{slug}"` from search results
3. **Get IMDB ID** → Fetch player iframe, extract from `imdb:ttXXXXXXX` pattern
4. **Fetch streams** → Call `/gStream` for each stream with XHR header + empty captcha
5. **Return embed URLs** → Downstream players handle the actual embed providers

No proxy needed. No CAPTCHA solving. No encryption/decryption.

---

## Known Weaknesses / Failure Modes

1. **IMDB ID not on movie page** — Must fetch the player iframe to extract it
2. **Slug discovery** — Requires search by title; no direct TMDB→slug mapping
3. **Embed providers may go down** — Individual streams can fail independently
4. **Domain migration** — Site has changed domains before; monitor for changes
5. **Sister sites may diverge** — Currently identical backend, but could change

---

## TMDB → IMDB Mapping

Uflix uses IMDB IDs internally (except stream5 which uses TMDB). Options:
- Extract from player iframe (current approach — works but adds a request)
- Use TMDB API: `GET /movie/{tmdbId}/external_ids` → `imdb_id`
- Cache the mapping to avoid repeated lookups

---

## Player JS

The player JavaScript is at `/style/player/player.min.js?v=1.2`. Key observations:
- Uses jQuery for AJAX calls to `/gStream`
- Checks for `grecaptcha` global before attempting CAPTCHA
- Falls back to empty captcha if not available
- Stream switching via `data-stream` attributes on server buttons

---

## Notes

- One of the easiest sites to integrate — minimal protection
- All 5 embed servers overlap with providers we already support (2embed, vidsrc, vidplus)
- Sister sites could provide multi-language content with the same extraction logic
- The site is very stable — consistent URL patterns and API behavior
