# Hexa (hexawatch.cc) — Security & Anti-Scraping Research

**Status:** ⚠️ Disabled (MULTI_EMBED_ENABLED = false)  
**Extractor:** `app/lib/services/multi-embed-extractor.ts`  
**Last Updated:** 2026-03-19

---

## Overview

Hexawatch.cc is a multi-embed aggregator that provides access to 8+ third-party embed servers via iframes. It acts as a meta-provider, routing to other embed services. Currently disabled because most servers require JS execution for m3u8 extraction.

## Server Architecture

### Ad-Free Servers
| Codename | Server | URL Pattern |
|----------|--------|-------------|
| DOG | vidsrc.xyz | `vidsrc.xyz/embed/movie/{id}` |
| CAT | vidfast.pro (embed.su mirror) | `vidfast.pro/movie/{id}` |
| RABBIT | videasy.net | `player.videasy.net/movie/{id}` |
| DOVE | autoembed.cc | `player.autoembed.cc/embed/movie/{id}` |
| GEESE | vidsrc.cc v2 | `vidsrc.cc/v2/embed/movie/{id}` |

### Ads Servers
| Codename | Server | URL Pattern |
|----------|--------|-------------|
| POLARIS | moviesapi.club | `moviesapi.club/movie/{id}` |
| GALAXY | vidplus.to | `player.vidplus.to/embed/movie/{id}` |
| MOON | 111movies.com | `111movies.com/?tmdb={id}` |

### Recommendation
| Codename | Server | URL Pattern |
|----------|--------|-------------|
| FAST | vidlink.pro | Handled by separate `vidlink-extractor.ts` |

## Anti-Scraping Measures

### 1. JavaScript-Required Extraction
- Most embed servers render streams via JS (not in static HTML)
- Direct HTML scraping only works for servers that expose m3u8 URLs in page source
- This is the primary reason the extractor is disabled

### 2. Per-Server Protections
Each embedded server has its own anti-scraping:
- **vidsrc.xyz** → Redirects to vsembed.ru, may have Cloudflare protection
- **vidfast.pro** → embed.su mirror, may require specific headers
- **videasy.net** → Uses encrypted player config
- **autoembed.cc** → Standard embed, relatively open
- **vidsrc.cc** → Cloudflare Turnstile on some endpoints
- **moviesapi.club** → vidora.stream embeds, ads-heavy
- **vidplus.to** → Standard embed player
- **111movies.com** → Complex AES encryption (see 1movies.md)

### 3. Referer Validation
- All servers expect `Referer: https://hexawatch.cc/`
- Some servers also validate Origin header

### 4. Iframe Nesting
- Hexawatch embeds servers in iframes
- Some servers have nested iframes (2-3 levels deep)
- Each level may have different domain/referer requirements

## Current Bypass Strategy

```
Server-side fetch → embed page HTML → regex extract m3u8 URL
If no m3u8 in HTML → follow iframe src → extract from iframe HTML
```

- Parallel requests to all 8 servers
- HTML regex patterns for m3u8 extraction (3 patterns)
- Iframe following for nested embeds
- 10s timeout per server, 8s for iframe follows

## Known Weaknesses / Failure Modes

1. **JS-only streams** — Most servers don't expose m3u8 in static HTML. Would need headless browser or reverse-engineering each server's JS.
2. **Server rotation** — Hexawatch frequently adds/removes/renames servers.
3. **Domain changes** — Embed domains change often (vidsrc.xyz → vsembed.ru, etc.)
4. **Individual server blocks** — Each server can independently add protection.

## What to Check When It Breaks

- [ ] Has hexawatch.cc changed its server list? (check their JS bundle)
- [ ] Have any embed domains changed?
- [ ] Are any servers now requiring JS execution that previously didn't?
- [ ] Has the iframe nesting structure changed?
- [ ] Are referer requirements still the same?

## Re-enabling Strategy

To make this work reliably, would need one of:
1. Headless browser (Puppeteer/Playwright) for JS execution
2. Reverse-engineer each server's JS to extract stream URLs server-side
3. Use a browser extension approach where extraction happens client-side
