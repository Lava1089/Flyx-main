# Nepoflix (nepoflix.site) — Security & Anti-Scraping Research

**Status:** 🔍 Not Integrated  
**Extractor:** None yet  
**Last Updated:** 2026-03-19

---

## Overview

Nepoflix.site is a streaming site. Initial fetch returned no readable content, suggesting the site is either fully JavaScript-rendered (SPA) or has active bot protection that serves a blank/challenge page to non-browser clients.

## Observed Anti-Scraping Measures

### 1. JavaScript-Only Rendering
- Server-side fetch returns no readable HTML content
- The site is likely a React/Vue/Angular SPA that renders entirely client-side
- No static HTML content available for scraping

### 2. Possible Cloudflare/Bot Protection
- The empty response could indicate a Cloudflare JS challenge page
- May require solving a challenge before accessing actual content
- Need to verify with a real browser

### 3. .site TLD
- Uses `.site` TLD which is common for newer/less established streaming sites
- These domains tend to be more ephemeral and may change frequently

## Research TODO

- [ ] Access via real browser and capture the full page load sequence
- [ ] Check if Cloudflare is in front (look for cf-ray headers, __cf_bm cookies)
- [ ] Identify the frontend framework (React, Vue, Next.js, etc.)
- [ ] Map out the API endpoints called during page load
- [ ] Check if it uses TMDB/IMDB IDs for content lookup
- [ ] Identify the embed/player infrastructure
- [ ] Document any authentication flow (tokens, cookies, etc.)
- [ ] Check for WebSocket connections (some sites use WS for stream data)
- [ ] Test with different User-Agent strings to see if that changes the response
- [ ] Check if the site is actually online and functional

## Potential Bypass Strategies

1. **API-first approach** — If it's a SPA, find the underlying API and call it directly
2. **Browser-direct pattern** — Have the user's browser make requests
3. **Headless browser** — Puppeteer/Playwright to render the JS and extract data
4. **Reverse-engineer the frontend** — Inspect the JS bundle for API endpoints and auth logic

## Risk Assessment

- `.site` domains are cheap and disposable — high risk of domain changes
- Empty server-side response suggests active protection or instability
- May not be worth heavy investment until stability is confirmed

## Notes

- Verify the site is actually functional before investing in an extractor
- If it's a clone/fork of another streaming site, the same extraction logic may apply
- Check if it shares infrastructure with any known streaming sites
