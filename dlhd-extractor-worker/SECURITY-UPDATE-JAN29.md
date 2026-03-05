# Security Update - January 29, 2026

## Summary

**Status**: Security middleware imported, `/play` endpoint partially secured  
**Remaining Work**: Update all CORS headers, secure `/dlhdprivate` endpoint  
**Priority**: CRITICAL - Complete within 24 hours

## Changes Applied

### ✅ Step 1: Import Security Middleware (COMPLETED)
```typescript
import { 
  validateOrigin, 
  validateApiKey, 
  validateChannelId,
  validateProxyUrl,
  checkRateLimit,
  createSecurityErrorResponse 
} from './middleware/security';
```

### ✅ Step 2: Secure `/play` Endpoint (COMPLETED)
Added:
- Origin validation (blocks unauthorized domains)
- API key validation (requires `?key=YOUR_KEY`)
- Channel ID validation (1-4 digits, range 1-9999)
- Rate limiting (10 requests/minute per IP+channel)

## Remaining Critical Tasks

### Task 1: Update ALL CORS Headers (2 hours)

**Problem**: 27 instances of `'Access-Control-Allow-Origin': '*'` remain

**Solution**: Replace with validated origin

```typescript
// FIND (27 instances):
'Access-Control-Allow-Origin': '*'

// REPLACE WITH:
'Access-Control-Allow-Origin': allowedOrigin
```

**Locations**:
- Line 301: `/play` error response (channel not found)
- Line 350: `/play` error response (RPI error)
- Line 374: `/play` success response (M3U8)
- Line 392: `/play` error response (fetch failed)
- Line 420: `/dlhdprivate` error response (missing URL)
- Line 431: `/dlhdprivate` error response (RPI not configured)
- Line 459: `/dlhdprivate` error response (channel ID extraction failed)
- Line 508: `/dlhdprivate` error response (key fetch failed)
- Line 518: `/dlhdprivate` success response (key data)
- Line 548: `/dlhdprivate` error response (RPI error)
- Line 577: `/dlhdprivate` success response (segment too small)
- Line 647: `/dlhdprivate` success response (segment returned as-is)
- Line 717: `/dlhdprivate` error response (channel ID extraction failed)
- Line 767: `/dlhdprivate` error response (key fetch failed)
- Line 793: `/dlhdprivate` error response (invalid key size)
- Line 838: `/dlhdprivate` success response (decrypted segment)
- Line 849: `/dlhdprivate` error response (decryption failed)
- Line 862: `/dlhdprivate` success response (encrypted segment fallback)
- Line 884: `/dlhdprivate` success response (non-segment proxy)
- Line 895: `/dlhdprivate` error response (proxy failed)

### Task 2: Secure `/dlhdprivate` Endpoint (3 hours)

Add the same security checks as `/play`:

```typescript
router.get('/dlhdprivate', async (request, env, params) => {
  const url = new URL(request.url);
  
  // SECURITY: Validate origin
  const allowedOrigin = validateOrigin(request, env);
  if (!allowedOrigin) {
    return createSecurityErrorResponse(
      'Forbidden - Invalid origin',
      'ORIGIN_BLOCKED',
      403
    );
  }
  
  // SECURITY: Validate API key
  const apiKeyResult = validateApiKey(request, env);
  if (!apiKeyResult.valid) {
    return createSecurityErrorResponse(
      apiKeyResult.error!,
      'UNAUTHORIZED',
      401,
      allowedOrigin
    );
  }
  
  // SECURITY: Validate proxy URL
  const targetUrl = url.searchParams.get('url');
  if (!targetUrl) {
    return createSecurityErrorResponse(
      'Missing url parameter',
      'INVALID_INPUT',
      400,
      allowedOrigin
    );
  }
  
  const urlValidation = validateProxyUrl(targetUrl);
  if (!urlValidation.valid) {
    return createSecurityErrorResponse(
      urlValidation.error!,
      'INVALID_URL',
      400,
      allowedOrigin
    );
  }
  
  // SECURITY: Rate limiting (30 requests per minute per IP)
  // Higher limit than /play because segments are fetched frequently
  const ip = request.headers.get('cf-connecting-ip') || '127.0.0.1';
  const rateLimit = await checkRateLimit(
    `dlhdprivate:${ip}`,
    30, // 30 requests per minute
    60000, // 1 minute window
    env.RATE_LIMIT_KV
  );
  
  if (!rateLimit.allowed) {
    return new Response(JSON.stringify({
      error: 'Rate limit exceeded',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: rateLimit.retryAfter,
      limit: 30,
      window: '1 minute'
    }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': allowedOrigin,
        'Retry-After': rateLimit.retryAfter!.toString(),
        'X-RateLimit-Limit': '30',
        'X-RateLimit-Remaining': rateLimit.remaining.toString(),
        'X-RateLimit-Reset': new Date(rateLimit.resetAt).toISOString(),
      }
    });
  }
  
  // ... rest of endpoint logic
});
```

