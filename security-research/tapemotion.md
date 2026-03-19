# Tapemotion (tapemotion.com) — Security & Anti-Scraping Research

**Status:** 🔍 Not Integrated  
**Extractor:** None yet  
**Last Updated:** 2026-03-19

---

## Overview

Tapemotion.com is a movie streaming platform. The site returns HTTP 403 on server-side fetches, indicating Cloudflare or similar CDN-level bot protection is active. The site is flagged by multiple security scanners (Gridinsoft, Scam Detector) as low-trust.

## Observed Anti-Scraping Measures

### 1. Cloudflare Protection (Confirmed)
- Server-side fetch returns **HTTP 403 Forbidden**
- Likely using Cloudflare's Bot Management or Under Attack Mode
- May include Turnstile CAPTCHA challenges for suspicious requests
- TLS fingerprinting likely active (blocks non-browser TLS stacks)

### 2. JavaScript-Rendered Content
- The site appears to be a SPA (Single Page Application)
- Content is loaded dynamically via JavaScript
- Server-side scraping will get an empty shell or challenge page

### 3. Unknown Embed Structure
- Need to investigate: Does it use TMDB IDs? IMDB IDs? Internal IDs?
- Need to identify: What embed providers does it use for actual streams?
- Need to check: Does it have its own player or use third-party embeds?

## Research TODO

- [ ] Access the site via a real browser and inspect network requests
- [ ] Identify the embed/player infrastructure (own player vs third-party)
- [ ] Check if it uses TMDB/IMDB IDs in URL patterns
- [ ] Document the API endpoints used for fetching stream data
- [ ] Identify what CDN serves the actual video streams
- [ ] Check for any API keys, tokens, or auth headers in requests
- [ ] Determine if Cloudflare Turnstile is used and on which endpoints
- [ ] Check if residential IP is required or if datacenter IPs work with proper headers

## Potential Bypass Strategies

1. **Browser-direct pattern** (like Flixer) — User's browser makes requests directly
2. **Residential proxy** — Route through RPI proxy to bypass IP blocks
3. **Headless browser** — Use Puppeteer/Playwright to solve Cloudflare challenges
4. **Cloudflare bypass headers** — Spoof cf-clearance cookie + proper TLS fingerprint

## Notes

- Low trust scores from security scanners suggest the site may be unstable or short-lived
- Domain could change frequently — monitor for domain migrations
- Consider whether integration is worth the effort given reliability concerns
