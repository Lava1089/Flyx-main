"use strict";
/**
 * API Key Authentication Middleware
 * Uses timing-safe comparison to prevent timing attacks.
 * Requirement: 3.6
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.timingSafeApiKeyCheck = timingSafeApiKeyCheck;
exports.createAuthMiddleware = createAuthMiddleware;
const crypto_1 = __importDefault(require("crypto"));
const utils_1 = require("../utils");
/** Allowed origins for CORS validation */
const ALLOWED_ORIGINS = [
    'https://tv.vynx.cc',
    'https://flyx.tv',
    'https://www.flyx.tv',
    'http://localhost:3000',
    'http://localhost:3001',
];
const ALLOWED_ORIGIN_PATTERNS = [
    /\.vercel\.app$/,
    /\.pages\.dev$/,
    /\.workers\.dev$/,
];
function isAllowedOrigin(origin) {
    if (!origin)
        return false;
    if (ALLOWED_ORIGINS.includes(origin))
        return true;
    try {
        const hostname = new URL(origin).hostname;
        return ALLOWED_ORIGIN_PATTERNS.some(p => p.test(hostname));
    }
    catch {
        return false;
    }
}
/** Timing-safe API key comparison */
function timingSafeApiKeyCheck(provided, expected) {
    if (typeof provided !== 'string' || typeof expected !== 'string')
        return false;
    const maxLen = Math.max(provided.length, expected.length);
    const paddedProvided = provided.padEnd(maxLen, '\0');
    const paddedExpected = expected.padEnd(maxLen, '\0');
    try {
        return (crypto_1.default.timingSafeEqual(Buffer.from(paddedProvided), Buffer.from(paddedExpected)) &&
            provided.length === expected.length);
    }
    catch {
        return false;
    }
}
/**
 * Creates auth middleware that validates API key and origin.
 * Skips auth for /health endpoint.
 */
function createAuthMiddleware(apiKey) {
    return (req, res, next) => {
        // Health check — no auth required
        if (req.url.pathname === '/health') {
            next();
            return;
        }
        // Validate API key
        const providedKey = req.raw.headers['x-api-key'] ?? req.url.searchParams.get('key');
        if (!timingSafeApiKeyCheck(providedKey, apiKey)) {
            (0, utils_1.sendJsonError)(res, 401, { error: 'Unauthorized', timestamp: Date.now() });
            return;
        }
        req.apiKey = providedKey;
        req.isAuthenticated = true;
        // Validate origin
        const origin = req.raw.headers['origin'];
        const forwardedOrigin = req.raw.headers['x-forwarded-origin'];
        const referer = req.raw.headers['referer'];
        let originAllowed = isAllowedOrigin(origin) || isAllowedOrigin(forwardedOrigin);
        if (!originAllowed && referer) {
            try {
                originAllowed = isAllowedOrigin(new URL(referer).origin);
            }
            catch { /* ignore */ }
        }
        // Allow server-to-server calls with valid API key but no origin
        if (!originAllowed && !origin && !forwardedOrigin) {
            originAllowed = true;
        }
        if (!originAllowed) {
            (0, utils_1.sendJsonError)(res, 403, { error: 'Origin not allowed', timestamp: Date.now() });
            return;
        }
        next();
    };
}
//# sourceMappingURL=auth.js.map