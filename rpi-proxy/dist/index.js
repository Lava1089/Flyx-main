"use strict";
/**
 * RPI Proxy — TypeScript Entry Point
 * Creates the HTTP server, registers all routes, applies middleware, and starts listening.
 * Requirements: 3.1, 3.7
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.server = exports.router = void 0;
const http_1 = __importDefault(require("http"));
const router_1 = require("./router");
const config_1 = require("./services/config");
const auth_1 = require("./middleware/auth");
const rate_limit_1 = require("./middleware/rate-limit");
const logger_1 = require("./middleware/logger");
const socks5_pool_1 = require("./services/socks5-pool");
const socks5_pool_2 = require("./services/socks5-pool");
const utils_1 = require("./utils");
// Route handlers
const proxy_1 = require("./routes/proxy");
const dlhd_1 = require("./routes/dlhd");
const animekai_1 = require("./routes/animekai");
const viprow_1 = require("./routes/viprow");
const ppv_1 = require("./routes/ppv");
const iptv_1 = require("./routes/iptv");
const socks5_1 = require("./routes/socks5");
const stream_proxy_1 = require("./routes/stream-proxy");
// ============================================================================
// Bootstrap
// ============================================================================
const config = (0, config_1.loadConfig)();
const router = new router_1.Router();
exports.router = router;
const rateLimiter = new rate_limit_1.RateLimiter();
// ---- Middleware (order matters) ----
router.use((0, logger_1.createLoggerMiddleware)());
router.use((0, auth_1.createAuthMiddleware)(config.apiKey));
router.use((0, rate_limit_1.createRateLimitMiddleware)(rateLimiter));
// ---- Routes ----
// Generic proxy
router.route('/proxy', proxy_1.handleProxy);
// DLHD
router.route('/dlhd-key-v4', dlhd_1.handleDLHDKeyV4);
router.route('/dlhd-key-v6', dlhd_1.handleDLHDKeyV6);
router.route('/dlhd-key', dlhd_1.handleDLHDKey);
router.route('/dlhd-whitelist', dlhd_1.handleDLHDWhitelist);
router.route('/dlhd/restream', dlhd_1.handleDLHDRestream);
router.route('/heartbeat', dlhd_1.handleHeartbeat);
// AnimeKai
router.route('/animekai', animekai_1.handleAnimeKai);
// VIPRow
router.route('/viprow/stream', viprow_1.handleVIPRowStream);
router.route('/viprow/manifest', viprow_1.handleVIPRowManifest);
router.route('/viprow/key', viprow_1.handleVIPRowKey);
router.route('/viprow/segment', viprow_1.handleVIPRowSegment);
// PPV
router.route('/ppv', ppv_1.handlePPV);
// IPTV
router.route('/iptv/api', iptv_1.handleIPTVApi);
router.route('/iptv/stream', iptv_1.handleIPTVStream);
// Stream proxies (flixer, hianime, dlhd, vidlink, vidsrc, 1movies)
for (const path of stream_proxy_1.STREAM_PROXY_PATHS) {
    router.route(path, (0, stream_proxy_1.createStreamProxyHandler)(path));
}
// SOCKS5 / Fetch
router.route('/fetch-socks5', socks5_1.handleFetchSocks5);
router.route('/fetch', socks5_1.handleFetch);
// Debug endpoint for SOCKS5 pool status
router.route('/debug/socks5-pool', (_req, res) => {
    (0, utils_1.sendJson)(res, 200, (0, socks5_pool_2.getPoolStatus)());
});
// ---- HTTP Server ----
const server = http_1.default.createServer((req, res) => {
    router.handle(req, res);
});
exports.server = server;
server.listen(config.port, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║  RPI Proxy v4.0 (TypeScript)                             ║
║  Port: ${String(config.port).padEnd(49)}║
║  Auth: API key required for all endpoints                ║
║  Caching: DISABLED for keys/auth/m3u8                    ║
╚═══════════════════════════════════════════════════════════╝
`);
});
// Start SOCKS5 proxy pool refresh
(0, socks5_pool_1.startPoolRefresh)();
//# sourceMappingURL=index.js.map