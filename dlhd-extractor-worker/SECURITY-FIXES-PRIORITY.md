# DLHD Extractor Worker - Security Fixes Priority List

## CRITICAL - Fix Immediately (Week 1)

### 1. Add Origin Validation to ALL Endpoints
**Current**: `'Access-Control-Allow-Origin': '*'` everywhere
**Fix**: Implement strict origin checking like `anti-leech-proxy.ts`

```typescript
// Add to middleware/auth.ts
const ALLOWED_ORIGINS = [
  'https://yourdomain.com',
  'https://www.yourdomain.com',
  'http://localhost:3000', // Dev only
];

export function validateOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  
  const allowed = env.ALLOWED_ORIGINS 
    ? env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : ALLOWED_ORIGINS;

  if (origin && allowed.some(a => origin === a || origin.startsWith(a))) {
    return origin;
  }
  
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      if (allowed.some(a => refOrigin.includes(a))) {
        return refOrigin;
      }
    } catch {}
  }
  
  return null;
}

// Apply to EVERY response
const allowedOrigin = validateOrigin(request, env);
if (!allowedOrigin) {
  return new Response(JSON.stringify({ 
    error: 'Forbidden - Invalid origin',
    code: 'ORIGIN_BLOCKED'
  }), { 
    status: 403,
    headers: { 'Content-Type': 'application/json' }
  });
}

// Replace ALL instances of:
// 'Access-Control-Allow-Origin': '*'
// With:
'Access-Control-Allow-Origin': allowedOrigin,
'Access-Control-Allow-Credentials': 'true',
```

### 2. Add API Key Authentication to /play and /dlhdprivate
**Current**: No authentication on critical endpoints
**Fix**: Require API key on ALL endpoints

```typescript
// In routes.ts - /play endpoint (line ~200)
router.get('/play/:channelId', async (request, env, params) => {
  const url = new URL(request.url);
  const apiKey = url.searchParams.get('key') || url.searchParams.get('api_key');
  
  // VALIDATE API KEY
  if (!apiKey || !isValidApiKey(apiKey, env)) {
    return new Response(JSON.stringify({ 
      error: 'Invalid or missing API key',
      code: 'UNAUTHORIZED',
      hint: 'Add ?key=YOUR_API_KEY to the URL'
    }), { 
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // ... rest of endpoint
});

// In routes.ts - /dlhdprivate endpoint (line ~320)
router.get('/dlhdprivate', async (request, env, params) => {
  const url = new URL(request.url);
  const apiKey = url.searchParams.get('key') || url.searchParams.get('api_key');
  
  // VALIDATE API KEY
  if (!apiKey || !isValidApiKey(apiKey, env)) {
    return new Response(JSON.stringify({ 
      error: 'Invalid or missing API key',
      code: 'UNAUTHORIZED'
    }), { 
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // ... rest of endpoint
});

// Helper function
function isValidApiKey(apiKey: string, env: Env): boolean {
  const validKeys = (env.API_KEYS || '').split(',').map(k => k.trim());
  return validKeys.includes(apiKey);
}
```

### 3. Implement Rate Limiting
**Current**: No rate limiting
**Fix**: Add per-IP and per-API-key rate limiting

```typescript
// Add to middleware/rate-limit.ts
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
}

export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  kv: KVNamespace
): Promise<RateLimitResult> {
  const now = Date.now();
  const rateLimitKey = `rate:${key}`;
  
  const data = await kv.get(rateLimitKey);
  const requests: number[] = data ? JSON.parse(data) : [];
  
  // Remove expired entries
  const validRequests = requests.filter(t => now - t < windowMs);
  
  if (validRequests.length >= limit) {
    const oldestRequest = Math.min(...validRequests);
    return { 
      allowed: false, 
      remaining: 0,
      resetAt: oldestRequest + windowMs,
      retryAfter: Math.ceil((oldestRequest + windowMs - now) / 1000)
    };
  }
  
  validRequests.push(now);
  await kv.put(
    rateLimitKey,
    JSON.stringify(validRequests),
    { expirationTtl: Math.ceil(windowMs / 1000) }
  );
  
  return { 
    allowed: true, 
    remaining: limit - validRequests.length,
    resetAt: now + windowMs
  };
}

// Apply to /play endpoint
const ip = request.headers.get('cf-connecting-ip') || '127.0.0.1';
const rateLimit = await checkRateLimit(
  `play:${ip}:${channelId}`,
  10, // 10 requests per minute
  60000,
  env.RATE_LIMIT_KV
);

if (!rateLimit.allowed) {
  return new Response(JSON.stringify({
    error: 'Rate limit exceeded',
    code: 'RATE_LIMIT_EXCEEDED',
    retryAfter: rateLimit.retryAfter
  }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': rateLimit.retryAfter!.toString(),
      'X-RateLimit-Limit': '10',
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': new Date(rateLimit.resetAt).toISOString(),
    }
  });
}
```

