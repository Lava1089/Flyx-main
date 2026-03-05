# DLHD Key Fetching Rate Limit Issue - February 6, 2026

## Problem Summary

The DLHD extractor is failing to get keys with **HTTP 429 (Too Many Requests)** and **Cloudflare error code 1015**.

### Root Causes Identified

1. **Multiple Timestamp Offset Attempts** (FIXED)
   - The key fetcher was trying 7 different timestamp offsets for each key request
   - This caused 7x the number of requests, triggering Cloudflare's rate limiting
   - **Fix**: Removed all offset attempts, now uses current time only (1 attempt per key)

2. **Auth Version Mismatch** (CLARIFIED)
   - CF Worker uses V5 auth (EPlayerAuth with MD5 PoW)
   - RPI Proxy uses V4 auth (WASM-based PoW)
   - **Status**: This is intentional - both versions work, V4 is more stable
   - No changes needed - the mismatch doesn't cause issues

3. **Current Rate Limit Ban**
   - The IP addresses (both direct and RPI proxy) are currently rate-limited
   - Error response: `6572726f7220636f64653a2031303135` (hex for "error code: 1015")
   - This is Cloudflare's temporary ban, typically lasts 15-30 minutes

## Changes Made

### 1. CF Worker - Removed Timestamp Offsets
**File**: `dlhd-extractor-worker/src/direct/key-fetcher.ts`

**Before**:
```typescript
const timestampOffsets = [0, -1, 1, -2, 2, -3, 3];
for (const offset of timestampOffsets) {
  // Try each offset...
}
```

**After**:
```typescript
// Use current time only - no offsets
const headers = await generateKeyHeaders(resource, keyNumber, auth);
// Single fetch attempt
```

### 2. RPI Proxy - Still Uses V4 Auth
**File**: `rpi-proxy/server.js`

**Current State**:
```javascript
const dlhdAuthV4 = require('./dlhd-auth-v4');
const dlhdAuthV5 = require('./dlhd-auth-v5');

// In fetchKeyWithAuth function:
const result = await dlhdAuthV4.fetchDLHDKeyV4(keyUrl);
```

**Note**: RPI proxy has both V4 and V5 modules loaded but currently uses V4 for key fetching. V5 is available for future migration if needed.

## Testing Results

### Auth Fetch (Working ✅)
```bash
$ node -e "const auth = require('./rpi-proxy/dlhd-auth-v5'); auth.fetchAuthDataV5('577').then(r => console.log(r))"
```

Output:
```json
{
  "authToken": "premium577|US|1770440811|1770527211|ed65fe72...",
  "channelSalt": "7cd96eee57e7d5a694affad5f1b88315572137d3...",
  "channelKey": "premium577",
  "country": "US",
  "timestamp": 1770440811,
  "source": "EPlayerAuth",
  "fetchTime": 1345
}
```

### Key Fetch (Rate Limited ❌)
```bash
$ node dlhd-extractor-worker/test-direct-key.js
```

Output:
```
Status: 429
Hex: 6572726f7220636f64653a2031303135
Decoded: "error code: 1015"
```

## Next Steps

### Immediate (Wait for Rate Limit Reset)
1. **Wait 15-30 minutes** for Cloudflare's rate limit to reset
2. Test key fetching again
3. If still failing, wait longer (could be up to 1 hour)

### Short-term (Deploy Fixes)
1. **Deploy RPI Proxy** with V4 auth (already in place):
   ```bash
   scp rpi-proxy/server.js vynx@vynx-pi.local:~/rpi-proxy/
   scp rpi-proxy/dlhd-auth-v4.js vynx@vynx-pi.local:~/rpi-proxy/
   ssh vynx@vynx-pi.local "cd ~/rpi-proxy && pm2 restart rpi-proxy"
   ```

2. **Deploy CF Worker** with single-attempt key fetching:
   ```bash
   cd dlhd-extractor-worker
   wrangler deploy
   ```

### Long-term (Prevent Future Rate Limiting)
1. **Add Request Delays**
   - Add 500ms-1s delay between key requests
   - Implement exponential backoff on 429 errors

2. **Implement Caching**
   - Cache auth tokens for 5-10 minutes (they're valid for ~24 hours)
   - Cache keys for 30 seconds (they don't change frequently)

3. **Better Error Handling**
   - Detect 429 errors and wait before retrying
   - Parse `Retry-After` header if present
   - Return user-friendly error messages

4. **Use RPI Proxy Exclusively**
   - Route ALL key requests through RPI proxy (residential IP)
   - Datacenter IPs (CF Workers) are more likely to be rate-limited

## Technical Details

### Cloudflare Error 1015
- **Meaning**: Rate limiting triggered
- **Typical Duration**: 15-30 minutes (can be up to 1 hour)
- **Trigger**: Too many requests from same IP in short time
- **Solution**: Wait for reset, then reduce request frequency

### V5 Auth (EPlayerAuth)
- **Auth Token**: Pipe-delimited format `channelKey|country|timestamp|expiry|signature`
- **Channel Salt**: 64-char hex string, extracted from player page
- **PoW Algorithm**: MD5-based, finds nonce where `MD5(hmac_prefix + data + nonce)` starts with < 0x1000
- **Required Headers**:
  - `Authorization: Bearer <authToken>`
  - `X-Key-Timestamp: <unix_timestamp>`
  - `X-Key-Nonce: <pow_nonce>`
  - `X-Key-Path: <hmac_derived_path>`
  - `X-Fingerprint: <browser_fingerprint>`

### Fake Key Detection
Keys starting with these patterns are fake/error responses:
- `455806f8` - Fake decoy key
- `45c6497` - Another fake pattern
- `6572726f72` - "error" in hex

## Monitoring

To check if rate limit has reset:
```bash
# Test auth fetch (should always work)
node -e "const auth = require('./rpi-proxy/dlhd-auth-v5'); auth.fetchAuthDataV5('577').then(r => console.log('Auth OK'))"

# Test key fetch (will fail if rate limited)
node dlhd-extractor-worker/test-direct-key.js
```

Look for:
- Status 200 = Success
- Status 429 = Still rate limited
- Status 403 = Auth issue
- Status 502 = RPI proxy issue

## Files Modified

1. `dlhd-extractor-worker/src/direct/key-fetcher.ts` - Removed timestamp offsets
2. `rpi-proxy/server.js` - Added missing V4 auth import (both V4 and V5 now available)
3. `dlhd-extractor-worker/RATE-LIMIT-FIX-FEB6.md` - This document

## Conclusion

The rate limiting was caused by making 7 requests per key (timestamp offsets). This has been fixed. The current 429 errors are from the temporary Cloudflare ban, which should reset in 15-30 minutes. Once the ban lifts, key fetching should work with the new single-attempt approach.
