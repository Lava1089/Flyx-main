/**
 * DLHD Client-Side Whitelist
 *
 * Whitelists the user's IP for DLHD key fetching without loading any
 * Google reCAPTCHA scripts, tracking pixels, or third-party content.
 *
 * Flow:
 *   1. GET /whitelist/token → CF worker solves reCAPTCHA v3 server-side
 *   2. Browser POSTs token directly to chevy.soyspace.cyou/verify
 *      → User's own IP gets whitelisted (CORS is *, so this works)
 *   3. HLS.js fetches keys directly from CDN — no proxy needed
 *
 * Privacy: Zero Google JS loads in the browser. The CF worker talks to
 * Google on the user's behalf, and only a clean JSON token is returned.
 */

const VERIFY_URL = 'https://chevy.soyspace.cyou/verify';
const WHITELIST_TTL_MS = 25 * 60 * 1000; // 25 min (actual ~30, leave buffer)

interface WhitelistResult {
  success: boolean;
  ip?: string;
  error?: string;
  retryAfter?: number;
}

interface CacheEntry {
  whitelistedAt: number;
  expiresAt: number;
}

export class DLHDWhitelist {
  private proxyBase: string;
  private cache: Map<string, CacheEntry> = new Map();

  constructor(proxyBase: string) {
    this.proxyBase = proxyBase.replace(/\/+$/, '').replace(/\/tv$/, '');
  }

  /**
   * Whitelist the user's IP for a channel.
   * Skips if already whitelisted and not expired.
   */
  async whitelist(channel: string): Promise<WhitelistResult> {
    if (/^\d+$/.test(channel)) channel = `premium${channel}`;

    const cached = this.cache.get(channel);
    if (cached && Date.now() < cached.expiresAt) {
      return { success: true };
    }

    try {
      // Step 1: CF worker solves reCAPTCHA server-side, returns token
      const tokenResp = await fetch(
        `${this.proxyBase}/tv/whitelist/token?channel=${channel}`,
        { credentials: 'omit' }
      );

      if (!tokenResp.ok) {
        const err = await tokenResp.json().catch(() => ({})) as any;
        return { success: false, error: err.error || `HTTP ${tokenResp.status}` };
      }

      const tokenData = await tokenResp.json() as {
        success: boolean; token?: string; channel_id?: string; error?: string;
      };

      if (!tokenData.success || !tokenData.token) {
        return { success: false, error: tokenData.error || 'No token' };
      }

      // Step 2: Browser POSTs directly to upstream verify — whitelists THIS IP
      // CORS is * on chevy.soyspace.cyou so this works from any origin
      const verifyResp = await fetch(VERIFY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://www.ksohls.ru',
          'Referer': 'https://www.ksohls.ru/',
        },
        credentials: 'omit',
        body: JSON.stringify({
          'recaptcha-token': tokenData.token,
          'channel_id': tokenData.channel_id,
        }),
      });

      const verifyData = await verifyResp.json() as {
        success?: boolean; ip?: string; error?: string; message?: string;
      };

      if (verifyData.success) {
        // SECURITY NOTE: If verifyData.ip is present, it shows which IP was whitelisted.
        // If the CF worker's IP was whitelisted instead of the user's, key fetches will
        // still return fake keys. The caller should verify by attempting a key fetch
        // after whitelist and falling back to direct POST if keys are still fake.
        
        this.cache.set(channel, {
          whitelistedAt: Date.now(),
          expiresAt: Date.now() + WHITELIST_TTL_MS,
        });
        return { success: true, ip: verifyData.ip };
      }

      if (verifyData.error === 'channel_limit_exceeded') {
        const waitMatch = verifyData.message?.match(/opens in (\d+)s/);
        return {
          success: false,
          error: 'channel_limit_exceeded',
          retryAfter: waitMatch ? parseInt(waitMatch[1]) : 30,
        };
      }

      return { success: false, error: verifyData.error || 'Verify failed' };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /** Whitelist with auto-retry on rate limit */
  async whitelistWithRetry(channel: string, maxRetries = 2): Promise<WhitelistResult> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const result = await this.whitelist(channel);
      if (result.success) return result;

      if (result.error === 'channel_limit_exceeded' && result.retryAfter && attempt < maxRetries) {
        await new Promise(r => setTimeout(r, (result.retryAfter! + 2) * 1000));
        continue;
      }
      return result;
    }
    return { success: false, error: 'Max retries exceeded' };
  }

  isWhitelisted(channel: string): boolean {
    if (/^\d+$/.test(channel)) channel = `premium${channel}`;
    const c = this.cache.get(channel);
    return !!c && Date.now() < c.expiresAt;
  }

  get activeChannels(): number {
    const now = Date.now();
    let n = 0;
    for (const e of this.cache.values()) if (now < e.expiresAt) n++;
    return n;
  }
}
