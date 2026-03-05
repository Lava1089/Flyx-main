/**
 * DLHD Key Fetcher with V5 EPlayerAuth
 * 
 * Fetches encryption keys DIRECTLY from DLHD key servers (no RPI proxy needed!)
 * 
 * Required headers:
 * - Authorization: Bearer <authToken>
 * - X-Key-Timestamp: <unix_timestamp>
 * - X-Key-Nonce: <pow_nonce> (MD5-based)
 * - X-Key-Path: <hmac_derived_path>
 * - X-Fingerprint: <browser_fingerprint>
 * 
 * SECURITY FEATURES:
 * - Rate limiting per channel (prevents abuse)
 * - Nonce tracking (prevents replay attacks)
 * - Fake key detection (identifies server-side blocks)
 * - Request fingerprinting (tracks suspicious patterns)
 * 
 * Updated February 2026: Direct fetch works! No residential IP needed.
 */

import { 
  fetchAuthData,
  generateKeyHeaders,
  DLHDAuthDataV5,
} from './dlhd-auth-v5';

export type { DLHDAuthDataV5 as DLHDAuthData } from './dlhd-auth-v5';

// Rate limiting: Track requests per channel
const channelRequestCache = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 10; // Max 10 key requests per channel per minute

// Nonce tracking: Prevent replay attacks
const usedNonces = new Set<string>();
const NONCE_EXPIRY_MS = 300000; // 5 minutes

export interface KeyFetchResult {
  success: boolean;
  data?: ArrayBuffer;
  error?: string;
  statusCode?: number;
  isFakeKey?: boolean;
  retryAfter?: number; // Milliseconds to wait before retry
}

/**
 * Parse key URL to extract resource and key number
 */
export function parseKeyUrl(keyUrl: string): { resource: string; keyNumber: string } | null {
  const match = keyUrl.match(/\/key\/([^/]+)\/(\d+)/);
  if (!match) return null;
  return { resource: match[1], keyNumber: match[2] };
}

/**
 * Extract channel ID from key URL
 */
export function extractChannelFromKeyUrl(keyUrl: string): string | null {
  const match = keyUrl.match(/premium(\d+)/);
  return match ? match[1] : null;
}

/**
 * Check rate limit for channel
 * Returns true if rate limit exceeded
 */
function checkRateLimit(channel: string): { limited: boolean; retryAfter?: number } {
  const now = Date.now();
  const key = `channel:${channel}`;
  
  let record = channelRequestCache.get(key);
  
  // Reset if window expired
  if (!record || now >= record.resetAt) {
    record = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    channelRequestCache.set(key, record);
  }
  
  // Check limit
  if (record.count >= MAX_REQUESTS_PER_WINDOW) {
    const retryAfter = record.resetAt - now;
    console.log(`[Key-Fetch] Rate limit exceeded for channel ${channel}, retry in ${retryAfter}ms`);
    return { limited: true, retryAfter };
  }
  
  // Increment counter
  record.count++;
  return { limited: false };
}

/**
 * Check if nonce was already used (replay attack prevention)
 */
function isNonceUsed(nonce: string): boolean {
  // Check if any entry starts with this nonce
  for (const entry of usedNonces) {
    if (entry.startsWith(`${nonce}:`)) {
      return true;
    }
  }
  return false;
}

/**
 * Mark nonce as used with timestamp for expiry tracking
 */
function markNonceUsed(nonce: string): void {
  const entry = `${nonce}:${Date.now()}`;
  usedNonces.add(entry);
  
  // Clean up old nonces periodically (older than NONCE_EXPIRY_MS)
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
    console.log(`[Key-Fetch] Cleaned up ${toDelete.length} expired nonces`);
  }
}

/**
 * Validate key data for known fake patterns
 */
function isFakeKey(keyHex: string): boolean {
  // Known fake key patterns from DLHD servers
  const fakePatterns = [
    '455806f8', // Common fake key prefix
    '45c6497',  // Another fake key prefix
    '00000000', // All zeros
    'ffffffff', // All ones
  ];
  
  return fakePatterns.some(pattern => keyHex.startsWith(pattern));
}

