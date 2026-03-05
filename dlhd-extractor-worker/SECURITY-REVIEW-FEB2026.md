# Security Review: DLHD Key Fetcher Changes (Feb 2026)

## Change Summary

**Commit**: Removed direct key fetch from CF Worker, forcing all key requests through RPI proxy

**Rationale**: CF Workers may use IPv6, causing key server to return fake keys. RPI proxy forces IPv4 with `family: 4` option.

## Security Analysis

### ✅ Positive Impacts

1. **Consistent IPv4 Enforcement**
   - Eliminates IPv6-related fake key issues
   - Predictable network behavior

2. **Reduced Attack Surface**
   - Single code path for key fetching
   - Easier to audit and maintain

3. **Better Error Handling**
   - Clearer logging for debugging
   - Simplified failure modes

### ⚠️ Security Concerns

#### 1. **RPI Proxy as Single Point of Failure**

**Risk**: If RPI proxy is compromised, ALL key requests are affected.

**Current State**:
```typescript
// routes.ts line ~740
const rpiProxyUrl = env.RPI_PROXY_URL || 'https://rpi-proxy.vynx.cc';
const rpiApiKey = env.RPI_PROXY_API_KEY || '';
```

**Issues**:
- No fallback mechanism if RPI proxy is down
- No health checking before routing requests
- API key stored in environment (good) but no rotation mechanism

**Recommendations**:
```typescript
// Add RPI proxy health check
async function checkRpiProxyHealth(proxyUrl: string, apiKey: string): Promise<boolean> {
  try {
    const response = await fetch(`${proxyUrl}/health`, {
      headers: { 'X-API-Key': apiKey },
      signal: AbortSignal.timeout(2000), // 2s timeout
    });
    return response.ok;
  } catch {
    return false;
  }
}

// Add fallback proxy list
const RPI_PROXY_FALLBACKS = [
  env.RPI_PROXY_URL,
  env.RPI_PROXY_FALLBACK_1,
  env.RPI_PROXY_FALLBACK_2,
].filter(Boolean);
```

#### 2. **Missing Request Signing Between CF Worker and RPI Proxy**

**Risk**: If someone discovers the RPI proxy URL and API key, they can bypass CF Worker security.

**Current State**:
```typescript
// routes.ts - No request signing
const fetchEndpoint = `${rpiProxyUrl}/fetch?` + new URLSearchParams({
  url: targetUrl,
  headers: JSON.stringify(rpiUpstreamHeaders),
  key: rpiApiKey,
}).toString();
```

**Issues**:
- API key passed in query string (visible in logs)
- No request signing or HMAC validation
- No timestamp validation to prevent replay attacks

**Recommendations**:
```typescript
// Add request signing
async function signRpiRequest(
  url: string,
  headers: Record<string, string>,
  secret: string
): Promise<string> {
  const timestamp = Date.now();
  const nonce = crypto.randomUUID();
  const data = `${url}|${JSON.stringify(headers)}|${timestamp}|${nonce}`;
  
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(data)
  );
  
  const sigHex = Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  return `${timestamp}:${nonce}:${sigHex}`;
}

// Use in request
const signature = await signRpiRequest(targetUrl, rpiUpstreamHeaders, env.RPI_SHARED_SECRET);
const fetchEndpoint = `${rpiProxyUrl}/fetch?` + new URLSearchParams({
  url: targetUrl,
  headers: JSON.stringify(rpiUpstreamHeaders),
  sig: signature,
}).toString();

// Add to headers instead of query string
const response = await fetch(fetchEndpoint, {
  headers: {
    'X-API-Key': rpiApiKey,
    'X-Request-Signature': signature,
  },
});
```

#### 3. **Nonce Tracking Implementation Issues**

**Risk**: Current nonce tracking doesn't expire old entries properly.

**Current State** (FIXED):
```typescript
// key-fetcher.ts - Now properly tracks expiry
const usedNonces = new Set<string>();
const NONCE_EXPIRY_MS = 300000; // 5 minutes

function markNonceUsed(nonce: string): void {
  const entry = `${nonce}:${Date.now()}`;
  usedNonces.add(entry);
  
  // Clean up expired nonces
  if (usedNonces.size > 10000) {
    const now = Date.now();
    const toDelete: string[] = [];
    
    for (const entry of usedNonces) {
      const timestamp = parseInt(entry.split(':')[1], 10);
      if (now - timestamp > NONCE_EXPIRY_MS) {
        toDelete.push(entry);
      }
    }
    
    toDelete.forEach(e => usedNonces.delete(e));
  }
}
```

**Status**: ✅ FIXED - Now properly expires old nonces based on timestamp

#### 4. **Rate Limiting Bypass via Multiple Channels**

**Risk**: Rate limiting is per-channel, but attacker could rotate channels.

