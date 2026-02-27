"use strict";
/**
 * Request Logging Middleware
 * Logs method, path, client IP, and response time.
 * Requirement: 3.6
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLoggerMiddleware = createLoggerMiddleware;
function createLoggerMiddleware() {
    return (req, res, next) => {
        const start = Date.now();
        const { method } = req.raw;
        const path = req.url.pathname;
        res.on('finish', () => {
            const elapsed = Date.now() - start;
            console.log(`[${method}] ${path} ${res.statusCode} ${elapsed}ms — ${req.clientIp}`);
        });
        next();
    };
}
//# sourceMappingURL=logger.js.map