## HIGH PRIORITY (Week 2)

### 4. Add Input Validation
**Current**: Minimal validation on channel IDs
**Fix**: Strict validation on all inputs

```typescript
// Add to utils/validation.ts
export function validateChannelId(channelId: string): { valid: boolean; error?: string } {
  if (!/^\d{1,4}$/.test(channelId)) {
    return { valid: false, error: 'Channel ID must be 1-4 digits' };
  }
  
  const num = parseInt(channelId, 10);
  if (num < 1 || num > 9999) {
    return { valid: false, error: 'Channel ID must be between 1 and 9999' };
  }
  
  return { valid: true };
}

export function validateProxyUrl(url: string): { valid: boolean; error?: string } {
  try {
    const parsed = new URL(url);
    const allowedDomains = [
      'dvalna.ru', 'kiko2.ru', 'giokko.ru',
      'dlhd.link', 'dlhd.sx', 'hitsplay.fun'
    ];
    
    const isAllowed = allowedDomains.some(d => 
      parsed.hostname === d || parsed.hostname.endsWith(`.${d}`)
    );
    
    if (!isAllowed) {
      return { valid: false, error: 'URL domain not allowed' };
    }
    
    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}

// Apply in /play endpoint
const validation = validateChannelId(channelId);
if (!validation.valid) {
  return new Response(JSON.stringify({ 
    error: validation.error,
    code: 'INVALID_INPUT'
  }), { 
    status: 400,
    headers: { 'Content-Type': 'application/json' }
  });
}

// Apply in /dlhdprivate endpoint
const urlValidation = validateProxyUrl(targetUrl);
if (!urlValidation.valid) {
  return new Response(JSON.stringify({ 
    error: urlValidation.error,
    code: 'INVALID_URL'
  }), { 
    status: 400,
    headers: { 'Content-Type': 'application/json' }
  });
}
```

### 5. Protect Debug Endpoints
**Current**: `/debug/proxy` is publicly accessible
**Fix**: Add admin authentication or remove in production

```typescript
// Option 1: Remove in production
router.get('/debug/proxy', async (request, env, params) => {
  if (env.ENVIRONMENT === 'production') {
    return new Response(JSON.stringify({ error: 'Not found' }), { 
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  // ... existing debug code
});

// Option 2: Add admin key
router.get('/debug/proxy', async (request, env, params) => {
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

### 6. ~~Fix Key Cache Memory Leak~~ ✅ FIXED
**Current**: ~~In-memory Map with setInterval (doesn't work in Workers)~~  
**Status**: ✅ FIXED (January 29, 2026) - Now uses on-demand cleanup  
**Fix Applied**: Replaced `setInterval()` with probabilistic cleanup (10% per request)

**Note**: For production scale, consider migrating to KV namespace:

```typescript
// OPTIONAL ENHANCEMENT: Use KV for distributed caching

// Replace with KV-based caching
async function getCachedKey(
  keyUrl: string,
  env: Env
): Promise<Uint8Array | null> {
  if (!env.KEY_CACHE_KV) return null;
  
  const cacheKey = `key:${await hashString(keyUrl)}`;
  const cached = await env.KEY_CACHE_KV.get(cacheKey, 'arrayBuffer');
  
  if (cached) {
    console.log(`[getCachedKey] Cache hit for ${keyUrl.substring(0, 50)}...`);
    return new Uint8Array(cached);
  }
  
  return null;
}

async function setCachedKey(
  keyUrl: string,
  keyData: Uint8Array,
  env: Env
): Promise<void> {
  if (!env.KEY_CACHE_KV) return;
  
  const cacheKey = `key:${await hashString(keyUrl)}`;
  await env.KEY_CACHE_KV.put(cacheKey, keyData.buffer, {
    expirationTtl: 300 // 5 minutes
  });
  console.log(`[setCachedKey] Cached key for 5 minutes`);
}

// Replace lines 520-545 with:
let keyData = await getCachedKey(keyUrl, env);