**Current State**:
```typescript
// key-fetcher.ts
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 10; // Per channel
```

**Issues**:
- No global rate limit across all channels
- No IP-based rate limiting
- No session-based rate limiting

**Recommendations**:
```typescript
// Add multi-level rate limiting
interface RateLimitConfig {
  perChannel: { limit: number; window: number };
  perSession: { limit: number; window: number };
  perIP: { limit: number; window: number };
  global: { limit: number; window: number };
}

const RATE_LIMITS: RateLimitConfig = {
  perChannel: { limit: 10, window: 60000 },    // 10/min per channel
  perSession: { limit: 50, window: 60000 },    // 50/min per session
  perIP: { limit: 100, window: 60000 },        // 100/min per IP
  global: { limit: 1000, window: 60000 },      // 1000/min globally
};

async function checkMultiLevelRateLimit(
  channel: string,
  sessionId: string,
  ip: string,
  kv?: KVNamespace
): Promise<{ allowed: boolean; reason?: string }> {
  // Check all levels
  const checks = [
    checkRateLimit(`channel:${channel}`, RATE_LIMITS.perChannel.limit, RATE_LIMITS.perChannel.window, kv),
    checkRateLimit(`session:${sessionId}`, RATE_LIMITS.perSession.limit, RATE_LIMITS.perSession.window, kv),
    checkRateLimit(`ip:${ip}`, RATE_LIMITS.perIP.limit, RATE_LIMITS.perIP.window, kv),
    checkRateLimit('global', RATE_LIMITS.global.limit, RATE_LIMITS.global.window, kv),
  ];
  
  const results = await Promise.all(checks);
  const blocked = results.find(r => !r.allowed);
  
  if (blocked) {
    return { allowed: false, reason: 'Rate limit exceeded' };
  }
  
  return { allowed: true };
}
```

#### 5. **Missing Anti-Leech Protection on /dlhdprivate Endpoint**

**Risk**: The `/dlhdprivate` endpoint has weak authentication compared to other endpoints.

**Current State**:
```typescript
// routes.ts - Weak authentication
const isInternalCall = referer.includes(url.host);
const hasApiKey = validateApiKey(request, env).valid;
const hasJwt = !!jwtToken && jwtToken.length > 20; // Basic check!
```

**Issues**:
- JWT validation is just length check (no signature verification)
- Referer can be spoofed
- No token binding to session/fingerprint

**Recommendations**:
```typescript
// Add proper JWT validation
async function validateJWT(
  token: string,
  expectedChannel: string,
  env: Env
): Promise<{ valid: boolean; reason?: string; channelSalt?: string }> {
  try {
    // Parse JWT (assuming format: header.payload.signature)
    const [headerB64, payloadB64, signatureB64] = token.split('.');
    
    if (!headerB64 || !payloadB64 || !signatureB64) {
      return { valid: false, reason: 'Invalid JWT format' };
    }
    
    // Decode payload
    const payload = JSON.parse(atob(payloadB64));
    
    // Validate expiry
    if (payload.exp && Date.now() > payload.exp * 1000) {
      return { valid: false, reason: 'Token expired' };
    }
    
    // Validate channel
    if (payload.channel !== expectedChannel) {
      return { valid: false, reason: 'Channel mismatch' };
    }
    
    // Verify signature
    const secret = env.JWT_SECRET || 'change-me';
    const data = `${headerB64}.${payloadB64}`;
    const expectedSig = await hmacSha256(data, secret);
    
    if (signatureB64 !== expectedSig.substring(0, 43)) { // Base64 length
      return { valid: false, reason: 'Invalid signature' };
    }
    
    return { 
      valid: true, 
      channelSalt: payload.channelSalt 
    };
  } catch (e) {
    return { valid: false, reason: `Validation error: ${e}` };
  }
}

// Use in /dlhdprivate
if (hasJwt) {
  const jwtValidation = await validateJWT(jwtToken, channel, env);
  if (!jwtValidation.valid) {
    return new Response(JSON.stringify({ 
      error: `Invalid JWT: ${jwtValidation.reason}` 
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
```

#### 6. **Exposed Infrastructure Details in Error Messages**

**Risk**: Error messages reveal too much about internal architecture.

**Current State**:
```typescript
// routes.ts - Exposes RPI proxy details
return new Response(JSON.stringify({ 
  error: 'RPI key fetch failed', 
  status: rpiResponse.status, 
  details: errorText  // ⚠️ May contain sensitive info
}), { ... });
```

