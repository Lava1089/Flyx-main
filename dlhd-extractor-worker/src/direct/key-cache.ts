/**
 * KV-backed Key Cache + Whitelist Session Manager
 *
 * L1: In-memory Map (per-isolate, instant)
 * L2: Workers KV (global, ~10ms)
 *
 * Also tracks the active whitelist session — which SOCKS5 sticky session
 * is currently whitelisted so all key fetches reuse the same proxy IP.
 */

// =============================================================================
// Key Cache
// =============================================================================

/** In-memory L1 cache (per-isolate) */
const memoryCache = new Map<string, { data: Uint8Array; expiresAt: number }>();

const DEFAULT_KEY_TTL_SEC = 180; // 3 minutes (keys rotate every ~3-5 min)

/**
 * Extract key path from a full key URL.
 * e.g., "https://key.keylocking.ru/key/premium44/5914602" → "/key/premium44/5914602"
 */
export function extractKeyPath(keyUrl: string): string {
  const match = keyUrl.match(/(\/key\/[^?]+)/);
  return match ? match[1] : new URL(keyUrl).pathname;
}

/**
 * Get a cached key from L1 (memory) or L2 (KV).
 * Returns the 16-byte key or null.
 */
export async function getCachedKey(
  kv: KVNamespace | undefined,
  keyPath: string,
): Promise<Uint8Array | null> {
  // L1: in-memory
  const mem = memoryCache.get(keyPath);
  if (mem && Date.now() < mem.expiresAt) {
    console.log(`[KeyCache] L1 hit: ${keyPath}`);
    return mem.data;
  }
  if (mem) memoryCache.delete(keyPath); // expired

  // L2: KV
  if (!kv) return null;
  try {
    const stored = await kv.get(`key:${keyPath}`, 'text');
    if (!stored) return null;

    // Decode base64
    const bytes = Uint8Array.from(atob(stored), c => c.charCodeAt(0));
    if (bytes.length !== 16) return null;

    // Populate L1
    memoryCache.set(keyPath, {
      data: bytes,
      expiresAt: Date.now() + DEFAULT_KEY_TTL_SEC * 1000,
    });
    console.log(`[KeyCache] L2 hit: ${keyPath}`);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Store a key in both L1 (memory) and L2 (KV).
 */
export async function cacheKey(
  kv: KVNamespace | undefined,
  keyPath: string,
  keyData: Uint8Array,
  ttlSeconds: number = DEFAULT_KEY_TTL_SEC,
): Promise<void> {
  // L1
  memoryCache.set(keyPath, {
    data: keyData,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });

  // L2
  if (!kv) return;
  try {
    const b64 = btoa(String.fromCharCode(...keyData));
    await kv.put(`key:${keyPath}`, b64, { expirationTtl: ttlSeconds });
    console.log(`[KeyCache] cached: ${keyPath} (TTL: ${ttlSeconds}s)`);
  } catch (e) {
    console.log(`[KeyCache] KV write error: ${e}`);
  }
}

// =============================================================================
// Whitelist Session Manager
// =============================================================================

const KV_SESSION_KEY = 'whitelist:active';
const SESSION_TTL_SEC = 18 * 60; // 18 min (whitelist valid ~20 min, 2 min buffer)

export interface WhitelistSession {
  /** Sticky session ID passed to the proxy provider */
  proxySessionId: string;
  /** Full username with session ID appended */
  proxyUsername: string;
  /** When the whitelist was established (epoch ms) */
  whitelistedAt: number;
  /** When the whitelist expires (epoch ms) */
  expiresAt: number;
}

/** In-memory session cache */
let activeSessionCache: WhitelistSession | null = null;

/**
 * Get the current active whitelist session.
 * Checks memory first, then KV.
 */
export async function getActiveSession(
  kv: KVNamespace | undefined,
): Promise<WhitelistSession | null> {
  // Check in-memory cache
  if (activeSessionCache && Date.now() < activeSessionCache.expiresAt) {
    return activeSessionCache;
  }
  activeSessionCache = null;

  // Check KV
  if (!kv) return null;
  try {
    const stored = await kv.get(KV_SESSION_KEY, 'text');
    if (!stored) return null;

    const session: WhitelistSession = JSON.parse(stored);
    if (Date.now() >= session.expiresAt) return null;

    activeSessionCache = session;
    console.log(`[KeyCache] restored session: ${session.proxySessionId} (expires in ${Math.round((session.expiresAt - Date.now()) / 60000)}min)`);
    return session;
  } catch {
    return null;
  }
}

/**
 * Save a new whitelist session to memory and KV.
 */
export async function saveSession(
  kv: KVNamespace | undefined,
  session: WhitelistSession,
): Promise<void> {
  activeSessionCache = session;

  if (!kv) return;
  try {
    await kv.put(KV_SESSION_KEY, JSON.stringify(session), {
      expirationTtl: SESSION_TTL_SEC,
    });
    console.log(`[KeyCache] saved session: ${session.proxySessionId}`);
  } catch (e) {
    console.log(`[KeyCache] session save error: ${e}`);
  }
}

/**
 * Check if a session is expiring soon (within threshold).
 */
export function isSessionExpiringSoon(
  session: WhitelistSession,
  thresholdMs: number = 2 * 60 * 1000, // 2 minutes
): boolean {
  return (session.expiresAt - Date.now()) < thresholdMs;
}
