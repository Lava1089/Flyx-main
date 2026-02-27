/**
 * Rate Limiting Middleware
 * No limit for authenticated requests (valid API key).
 * Only rate-limits unauthenticated requests by IP.
 * Requirement: 3.6
 */
import type { Middleware } from '../types';
export declare class RateLimiter {
    private records;
    private cleanupTimer;
    constructor();
    /** Check if a request is within rate limits */
    check(key: string, isAuthenticated: boolean): boolean;
    private cleanup;
    destroy(): void;
}
/** Creates rate-limiting middleware */
export declare function createRateLimitMiddleware(limiter: RateLimiter): Middleware;
//# sourceMappingURL=rate-limit.d.ts.map