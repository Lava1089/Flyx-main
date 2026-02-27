/**
 * Rate Limiting Middleware
 * No limit for authenticated requests (valid API key).
 * Only rate-limits unauthenticated requests by IP.
 * Requirement: 3.6
 */

import type { ServerResponse } from 'http';
import type { RPIRequest, Middleware } from '../types';
import { sendJsonError } from '../utils';

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const RATE_LIMIT_UNAUTH = 200; // requests per minute
const RATE_WINDOW = 60_000;
const CLEANUP_INTERVAL = 300_000; // 5 minutes

export class RateLimiter {
  private records = new Map<string, RateLimitRecord>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL);
  }

  /** Check if a request is within rate limits */
  check(key: string, isAuthenticated: boolean): boolean {
    if (isAuthenticated) return true;

    const now = Date.now();
    let record = this.records.get(key);

    if (!record || now > record.resetAt) {
      record = { count: 0, resetAt: now + RATE_WINDOW };
    }

    record.count++;
    this.records.set(key, record);
    return record.count <= RATE_LIMIT_UNAUTH;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [ip, record] of this.records.entries()) {
      if (now > record.resetAt) this.records.delete(ip);
    }
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

/** Creates rate-limiting middleware */
export function createRateLimitMiddleware(limiter: RateLimiter): Middleware {
  return (req: RPIRequest, res: ServerResponse, next: () => void) => {
    if (!limiter.check(req.clientIp, req.isAuthenticated)) {
      sendJsonError(res, 429, {
        error: 'Rate limited',
        timestamp: Date.now(),
        details: 'Retry after 60 seconds',
      });
      return;
    }
    next();
  };
}
