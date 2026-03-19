# Streamversea (streamversea.site) — Security & Anti-Scraping Research

**Status:** 🔍 Not Integrated  
**Extractor:** None yet  
**Last Updated:** 2026-03-19

---

## Overview

Streamversea.site is a movie and TV show streaming site branded as "StreamVerSea — Your Ocean of Entertainment." The homepage is a minimal HTML shell with JavaScript-rendered content. The initial HTML contains only a loading placeholder, confirming it's a SPA.

## Observed Characteristics

### Homepage HTML Structure
```html
<title>StreamVerSea - Movies & TV Shows</title>
<body>
  Your Ocean of Entertainment
  Loading amazing content...
</body>
```
- Minimal HTML shell — all content loaded via JavaScript
- No server-side rendered content available
- Branding suggests a relatively new/custom site

### Anti-Scraping Measures

#### 1. JavaScript-Required Rendering
- Homepage returns only a loading skeleton (220 bytes total)
- All movie/TV data is fetched and rendered client-side
- Server-side scraping gets zero useful content

#### 2. No Visible Cloudflare Challenge
- Unlike tapemotion.com, the page loads (HTTP 200) without a challenge
- However, API endpoints may have separate protection
- The lack of a challenge on the shell page doesn't mean APIs are unprotected

#### 3. .site TLD
- Uses `.site` TLD — common for newer streaming sites
- Higher risk of domain changes/shutdowns

## Research TODO

- [ ] Load in a real browser and inspect all network requests during page load
- [ ] Identify the JavaScript framework (React, Vue, Next.js, Nuxt, etc.)
- [ ] Map the API endpoints:
  - Content listing/search API
  - Movie/TV detail API
  - Stream/embed URL API
- [ ] Check if TMDB or IMDB IDs are used in API calls
- [ ] Document the authentication flow (API keys, tokens, cookies)
- [ ] Identify the video player (custom, video.js, plyr, etc.)
- [ ] Check if streams are served via HLS (.m3u8) or direct MP4
- [ ] Identify the CDN serving video content
- [ ] Test API endpoints directly (may work without browser rendering)
- [ ] Check for rate limiting on API endpoints
- [ ] Look for any encryption/obfuscation on stream URLs

## Potential Integration Approach

Since the site is a SPA with a clean HTML shell:
1. **Best case:** Find the API endpoints and call them directly (skip the frontend entirely)
2. **Medium case:** Browser-direct pattern where user's browser calls the API
3. **Worst case:** Headless browser needed for JS execution

The small HTML payload (220 bytes) suggests the site relies heavily on API calls, which is actually good for scraping — if we can identify and replicate those API calls, we don't need to render any HTML.

## Risk Assessment

- New site with `.site` TLD — moderate risk of instability
- SPA architecture could mean clean API endpoints (easier to scrape)
- Or could mean heavy client-side encryption (harder to scrape)
- Need browser inspection to determine which case applies

## Notes

- The "Loading amazing content..." text suggests content is fetched from an API on page load
- Check the JS bundle for API base URLs, auth tokens, and encryption logic
- If it uses a common embed provider (vidsrc, 2embed, etc.), extraction may already be handled by existing extractors
