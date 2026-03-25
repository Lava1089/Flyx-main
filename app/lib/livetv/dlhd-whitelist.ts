/**
 * DLHD Client-Side Whitelist
 *
 * Whitelists the user's IP for DLHD key fetching without loading any
 * Google reCAPTCHA scripts, tracking pixels, or third-party content.
 *
 * Flow (updated March 24, 2026):
 *   1. Browser calls CF worker: /tv/whitelist/verify?channel=premiumXXX
 *   2. CF worker solves reCAPTCHA v3 server-side, POSTs token to
 *      ai.the-sunmoon.site/verify with proper Origin/Referer headers
 *   3. CF worker returns whitelist result to browser
 *   4. HLS.js fetches keys — server-side key proxy as fallback
 *
 * IMPORTANT: The verify request MUST go through the CF worker, not directly
 * from the browser. Browsers cannot spoof Origin headers, and DLHD's verify
 * endpoint rejects non-DLHD origins with 403 "unauthorized_domain".
 *
 * Privacy: Zero Google JS loads in the browser.
 */

const WHITELIST_TTL_MS = 20 * 60 * 1000; // 20 min (DLHD re-verifies every 20 min now)

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
      // Single call to CF worker which handles:
      //   1. reCAPTCHA v3 solve (server-side)
      //   2. POST to ai.the-sunmoon.site/verify with proper Origin/Referer
      //   3. Returns whitelist result
      //
      // This CANNOT be done directly from the browser because:
      //   - Browsers enforce Origin header = actual page origin (e.g. flyx.tv)
      //   - DLHD's verify endpoint rejects non-DLHD origins with 403
      //   - Only a server-side proxy can set Origin: https://enviromentalspace.sbs
      const verifyResp = await fetch(
        `${this.proxyBase}/tv/whitelist/verify?channel=${channel}`,
        { credentials: 'omit' }
      );

      if (!verifyResp.ok) {
        const err = await verifyResp.json().catch(() => ({})) as any;
        return { success: false, error: err.error || `HTTP ${verifyResp.status}` };
      }

      const verifyData = await verifyResp.json() as {
        success?: boolean; ip?: string; error?: string; message?: string;
      };

      if (verifyData.success) {
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
