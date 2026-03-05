# Security Recommendations for DLHD Extractor Worker

## Critical Vulnerabilities (Fix Immediately)

### 1. Add API Key Authentication
**Priority**: CRITICAL  
**Effort**: 2 hours

```typescript
// Add to wrangler.toml
[vars]
ALLOWED_API_KEYS = "key1,key2,key3"

// Add middleware
async function validateApiKey(request: Request, env: Env): Promise<boolean> {
  const url = new URL(request.url);
  const apiKey = url.searchParams.get('key') || 
                 url.searchParams.get('api_key') ||
                 request.headers.get('x-api-key');
  
  if (!apiKey) return false;
  
  const allowedKeys = (env.ALLOWED_API_KEYS || '').split(',');
  return allowedKeys.includes(apiKey);
}

// Apply to all endpoints
if (!await validateApiKey(request, env)) {
  return new Response(JSON.stringify({ 
    error: 'Invalid or missing API key',
    code: 'UNAUTHORIZED'
  }), { status: 401 });
}
```

### 2. Implement Origin Validation
**Priority**: CRITICAL  
**Effort**: 1 hour

```typescript
// Add to wrangler.toml
[vars]
ALLOWED_ORIGINS = "https://yourdomain.com,https://www.yourdomain.com"

// Validate on every request
function validateOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  
  const allowed = (env.ALLOWED_ORIGINS || '').split(',');
  
  if (origin && allowed.some(a => origin === a || origin.endsWith(`.${a}`))) {
    return origin;
  }
  
  if (referer) {
    const refOrigin = new URL(referer).origin;
    if (allowed.some(a => refOrigin.includes(a))) {
      return refOrigin;
    }
  }
  
  return null;
}

// Replace all 'Access-Control-Allow-Origin': '*' with:
const allowedOrigin = validateOrigin(request, env);
if (!allowedOrigin) {
  return new Response('Forbidden', { status: 403 });
}
headers: {
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Allow-Credentials': 'true',
}
```

### 3. Add Rate Limiting
**Priority**: HIGH  
**Effort**: 3 hours

```typescript
// Add KV namespace to wrangler.toml
[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "your-kv-id"

// Implement rate limiter
async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  env: Env
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const now = Date.now();
  const rateLimitKey = `rate:${key}`;
  
  const data = await env.RATE_LIMIT_KV?.get(rateLimitKey);
  const requests: number[] = data ? JSON.parse(data) : [];
  
  // Remove expired entries
  const validRequests = requests.filter(t => now - t < windowMs);
  
  if (validRequests.length >= limit) {
    const oldestRequest = Math.min(...validRequests);
    return { 
      allowed: false, 
      remaining: 0,
      resetAt: oldestRequest + windowMs
    };
  }
  
  validRequests.push(now);
  await env.RATE_LIMIT_KV?.put(
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
  env
);

if (!rateLimit.allowed) {
  return new Response(JSON.stringify({
    error: 'Rate limit exceeded',
    retryAfter: Math.ceil((rateLimit.resetAt - Date.now()) / 1000)
  }), {
    status: 429,
    headers: {
      'Retry-After': Math.ceil((rateLimit.resetAt - Date.now()) / 1000).toString(),
      'X-RateLimit-Limit': '10',
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': new Date(rateLimit.resetAt).toISOString(),
    }
  });
}
```

## High Priority Improvements

### 4. Add JWT Nonce Tracking
**Priority**: HIGH  
**Effort**: 2 hours

Prevent JWT token reuse by tracking nonces in KV.

### 5. Input Validation
**Priority**: HIGH  
**Effort**: 1 hour

```typescript
// Validate channel IDs
function validateChannelId(channelId: string): boolean {
  return /^\d{1,4}$/.test(channelId) && 
         parseInt(channelId) >= 1 && 
         parseInt(channelId) <= 9999;
}

// Validate URLs
function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const allowedDomains = [
      'dvalna.ru', 'kiko2.ru', 'giokko.ru',
      'dlhd.link', 'dlhd.sx', 'hitsplay.fun'
    ];
    return allowedDomains.some(d => 
      parsed.hostname === d || parsed.hostname.endsWith(`.${d}`)
    );
  } catch {
    return false;
  }
}
```

### 6. Remove/Protect Debug Endpoints
**Priority**: MEDIUM  
**Effort**: 30 minutes

```typescript
// Option 1: Remove in production
if (env.ENVIRONMENT === 'production') {
  return new Response('Not found', { status: 404 });
}

// Option 2: Add admin authentication
const adminKey = request.headers.get('x-admin-key');
if (adminKey !== env.ADMIN_SECRET) {
  return new Response('Forbidden', { status: 403 });
}
```

## Medium Priority Enhancements

### 7. Add Request Signing
**Priority**: MEDIUM  
**Effort**: 4 hours

Implement request signing similar to `anti-leech-proxy.ts`:

```typescript
// Client generates signature
const timestamp = Date.now();
const signature = await generateSignature(apiKey, channelId, timestamp, secret);

// Server validates
const expectedSig = await generateSignature(apiKey, channelId, timestamp, env.SIGNING_SECRET);
if (signature !== expectedSig) {
  return new Response('Invalid signature', { status: 403 });
}

// Check timestamp freshness
if (Date.now() - timestamp > 30000) { // 30 seconds
  return new Response('Request expired', { status: 403 });
}
```

### 8. Add Behavioral Analysis
**Priority**: LOW  
**Effort**: 8 hours

Implement bot detection similar to `quantum-shield-v3.ts`:
- Mouse movement entropy
- Request timing patterns
- Fingerprint consistency
- Session binding

## Implementation Priority

1. **Week 1**: API Key Auth + Origin Validation (CRITICAL)
2. **Week 2**: Rate Limiting + Input Validation (HIGH)
3. **Week 3**: JWT Nonce Tracking + Debug Endpoint Protection (HIGH)
4. **Week 4**: Request Signing (MEDIUM)
5. **Future**: Behavioral Analysis (LOW)

## Testing Checklist

- [ ] API key validation blocks unauthorized requests
- [ ] Origin validation blocks cross-origin requests
- [ ] Rate limiting triggers after threshold
- [ ] Invalid channel IDs are rejected
- [ ] Malicious URLs are blocked
- [ ] Debug endpoints require authentication
- [ ] JWT tokens cannot be reused
- [ ] CORS headers are restrictive
- [ ] Error messages don't leak sensitive info
- [ ] All endpoints log security events

## Monitoring & Alerts

Add logging for security events:

```typescript
// Log security violations
console.log(JSON.stringify({
  event: 'SECURITY_VIOLATION',
  type: 'INVALID_API_KEY',
  ip: request.headers.get('cf-connecting-ip'),
  origin: request.headers.get('origin'),
  timestamp: new Date().toISOString(),
  channelId,
}));
```

Set up Cloudflare Workers Analytics to monitor:
- Failed authentication attempts
- Rate limit violations
- Suspicious origin patterns
- Unusual traffic spikes
