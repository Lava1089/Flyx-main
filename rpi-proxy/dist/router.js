"use strict";
/**
 * Path-based Router with Middleware Chain
 * Matches request paths to route handlers and runs middleware before dispatch.
 * Requirements: 3.2, 3.7
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Router = void 0;
const utils_1 = require("./utils");
class Router {
    routes = [];
    middlewares = [];
    /** Register a global middleware */
    use(middleware) {
        this.middlewares.push(middleware);
    }
    /** Register a route handler for an exact path */
    route(path, handler) {
        this.routes.push({ path, handler });
    }
    /**
     * Find the matching route for a given pathname.
     * Uses exact match — routes are checked in registration order.
     */
    match(pathname) {
        return this.routes.find(r => r.path === pathname);
    }
    /** Handle an incoming HTTP request */
    async handle(raw, res) {
        // CORS preflight
        if (raw.method === 'OPTIONS') {
            res.writeHead(200, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'X-API-Key, Content-Type',
            });
            res.end();
            return;
        }
        if (raw.method !== 'GET') {
            (0, utils_1.sendJsonError)(res, 405, { error: 'Method not allowed', timestamp: Date.now() });
            return;
        }
        const host = raw.headers.host ?? 'localhost';
        const url = new URL(raw.url ?? '/', `http://${host}`);
        const clientIp = raw.headers['x-forwarded-for']?.split(',')[0]?.trim() ??
            raw.socket.remoteAddress ??
            'unknown';
        const req = {
            raw,
            url,
            clientIp,
            apiKey: null,
            isAuthenticated: false,
        };
        // Run middleware chain
        let middlewareIndex = 0;
        const runNext = () => {
            if (res.headersSent)
                return;
            if (middlewareIndex < this.middlewares.length) {
                const mw = this.middlewares[middlewareIndex++];
                // Middleware may be sync or async — handle both
                const result = mw(req, res, runNext);
                if (result instanceof Promise) {
                    result.catch(err => {
                        console.error('[Middleware Error]', err);
                        (0, utils_1.sendJsonError)(res, 500, { error: 'Internal server error', timestamp: Date.now() });
                    });
                }
            }
            else {
                // All middleware passed — dispatch to route
                this.dispatch(req, res);
            }
        };
        runNext();
    }
    /** Dispatch to the matching route handler */
    async dispatch(req, res) {
        if (res.headersSent)
            return;
        // Health check — built-in, no route registration needed
        if (req.url.pathname === '/health') {
            (0, utils_1.sendJson)(res, 200, {
                status: 'ok',
                timestamp: Date.now(),
                method: 'FRESH-AUTH-EVERY-REQUEST',
                caching: 'DISABLED for keys/auth/m3u8',
            });
            return;
        }
        const matched = this.match(req.url.pathname);
        if (!matched) {
            (0, utils_1.sendJsonError)(res, 404, { error: 'Not found', timestamp: Date.now() });
            return;
        }
        try {
            await matched.handler(req, res);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            console.error(`[Route Error] ${req.url.pathname}: ${message}`);
            (0, utils_1.sendJsonError)(res, 500, {
                error: 'Internal server error',
                timestamp: Date.now(),
                details: message,
            });
        }
    }
    /** Get all registered route paths (useful for debugging / tests) */
    getRegisteredPaths() {
        return this.routes.map(r => r.path);
    }
}
exports.Router = Router;
//# sourceMappingURL=router.js.map