/**
 * Fetch key DIRECTLY with V5 EPlayerAuth authentication
 * No RPI proxy needed - fetches directly from key server!
 * 
 * SECURITY: Includes rate limiting, nonce tracking, and fake key detection
 */
export async function fetchKeyWithAuth(
  keyUrl: string,
  authData?: DLHDAuthDataV5
): Promise<KeyFetchResult> {
  const parsed = parseKeyUrl(keyUrl);
  if (!parsed) {
    return { success: false, error: 'Invalid key URL format' };
  }

  const { resource, keyNumber } = parsed;
  
  // Extract channel for rate limiting
  const channel = extractChannelFromKeyUrl(keyUrl);
  if (!channel) {
    return { success: false, error: 'Cannot extract channel from key URL' };
  }
  
  // SECURITY: Check rate limit
  const rateLimitCheck = checkRateLimit(channel);
  if (rateLimitCheck.limited) {
    return { 
      success: false, 
      error: 'Rate limit exceeded', 
      retryAfter: rateLimitCheck.retryAfter 
    };
  }
  
  // If no auth data provided, fetch it from player page
  let auth = authData;
  if (!auth) {
    console.log(`[Key-Fetch] Fetching auth for channel ${channel}...`);
    const fetchedAuth = await fetchAuthData(channel);
    
    if (!fetchedAuth) {
      return { success: false, error: 'Failed to get auth data' };
    }
    auth = fetchedAuth;
  }
  
  // CRITICAL: Must have channelSalt
  if (!auth.channelSalt) {
    return { success: false, error: 'No channelSalt in auth data' };
  }

  console.log(`[Key-Fetch] ${resource}/${keyNumber} with salt ${auth.channelSalt.substring(0, 16)}...`);

  // Generate auth headers with current time (no offset)
  const headers = await generateKeyHeaders(resource, keyNumber, auth);
  
  // SECURITY: Check nonce reuse (replay attack prevention)
  const nonce = headers['X-Key-Nonce'];
  if (isNonceUsed(nonce)) {
    console.log(`[Key-Fetch] ⚠️ Nonce reuse detected: ${nonce}`);
    return { success: false, error: 'Nonce already used (replay attack?)' };
  }
  
  console.log(`[Key-Fetch] Fetching with timestamp=${headers['X-Key-Timestamp']}, nonce=${nonce}`);

  try {
    const response = await fetch(keyUrl, { headers });

    if (response.ok) {
      const data = await response.arrayBuffer();
      
      if (data.byteLength === 16) {
        const bytes = new Uint8Array(data);
        const keyHex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
        
        // SECURITY: Check for fake key patterns
        if (isFakeKey(keyHex)) {
          console.log(`[Key-Fetch] ⚠️ FAKE key detected: ${keyHex}`);
          return { 
            success: false, 
            error: 'Received fake key from server',
            isFakeKey: true 
          };
        }
        
        // SECURITY: Mark nonce as used
        markNonceUsed(nonce);
        
        console.log(`[Key-Fetch] ✅ Got REAL key: ${keyHex}`);
        return { success: true, data };
      } else {
        return { success: false, error: `Invalid key size: ${data.byteLength} bytes` };
      }
    } else {
      // Handle specific HTTP error codes
      if (response.status === 429) {
        return { 
          success: false, 
          error: 'Server rate limit exceeded', 
          statusCode: 429,
          retryAfter: 60000 // Wait 1 minute
        };
      }
      
      if (response.status === 401 || response.status === 403) {
        return { 
          success: false, 
          error: 'Authentication failed - auth token may be expired', 
          statusCode: response.status 
        };
      }
      
      return { success: false, error: `HTTP ${response.status}`, statusCode: response.status };
    }
  } catch (e) {
    console.log(`[Key-Fetch] Error: ${e}`);
    return { success: false, error: `Fetch failed: ${e}` };
  }
}

/**
 * Fetch key with pre-fetched auth data (for when auth is already available)
 */
export async function fetchKeyDirect(
  keyUrl: string,
  authData: DLHDAuthDataV5
): Promise<KeyFetchResult> {
  return fetchKeyWithAuth(keyUrl, authData);
}
