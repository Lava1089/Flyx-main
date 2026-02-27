"use strict";
/**
 * Rate Limiting Middleware
 * No limit for authenticated requests (valid API key).
 * Only rate-limits unauthenticated requests by IP.
 * Requirement: 3.6
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimiter = void 0;
exports.createRateLimitMiddleware = createRateLimitMiddleware;
const utils_1 = require("../utils");
const RATE_LIMIT_UNAUTH = 200; // requests per minute
const RATE_WINDOW = 60_000;
const CLEANUP_INTERVAL = 300_000; // 5 minutes
class RateLimiter {
    records = new Map();
    cleanupTimer = null;
    constructor() {
        this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL);
    }
    /** Check if a request is within rate limits */
    check(key, isAuthenticated) {
        if (isAuthenticated)
            return true;
        const now = Date.now();
        let record = this.records.get(key);
        if (!record || now > record.resetAt) {
            record = { count: 0, resetAt: now + RATE_WINDOW };
        }
        record.count++;
        this.records.set(key, record);
        return record.count <= RATE_LIMIT_UNAUTH;
    }
    cleanup() {
        const now = Date.now();
        for (const [ip, record] of this.records.entries()) {
            if (now > record.resetAt)
                this.records.delete(ip);
        }
    }
    destroy() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }
}
exports.RateLimiter = RateLimiter;
/** Creates rate-limiting middleware */
function createRateLimitMiddleware(limiter) {
    return (req, res, next) => {
        if (!limiter.check(req.clientIp, req.isAuthenticated)) {
            (0, utils_1.sendJsonError)(res, 429, {
                error: 'Rate limited',
                timestamp: Date.now(),
                details: 'Retry after 60 seconds',
            });
            return;
        }
        next();
    };
}
//# sourceMappingURL=rate-limit.js.map