**Recommendations**:
```typescript
// Sanitize error messages
function sanitizeErrorMessage(error: string, isDevelopment: boolean): string {
  if (isDevelopment) {
    return error; // Full details in dev
  }
  
  // Production: Generic messages only
  const genericErrors: Record<string, string> = {
    'RPI key fetch failed': 'Key service temporarily unavailable',
    'Failed to get auth data': 'Authentication service unavailable',
    'Invalid key size': 'Invalid encryption key received',
  };
  
  return genericErrors[error] || 'Service temporarily unavailable';
}

// Use in responses
return new Response(JSON.stringify({ 
  error: sanitizeErrorMessage('RPI key fetch failed', env.ENVIRONMENT === 'development'),
  code: 'KEY_FETCH_ERROR',
}), { ... });
```

### 🔒 Additional Security Recommendations

#### 7. **Add Request Fingerprinting**

Similar to `anti-leech-proxy.ts`, add browser fingerprinting:

```typescript
// Add to /dlhdprivate endpoint
async function generateRequestFingerprint(request: Request): Promise<string> {
  const ua = request.headers.get('user-agent') || '';
  const acceptLang = request.headers.get('accept-language') || '';
  const acceptEnc = request.headers.get('accept-encoding') || '';
  const ip = request.headers.get('cf-connecting-ip') || '';
  
  const data = `${ua}|${acceptLang}|${acceptEnc}|${ip}`;
  return await hashString(data);
}

// Bind JWT to fingerprint
const fingerprint = await generateRequestFingerprint(request);
const token = await generateJWT(channelId, fingerprint);

// Validate fingerprint on use
if (jwtPayload.fingerprint !== currentFingerprint) {
  return errorResponse('Token fingerprint mismatch', 403);
}
```

#### 8. **Add Honeypot Endpoints**

Detect and block automated scrapers:

```typescript
// Add fake endpoints that legitimate clients never call
router.get('/api/keys', async (request, env) => {
  const ip = request.headers.get('cf-connecting-ip');
  console.log(`[Honeypot] Suspicious access from ${ip}`);
  
  // Log to KV for blocking
  if (env.SECURITY_KV) {
    await env.SECURITY_KV.put(`blocked:${ip}`, '1', { expirationTtl: 86400 });
  }
  
  return new Response('Not found', { status: 404 });
});

// Check blocked IPs in middleware
async function isBlockedIP(ip: string, kv?: KVNamespace): Promise<boolean> {
  if (!kv) return false;
  const blocked = await kv.get(`blocked:${ip}`);
  return blocked === '1';
}
```

#### 9. **Add Metrics and Alerting**

Monitor for security incidents:

```typescript
interface SecurityMetrics {
  rateLimitHits: number;
  invalidTokens: number;
  fakeKeysDetected: number;
  suspiciousIPs: Set<string>;
}

const metrics: SecurityMetrics = {
  rateLimitHits: 0,
  invalidTokens: 0,
  fakeKeysDetected: 0,
  suspiciousIPs: new Set(),
};

// Log metrics periodically
async function logSecurityMetrics(env: Env) {
  if (env.ANALYTICS_KV) {
    await env.ANALYTICS_KV.put(
      `security:${Date.now()}`,
      JSON.stringify(metrics),
      { expirationTtl: 604800 } // 7 days
    );
  }
  
  // Alert if thresholds exceeded
  if (metrics.rateLimitHits > 1000 || metrics.invalidTokens > 500) {
    console.error('[SECURITY ALERT] High abuse detected:', metrics);
    // TODO: Send to monitoring service
  }
}
```

## Implementation Priority

### 🔴 Critical (Implement Immediately)

1. ✅ **Fix nonce expiry tracking** - COMPLETED
2. **Add proper JWT validation** - Currently just length check
3. **Add request signing for RPI proxy** - Prevent API key theft

### 🟡 High Priority (Implement This Week)

4. **Add RPI proxy health checks and fallbacks**
5. **Sanitize error messages in production**
6. **Add multi-level rate limiting**

### 🟢 Medium Priority (Implement This Month)

7. **Add request fingerprinting**
8. **Add honeypot endpoints**
9. **Add security metrics and alerting**

## Testing Checklist

- [ ] Test RPI proxy failure scenarios
- [ ] Test rate limit bypass attempts
- [ ] Test JWT tampering detection
- [ ] Test nonce replay attacks
- [ ] Test fake key detection
- [ ] Load test with 1000+ concurrent requests
- [ ] Penetration test with OWASP ZAP

## Conclusion

The change to force all key requests through RPI proxy is **security-neutral** in isolation, but it highlights several existing vulnerabilities that should be addressed. The most critical issues are:

1. Weak JWT validation (just length check)
2. Missing request signing between CF Worker and RPI proxy
3. Single point of failure (no RPI proxy fallbacks)

Implementing the recommendations above will significantly improve the security posture of the key fetching system.

---

**Reviewed by**: Kiro AI Assistant  
**Date**: February 6, 2026  
**Status**: ✅ Nonce tracking fixed, other recommendations pending
