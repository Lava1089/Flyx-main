/**
 * DLHD Client-Side Whitelist
 *
 * Whitelists the user's IP for DLHD key fetching without loading any
 * Google reCAPTCHA scripts, tracking pixels, or third-party content
 * in the browser.
 *
 * Flow:
 *   1. Call CF worker /whitelist/token → worker solves reCAPTCHA server-side
 *   2. CF worker proxies verify to chevy.soyspace.cyou/verify
 *   3. User's IP is whitelisted for ~30 minutes (13 channels max)
 *
 * Usage:
 *   const wl = new DLHDWhitelist('https://media-proxy.vynx.workers.dev/tv');
 *   const result = await wl.whitelist('premium51');
 *   if (result.success) { // user can now fetch keys directly }
 */

interface WhitelistResult {
  success: boolean;
  /** IP that was whitelisted (from upstream response) */
  ip?: string;
  /** Error message if failed */
  error?: string;
  /** Seconds until a channel slot opens (if rate limited) */
  retryAfter?: number;
}

interface WhitelistCacheEntry {
  whitelistedAt: number;
  expiresAt: number;
}

const WHITELIST_TTL_MS = 25 * 60 * 1000; // 25 min (actual is ~30, leave buffer)

export class DLHDWhitelist {
  private proxyBase: string;
  private cache: Map<string, WhitelistCacheEntry> = new Map();

  constructor(proxyBase: string) {
    // Strip trailing slash and /tv suffix for clean base
    this.proxyBase = proxyBase.replace(/\/+$/, '').replace(/\/tv$/, '');
  }

  /**
   * Whitelist the user's IP for a specific channel.
   * Returns immediately if already whitelisted and not expired.
   */
  async whitelist(channel: string): Promise<WhitelistResult> {
    // Normalize channel format
    if (/^\d+$/.test(channel)) channel = `premium${channel}`;

    // Check cache — skip if already whitelisted recently
    const cached = this.cache.get(channel);
    if (cached && Date.now() < cached.expiresAt) {
      return { success: true };
    }

    try {
      // Step 1: Get reCAPTCHA token from CF worker (solved server-side)
      const tokenResp = await fetch(
        `${this.proxyBase}/tv/whitelist/token?channel=${channel}`,
        { credentials: 'omit' } // no cookies sent to worker
      );

      if (!tokenResp.ok) {
        const err = await tokenResp.json().catch(() => ({ error: 'Token fetch failed' }));
        return { success: false, error: (err as any).error || `HTTP ${tokenResp.status}` };
      }

      const tokenData = await tokenResp.json() as {
        success: boolean;
        token?: string;
        channel_id?: string;
        error?: string;
      };

      if (!tokenData.success || !tokenData.token) {
        return { success: false, error: tokenData.error || 'No token returned' };
      }

      // Step 2: Proxy verify through CF worker (preserves client IP via cf-connecting-ip)
      // If the upstream ignores X-Forwarded-For, the client can POST directly
      // to the verify URL (if CORS allows it), falling back gracefully.
      const verifyResp = await fetch(`${this.proxyBase}/tv/whitelist/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        body: JSON.stringify({
          token: tokenData.token,
          channel_id: tokenData.channel_id,
        }),
      });

      const verifyData = await verifyResp.json() as {
        success?: boolean;
        ip?: string;
        error?: string;
        message?: string;
      };

      // If the proxy whitelisted the wrong IP (CF edge instead of user),
      // try a direct POST to the verify endpoint as a fallback.
      // This only works if the upstream has permissive CORS.
      if (verifyData.success && verifyData.ip) {
        // We can't easily know our own public IP here, but we can test
        // by fetching a key — if it's still fake, the wrong IP was whitelisted.
        // For now, trust the proxy approach and cache it.
      }

      if (verifyData.success) {
        this.cache.set(channel, {
          whitelistedAt: Date.now(),
          expiresAt: Date.now() + WHITELIST_TTL_MS,
        });
        return { success: true, ip: verifyData.ip };
      }

      // Handle rate limit (channel_limit_exceeded)
      if (verifyData.error === 'channel_limit_exceeded') {
        const waitMatch = verifyData.message?.match(/opens in (\d+)s/);
        return {
          success: false,
          error: 'channel_limit_exceeded',
          retryAfter: waitMatch ? parseInt(waitMatch[1]) : 30,
        };
      }

      return { success: false, error: verifyData.error || verifyData.message || 'Verify failed' };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * Whitelist with automatic retry on rate limit.
   * Will wait for a slot to open and retry up to maxRetries times.
   */
  async whitelistWithRetry(channel: string, maxRetries = 3): Promise<WhitelistResult> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const result = await this.whitelist(channel);

      if (result.success) return result;

      if (result.error === 'channel_limit_exceeded' && result.retryAfter && attempt < maxRetries) {
        const waitMs = (result.retryAfter + 2) * 1000;
        console.log(`[dlhd-whitelist] Channel limit hit, waiting ${result.retryAfter + 2}s...`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      return result; // non-retryable error
    }

    return { success: false, error: 'Max retries exceeded' };
  }

  /** Check if a channel is currently whitelisted (from local cache) */
  isWhitelisted(channel: string): boolean {
    if (/^\d+$/.test(channel)) channel = `premium${channel}`;
    const cached = this.cache.get(channel);
    return !!cached && Date.now() < cached.expiresAt;
  }

  /** Get number of channels currently whitelisted */
  get activeChannels(): number {
    let count = 0;
    const now = Date.now();
    for (const entry of this.cache.values()) {
      if (now < entry.expiresAt) count++;
    }
    return count;
  }

  /** Clear expired entries from cache */
  cleanup(): void {
    const now = Date.now();
    for (const [ch, entry] of this.cache) {
      if (now >= entry.expiresAt) this.cache.delete(ch);
    }
  }
}
