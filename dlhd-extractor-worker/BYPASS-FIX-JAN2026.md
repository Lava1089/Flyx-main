# DLHD Bypass Fix - January 2026

## Summary

DLHD changed their auth system around January 30, 2026. After extensive reverse engineering, we found:

1. **M3U8 playlists don't require auth** - just need `Referer: https://hitsplay.fun/`
2. **Keys DO require auth** - need full EPlayerAuth with PoW
3. **codepcplay.fun is 18x faster** than hitsplay.fun for auth (~300ms vs ~14000ms)

**Result: Full extraction in ~350-1600ms (well under 2 second target)**

## Validation Results (40 channels tested)

- **39/40 successful** (1 channel doesn't exist)
- **38/39 under 2 seconds** (1 had network hiccup)
- **Average: 772ms**
- **Min: 353ms, Max: 1608ms** (excluding network hiccups)

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   CF Worker     │────▶│  codepcplay.fun  │────▶│   dvalna.ru     │
│ (fast-extractor)│     │  (auth: ~300ms)  │     │ (M3U8 + keys)   │
└─────────────────┘     └──────────────────┘     └─────────────────┘
         │                                                │
         │              ┌──────────────────┐              │
         └─────────────▶│    RPI Proxy     │◀─────────────┘
                        │  (residential IP) │
                        └──────────────────┘
```

## Key Discoveries

### 1. M3U8 Doesn't Need Auth
```javascript
// Just need Referer header - no auth token!
fetch(m3u8Url, { headers: { 'Referer': 'https://hitsplay.fun/' } })
```

### 2. Keys Need Full Auth
```javascript
// Headers required for REAL keys (not fake 455806f8...)
{
  'Authorization': `Bearer ${authToken}`,
  'X-Key-Timestamp': timestamp,
  'X-Key-Nonce': nonce,      // MD5-based PoW
  'X-Key-Path': keyPath,     // HMAC-SHA256
  'X-Fingerprint': fingerprint,
}
```

### 3. Fast Auth Endpoint
- **codepcplay.fun**: ~300ms (USE THIS!)
- **hitsplay.fun**: ~14000ms (too slow)

### 4. PoW Algorithm (MD5-based)
```javascript
// 1. Compute HMAC prefix
const hmacPrefix = HMAC-SHA256(channelKey, channelSalt);

// 2. Find nonce where MD5 hash starts with < 0x1000
for (nonce = 0; nonce < 100000; nonce++) {
  const data = hmacPrefix + channelKey + keyNumber + timestamp + nonce;
  const hash = MD5(data);
  if (parseInt(hash.substring(0, 4), 16) < 0x1000) {
    return nonce; // Found!
  }
}
```

## Timing Breakdown

| Step | Time |
|------|------|
| Server lookup | 0ms (pre-computed) |
| Auth fetch (codepcplay.fun) | ~200-400ms |
| M3U8 fetch | ~100-300ms |
| PoW computation | ~0-5ms |
| Key fetch | ~100-200ms |
| **TOTAL** | **~300-900ms** |

## Files

### RPI Proxy
- `dlhd-auth-v5.js` - Auth module with codepcplay.fun support
- `server.js` - Updated to use V5 auth

### CF Worker  
- `src/direct/dlhd-auth-v5.ts` - TypeScript auth module
- `src/direct/fast-extractor.ts` - Instant M3U8 extraction
- `src/direct/key-fetcher.ts` - Key fetching with auth

## Deployment

```bash
# RPI Proxy
scp -r rpi-proxy/* vynx@vynx-pi.local:~/rpi-proxy/
ssh vynx@vynx-pi.local "cd ~/rpi-proxy && pm2 restart rpi-proxy"

# CF Worker
cd dlhd-extractor-worker && wrangler deploy
```

## Fake Key Detection

If a key starts with `455806f8`, it's a FAKE decoy key. Real keys have random-looking hex values.