if (!keyData) {
  // ... fetch key logic ...
  keyData = new Uint8Array(keyResult.data);
  await setCachedKey(keyUrl, keyData, env);
}
```

## MEDIUM PRIORITY (Week 3)

### 7. Add Request Signing (Like anti-leech-proxy.ts)
**Current**: No request signing
**Fix**: Implement token-based authentication

```typescript
// Add to middleware/signing.ts
interface StreamToken {
  u: string;   // URL hash
  f: string;   // Fingerprint hash
  e: number;   // Expiry timestamp
  n: string;   // Nonce
  s: string;   // Session ID
}

export async function generateStreamToken(
  url: string,
  fingerprint: string,
  sessionId: string,
  secret: string
): Promise<string> {
  const token: StreamToken = {
    u: await hashString(url),
    f: await hashString(fingerprint),
    e: Date.now() + 5 * 60 * 1000, // 5 minutes
    n: crypto.randomUUID().slice(0, 8),
    s: sessionId.slice(0, 16),
  };

  return await signToken(token, secret);
}

export async function validateStreamToken(
  token: string,
  url: string,
  fingerprint: string,
  sessionId: string,
  secret: string,
  nonceKV: KVNamespace
): Promise<{ valid: boolean; reason?: string }> {
  // Implementation similar to anti-leech-proxy.ts
  // Check signature, expiry, URL hash, fingerprint, session, nonce
}
```

### 8. Add Behavioral Analysis (Like quantum-shield-v3)
**Current**: No bot detection
**Fix**: Implement mouse entropy and challenge system

```typescript
// Add to middleware/behavioral.ts
export interface BehavioralData {
  mouseEntropy: number;
  sampleCount: number;
  velocityVariance: number;
  microMovements: number;
}

export function analyzeBehavior(data: BehavioralData): {
  isHuman: boolean;
  score: number;
  reasons: string[];
} {
  const reasons: string[] = [];
  let score = 50; // Start neutral
  
  // Check mouse entropy (quantum-shield-v3 requires >= 0.5)
  if (data.mouseEntropy < 0.5) {
    reasons.push('Low mouse entropy (bot-like)');
    score -= 20;
  } else {
    score += 10;
  }
  
  // Check sample count (quantum-shield-v3 requires >= 50)
  if (data.sampleCount < 50) {
    reasons.push('Insufficient behavioral samples');
    score -= 15;
  } else {
    score += 5;
  }
  
  // Check velocity variance (CV < 15% = robotic)
  if (data.velocityVariance < 0.15) {
    reasons.push('Constant velocity (robotic)');
    score -= 15;
  }
  
  // Check micro-movements (< 5% = suspicious)
  if (data.microMovements < 0.05) {
    reasons.push('No hand tremor detected');
    score -= 10;
  }
  
  return {
    isHuman: score >= 60,
    score,
    reasons
  };
}
```

## Configuration Changes Required

### wrangler.toml
```toml
[vars]
ENVIRONMENT = "production"
ALLOWED_ORIGINS = "https://yourdomain.com,https://www.yourdomain.com"
API_KEYS = "key1,key2,key3"
SIGNING_SECRET = "your-secret-key-change-this"
ADMIN_SECRET = "your-admin-key-change-this"

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

## Testing Checklist

After implementing fixes:

- [ ] API key validation blocks unauthorized requests
- [ ] Origin validation blocks cross-origin requests from unknown domains
- [ ] Rate limiting triggers after threshold (10 req/min)
- [ ] Invalid channel IDs are rejected (non-numeric, out of range)
- [ ] Malicious URLs are blocked (non-whitelisted domains)
- [ ] Debug endpoints require admin authentication
- [ ] Key caching works without memory leaks
- [ ] CORS headers are restrictive (no wildcards)
- [ ] Error messages don't leak sensitive info
- [ ] All endpoints log security events

## Monitoring & Alerts

Set up Cloudflare Workers Analytics to monitor:
- Failed authentication attempts (401/403 responses)
- Rate limit violations (429 responses)
- Suspicious origin patterns (blocked origins)
- Unusual traffic spikes (potential DDoS)
- Key fetch failures (502 responses)

## Estimated Implementation Time

- **Week 1 (Critical)**: 16 hours
  - Origin validation: 4 hours
  - API key auth: 4 hours
  - Rate limiting: 6 hours
  - Testing: 2 hours

- **Week 2 (High)**: 8 hours ✅ 4 hours saved (cache fix completed)
  - Input validation: 3 hours
  - Debug endpoint protection: 1 hour
  - ~~Key cache fix: 4 hours~~ ✅ COMPLETED
  - Testing: 4 hours

- **Week 3 (Medium)**: 20 hours
  - Request signing: 10 hours
  - Behavioral analysis: 8 hours
  - Testing: 2 hours

**Total**: ~44 hours (5.5 days of work) - 4 hours saved from cache fix completion
