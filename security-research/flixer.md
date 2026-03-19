# Flixer (hexa.su) — Security & Anti-Scraping Research

**Status:** ✅ Working  
**Extractor:** `app/lib/services/flixer-extractor.ts`  
**Last Updated:** 2026-03-19

---

## Overview

Flixer is the PRIMARY streaming provider. It uses hexa.su as its API backend. The extraction follows a "browser-direct" pattern where the user's browser calls hexa.su directly (so hexa sees a residential IP, not a datacenter IP), while a Cloudflare Worker handles signing and decryption.

## Anti-Scraping Measures

### 1. WASM-Based Authentication
- Auth headers are generated via a WASM module running on the CF Worker
- The CF Worker endpoint `/flixer/sign` produces HMAC-signed headers
- Without valid signed headers, the API returns 403

### 2. Encrypted API Responses
- hexa.su returns encrypted payloads
- Decryption is handled by the CF Worker at `/flixer/decrypt`
- The WASM module contains the decryption keys/logic

### 3. Cap.js Proof-of-Work (PoW)
- hexa.su uses Cap.js (cap.hexa.su) for bot protection
- Requires solving SHA-256 proof-of-work challenges
- 80 challenges must be solved; uses parallel Web Workers for speed (~2-4s on 8 cores)
- Token is cached in sessionStorage with 2.5hr TTL
- PoW solver: `app/lib/services/hexa-cap-solver.ts`
- Uses FNV-1a PRNG matching @cap.js/server exactly

### 4. IP-Based Restrictions
- Datacenter IPs are blocked — requests must come from residential IPs
- Browser-direct pattern ensures the user's real IP hits hexa.su
- CF Worker only handles crypto operations, not the actual API call

### 5. Referer/Origin Validation
- API expects `Referer: https://hexa.su/`
- Standard browser headers required (User-Agent, Accept, etc.)

## Current Bypass Strategy

```
Browser → CF Worker /flixer/sign → get HMAC-signed headers
Browser → hexa.su API directly (user's residential IP) → encrypted response
Browser → CF Worker /flixer/decrypt → decrypted stream URLs
```

- WASM keygen + HMAC signing on CF Worker
- Browser makes the actual API call (residential IP)
- CF Worker decrypts the response

## Server Mapping

Flixer uses NATO phonetic alphabet codenames for servers:
- alpha → Ares, bravo → Balder, charlie → Circe, delta → Dionysus
- echo → Eros, foxtrot → Freya, golf → Gaia, hotel → Hades
- (full list in extractor source)

## Known Weaknesses / Failure Modes

1. **WASM module changes** — If hexa.su updates their WASM, the CF Worker's signing/decryption breaks. Need to re-extract the WASM.
2. **Cap.js difficulty increase** — If they increase PoW difficulty (more challenges or harder target prefix), solve time increases.
3. **Domain changes** — hexa.su could migrate domains.
4. **Rate limiting** — No explicit rate limiting observed, but aggressive scraping could trigger blocks.

## Subtitles

- Fetched from `https://sub.wyzie.ru/search?id={tmdbId}`
- Separate from the main API, no special auth needed

## What to Check When It Breaks

- [ ] Is the CF Worker `/flixer/sign` endpoint returning valid headers?
- [ ] Has the WASM module been updated? (check hexa.su JS bundle)
- [ ] Is Cap.js PoW still solvable? (check challenge count/difficulty)
- [ ] Has the API URL structure changed?
- [ ] Are the server codenames still the same?