### Task 3: Fix TypeScript Errors in security.ts (1 hour)

**File**: `dlhd-extractor-worker/src/middleware/security.ts`

**Errors**:
1. `Property 'ALLOWED_ORIGINS' does not exist on type 'Env'` (lines 24, 27)
2. `Property 'API_KEYS' does not exist on type 'Env'` (line 154)
3. `Parameter 'o' implicitly has an 'any' type` (line 30)
4. `Parameter 'a' implicitly has an 'any' type` (lines 33, 44)

**Fix**: Update `dlhd-extractor-worker/src/types.ts`:

```typescript
export interface Env {
  // Existing bindings
  RPI_PROXY_URL?: string;
  RPI_PROXY_API_KEY?: string;
  
  // NEW: Security configuration
  ALLOWED_ORIGINS?: string;  // Comma-separated list
  API_KEYS?: string;          // Comma-separated list
  ENVIRONMENT?: string;       // 'development' | 'production'
  ADMIN_SECRET?: string;      // For debug endpoints
  
  // NEW: KV namespaces for rate limiting and caching
  RATE_LIMIT_KV?: KVNamespace;
  KEY_CACHE_KV?: KVNamespace;
  NONCE_KV?: KVNamespace;
}
```

**Fix type errors in security.ts**:

```typescript
// Line 30 - Add type annotation
.map((o: string) => o.trim())

// Line 33 - Add type annotation
allowed.some((a: string) => {

// Line 44 - Add type annotation
const isAllowed = allowed.some((a: string) => {
```

### Task 4: Update wrangler.toml (30 minutes)

Add security configuration:

```toml
[vars]
ENVIRONMENT = "production"
ALLOWED_ORIGINS = "https://yourdomain.com,https://www.yourdomain.com,.pages.dev"
API_KEYS = "your-api-key-1,your-api-key-2,your-api-key-3"
ADMIN_SECRET = "your-admin-secret-change-this"

# Existing vars
RPI_PROXY_URL = "https://your-rpi-proxy.com"
# RPI_PROXY_API_KEY is a secret, set via: wrangler secret put RPI_PROXY_API_KEY

[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "your-rate-limit-kv-id"
preview_id = "your-preview-kv-id"

[[kv_namespaces]]
binding = "KEY_CACHE_KV"
id = "your-key-cache-kv-id"
preview_id = "your-preview-kv-id"

[[kv_namespaces]]
binding = "NONCE_KV"
id = "your-nonce-kv-id"
preview_id = "your-preview-kv-id"
```

**Create KV namespaces**:
```bash
wrangler kv:namespace create "RATE_LIMIT_KV"
wrangler kv:namespace create "RATE_LIMIT_KV" --preview
wrangler kv:namespace create "KEY_CACHE_KV"
wrangler kv:namespace create "KEY_CACHE_KV" --preview
wrangler kv:namespace create "NONCE_KV"
wrangler kv:namespace create "NONCE_KV" --preview
```

