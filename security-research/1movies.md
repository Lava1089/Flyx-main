# 1movies (111movies.com / 1movies.bz) — Security & Anti-Scraping Research

**Status:** ❌ Disabled (ONEMOVIES_ENABLED = false)  
**Extractor:** `app/lib/services/onemovies-extractor.ts`  
**Last Updated:** 2026-03-19

---

## Overview

1movies uses a heavily obfuscated multi-layer encryption scheme. The extractor was disabled because the API hash extraction became too complex — it requires runtime JavaScript evaluation that isn't feasible server-side.

## Anti-Scraping Measures

### 1. Dynamic API Hash (Primary Blocker)
- The API requires a hash that's built from an obfuscated JS string array
- The string array uses a rotation cipher (rotation value: 82 as of last check)
- Hash format changed from old format to new obfuscated format:
  - **Old:** `h/APA91.../UUID/SHA1/wiv/NUMBER/SHA256/ar`
  - **New:** Mixed hash parts with obfuscated variable names from rotated string array
- Hash is embedded in JS bundles and changes with each deployment
- **This is why the extractor is disabled** — can't extract hash without JS eval

### 2. AES-256-CBC Encryption
- API responses are encrypted with AES-256-CBC
- Known keys (from `860-458a7ce1ee2061c2.js`):
  ```
  AES Key: [138,238,17,197,68,75,124,44,53,79,11,131,216,176,124,80,
            161,126,163,21,238,68,192,209,135,253,84,163,18,158,148,102]
  AES IV:  [181,63,33,220,121,92,190,223,94,49,56,160,53,233,201,230]
  ```
- **These keys may change with JS bundle updates**

### 3. XOR Post-Processing
- After AES decryption, output is XOR'd with a 5-byte key
- XOR Key: `[215,136,144,55,198]`
- Result is then UTF-8 encoded and Base64url encoded

### 4. Character Substitution Cipher
- Final layer: character-by-character substitution
- Maps standard Base64url chars to a shuffled alphabet:
  ```
  Input:  abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_
  Output: Ms8P1hR9n4qUdVfzgNwkIYBWTJbleyESG623C7OoKQp-DA0cjHX_mZuFivxra5Lt
  ```

### 5. CSRF Token Authentication
- Requests require `x-csrf-token` header
- Token extracted from page HTML or JS bundle
- Fallback token: `WP6BXZEsOAvSP0tk4AhxIWllVsuBx0Iy` (likely expired)

### 6. Rate Limiting
- 300ms minimum delay between requests
- Server returns 429 on excessive requests

## Encryption Pipeline (Decryption Order)

```
API Response (encrypted string)
  → Character substitution (reverse map)
  → Base64url decode
  → UTF-8 decode
  → XOR with [215,136,144,55,198]
  → AES-256-CBC decrypt (known key + IV)
  → Plain JSON response
```

## Current Bypass Strategy

**DISABLED** — The dynamic API hash cannot be extracted without runtime JS evaluation.

The extractor has all the decryption logic implemented but can't make valid API requests because the hash changes with each JS bundle deployment.

## Known Weaknesses / Failure Modes

1. **API hash rotation** — Changes with every JS bundle update, requires JS eval to extract
2. **Encryption key rotation** — AES key, IV, XOR key, and substitution cipher could all change
3. **CSRF token expiry** — Tokens expire, need fresh extraction from page
4. **Domain changes** — Has used 111movies.com, 1movies.bz, and potentially others

## What to Check When It Breaks (or to Re-enable)

- [ ] Can the API hash be extracted from the current JS bundle?
- [ ] Have the AES key/IV changed? (check the chunk JS file)
- [ ] Has the XOR key changed?
- [ ] Has the character substitution mapping changed?
- [ ] Is the CSRF token still valid?
- [ ] Has the domain changed from 111movies.com?

## Re-enabling Strategy

Options to make this work:
1. **Headless browser** — Use Puppeteer to load the page and extract the hash at runtime
2. **JS bundle parser** — Build a parser that can deobfuscate the string array rotation and extract the hash
3. **Proxy through hexawatch** — Use the MOON server in hexawatch (see hexa.md) which handles the hash internally
4. **Browser extension** — Extract hash client-side where JS execution is available
