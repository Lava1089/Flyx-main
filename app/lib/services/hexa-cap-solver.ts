/**
 * Browser-side Cap.js PoW Solver
 *
 * Solves the Cap.js proof-of-work challenge in the user's browser,
 * similar to how DLHD uses client-side reCAPTCHA whitelisting.
 *
 * The browser solves the PoW → gets a cap token → passes it through
 * the extraction chain to the CF Worker → CF Worker uses it on hexa.su API.
 *
 * Token is cached in sessionStorage with 2.5hr TTL.
 */

const CAP_BASE = 'https://cap.hexa.su/0737428d64';
const CAP_TOKEN_STORAGE_KEY = 'hexa_cap_token';
const CAP_TOKEN_EXPIRES_KEY = 'hexa_cap_expires';

// ---------------------------------------------------------------------------
// PRNG — FNV-1a seed + xorshift (matches @cap.js/server exactly)
// ---------------------------------------------------------------------------

function fnv1a(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

function prng(seed: string, length: number): string {
  let state = fnv1a(seed);
  let result = '';
  function next(): number {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  }
  while (result.length < length) {
    result += next().toString(16).padStart(8, '0');
  }
  return result.substring(0, length);
}

// ---------------------------------------------------------------------------
// SHA-256 using Web Crypto API (available in all modern browsers)
// ---------------------------------------------------------------------------

async function sha256hex(str: string): Promise<string> {
  const data = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Challenge solver
// ---------------------------------------------------------------------------

async function solveChallenge(salt: string, target: string): Promise<number> {
  for (let nonce = 0; ; nonce++) {
    const hash = await sha256hex(`${salt}${nonce}`);
    if (hash.startsWith(target)) return nonce;
    if (nonce > 50_000_000) throw new Error(`PoW timeout`);
  }
}

/**
 * Get a cached cap token from sessionStorage, or null if expired/missing.
 */
export function getCachedCapToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const token = sessionStorage.getItem(CAP_TOKEN_STORAGE_KEY);
    const expiresStr = sessionStorage.getItem(CAP_TOKEN_EXPIRES_KEY);
    if (!token || !expiresStr) return null;
    const expires = parseInt(expiresStr, 10);
    // 5 minute buffer before expiry
    if (Date.now() > expires - 5 * 60 * 1000) return null;
    return token;
  } catch {
    return null;
  }
}

/**
 * Solve Cap.js PoW challenge in the browser and cache the token.
 * Returns the cap token string.
 *
 * This runs in the main thread — takes ~10-30s in a modern browser.
 * The browser's crypto.subtle is hardware-accelerated.
 */
export async function solveCapToken(): Promise<string> {
  // Check cache first
  const cached = getCachedCapToken();
  if (cached) {
    console.log('[Cap] Using cached token');
    return cached;
  }

  console.log('[Cap] Solving PoW challenge in browser...');
  const startTime = Date.now();

  // Step 1: Get challenge
  const challengeRes = await fetch(`${CAP_BASE}/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  if (!challengeRes.ok) {
    throw new Error(`Cap challenge failed: HTTP ${challengeRes.status}`);
  }

  const { challenge, token: challengeToken } = await challengeRes.json();
  const { c: count, s: saltSize, d: difficulty } = challenge;
  console.log(`[Cap] Challenge: ${count} puzzles, difficulty ${difficulty}`);

  // Step 2: Generate challenge pairs using FULL JWT token as PRNG seed
  const challenges: Array<[string, string]> = [];
  for (let i = 1; i <= count; i++) {
    const salt = prng(`${challengeToken}${i}`, saltSize);
    const target = prng(`${challengeToken}${i}d`, difficulty);
    challenges.push([salt, target]);
  }

  // Step 3: Solve all challenges
  const solutions: number[] = [];
  for (let i = 0; i < count; i++) {
    const [salt, target] = challenges[i];
    const nonce = await solveChallenge(salt, target);
    solutions.push(nonce);
  }

  console.log(`[Cap] Solved ${count} puzzles in ${Date.now() - startTime}ms`);

  // Step 4: Redeem solutions for cap token
  const redeemRes = await fetch(`${CAP_BASE}/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: challengeToken, solutions }),
  });

  if (!redeemRes.ok) {
    throw new Error(`Cap redeem failed: HTTP ${redeemRes.status}`);
  }

  const redeemData = await redeemRes.json();
  if (!redeemData.success || !redeemData.token) {
    throw new Error(`Cap redeem rejected: ${JSON.stringify(redeemData)}`);
  }

  // Cache in sessionStorage (2.5hr TTL)
  const token = redeemData.token;
  const expires = redeemData.expires || (Date.now() + 2.5 * 60 * 60 * 1000);
  try {
    sessionStorage.setItem(CAP_TOKEN_STORAGE_KEY, token);
    sessionStorage.setItem(CAP_TOKEN_EXPIRES_KEY, expires.toString());
  } catch { /* sessionStorage might be full or disabled */ }

  console.log(`[Cap] Token obtained in ${Date.now() - startTime}ms, expires ${new Date(expires).toISOString()}`);
  return token;
}

/**
 * Get a cap token — cached or freshly solved.
 * This is the main entry point for the extraction flow.
 */
export async function getCapToken(): Promise<string | null> {
  try {
    return await solveCapToken();
  } catch (e) {
    console.error('[Cap] Failed to solve:', e instanceof Error ? e.message : e);
    return null;
  }
}