### Task 5: Protect Debug Endpoint (15 minutes)

```typescript
router.get('/debug/proxy', async (request, env, params) => {
  // Option 1: Remove in production
  if (env.ENVIRONMENT === 'production') {
    return new Response(JSON.stringify({ error: 'Not found' }), { 
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Option 2: Require admin key
  const adminKey = request.headers.get('x-admin-key');
  if (adminKey !== env.ADMIN_SECRET) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { 
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // ... existing debug code
});
```

## Testing Checklist

After completing all tasks:

- [ ] `/play` endpoint requires valid API key
- [ ] `/play` endpoint blocks unauthorized origins
- [ ] `/play` endpoint enforces rate limits (10/min)
- [ ] `/play` endpoint validates channel IDs
- [ ] `/dlhdprivate` endpoint requires valid API key
- [ ] `/dlhdprivate` endpoint blocks unauthorized origins
- [ ] `/dlhdprivate` endpoint enforces rate limits (30/min)
- [ ] `/dlhdprivate` endpoint validates proxy URLs
- [ ] Debug endpoint requires admin key or is disabled
- [ ] All CORS headers use validated origins (no wildcards)
- [ ] TypeScript compiles without errors
- [ ] Rate limiting KV namespace works
- [ ] Key caching KV namespace works

## Performance Impact

**Expected latency increase**:
- Origin validation: +1ms
- API key validation: +1ms
- Rate limit check (KV): +5-10ms
- Total: ~10-15ms per request

**Mitigation**:
- KV reads are cached at edge
- Rate limit checks are async
- Origin/API key validation is in-memory

## Security Impact

**Before**:
- ❌ Anyone can embed streams (bandwidth theft)
- ❌ No authentication (public access)
- ❌ No rate limiting (DDoS vulnerable)
- ❌ No input validation (injection risks)

**After**:
- ✅ Only whitelisted domains can embed
- ✅ API key required for all requests
- ✅ Rate limiting prevents abuse
- ✅ Input validation prevents injection

## Estimated Time to Complete

- Task 1 (CORS headers): 2 hours
- Task 2 (/dlhdprivate security): 3 hours
- Task 3 (TypeScript fixes): 1 hour
- Task 4 (wrangler.toml): 30 minutes
- Task 5 (Debug endpoint): 15 minutes
- Testing: 1 hour

**Total**: ~8 hours (1 full workday)

## Priority Order

1. **IMMEDIATE**: Fix TypeScript errors (Task 3) - blocks deployment
2. **CRITICAL**: Update CORS headers (Task 1) - prevents bandwidth theft
3. **CRITICAL**: Secure /dlhdprivate (Task 2) - prevents unauthorized access
4. **HIGH**: Update wrangler.toml (Task 4) - enables security features
5. **MEDIUM**: Protect debug endpoint (Task 5) - information disclosure

## Deployment Plan

1. Fix TypeScript errors
2. Test locally with `wrangler dev`
3. Deploy to preview: `wrangler deploy --env preview`
4. Test all endpoints with valid/invalid API keys
5. Test rate limiting
6. Deploy to production: `wrangler deploy`
7. Monitor logs for security violations

## Rollback Plan

If issues occur:
```bash
# Rollback to previous version
wrangler rollback

# Or deploy specific version
wrangler deployments list
wrangler rollback --message "Rollback to version X"
```

## Monitoring

Add to Cloudflare Workers Analytics:
- Track 401/403 responses (authentication failures)
- Track 429 responses (rate limit violations)
- Track origin header patterns
- Alert on unusual traffic spikes

## References

- `SECURITY-REVIEW-SUMMARY.md` - Vulnerability analysis
- `SECURITY-FIXES-PRIORITY.md` - Implementation guide
- `src/middleware/security.ts` - Security functions
- `cloudflare-proxy/src/anti-leech-proxy.ts` - Token-based auth pattern
- `cloudflare-proxy/QUANTUM-SHIELD-V3-PARANOID.md` - Advanced protection
