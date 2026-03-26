/**
 * RPI Proxy — TypeScript Entry Point
 * Creates the HTTP server, registers all routes, applies middleware, and starts listening.
 * Requirements: 3.1, 3.7
 */

import http from 'http';
import { Router } from './router';
import { loadConfig } from './services/config';
import { createAuthMiddleware } from './middleware/auth';
import { RateLimiter, createRateLimitMiddleware } from './middleware/rate-limit';
import { createLoggerMiddleware } from './middleware/logger';
import { startPoolRefresh } from './services/socks5-pool';
import { getPoolStatus } from './services/socks5-pool';
import { sendJson } from './utils';

// Route handlers
import { handleProxy } from './routes/proxy';
import { handleDLHDKeyV4, handleDLHDKey, handleDLHDKeyV6, handleDLHDWhitelist, handleHeartbeat, handleDLHDRestream } from './routes/dlhd';
import { handleAnimeKai } from './routes/animekai';
import { handleVIPRowStream, handleVIPRowManifest, handleVIPRowKey, handleVIPRowSegment } from './routes/viprow';
import { handlePPV } from './routes/ppv';
import { handleIPTVApi, handleIPTVStream } from './routes/iptv';
import { handleFetchSocks5, handleFetch } from './routes/socks5';
import { createStreamProxyHandler, STREAM_PROXY_PATHS } from './routes/stream-proxy';

// ============================================================================
// Bootstrap
// ============================================================================

const config = loadConfig();
const router = new Router();
const rateLimiter = new RateLimiter();

// ---- Middleware (order matters) ----
router.use(createLoggerMiddleware());
router.use(createAuthMiddleware(config.apiKey));
router.use(createRateLimitMiddleware(rateLimiter));

// ---- Routes ----
// Generic proxy
router.route('/proxy', handleProxy);

// DLHD
router.route('/dlhd-key-v4', handleDLHDKeyV4);
router.route('/dlhd-key-v6', handleDLHDKeyV6);
router.route('/dlhd-key', handleDLHDKey);
router.route('/dlhd-whitelist', handleDLHDWhitelist);
router.route('/dlhd/restream', handleDLHDRestream);
router.route('/heartbeat', handleHeartbeat);

// AnimeKai
router.route('/animekai', handleAnimeKai);

// VIPRow
router.route('/viprow/stream', handleVIPRowStream);
router.route('/viprow/manifest', handleVIPRowManifest);
router.route('/viprow/key', handleVIPRowKey);
router.route('/viprow/segment', handleVIPRowSegment);

// PPV
router.route('/ppv', handlePPV);

// IPTV
router.route('/iptv/api', handleIPTVApi);
router.route('/iptv/stream', handleIPTVStream);

// Stream proxies (flixer, hianime, dlhd, vidlink, vidsrc, 1movies)
for (const path of STREAM_PROXY_PATHS) {
  router.route(path, createStreamProxyHandler(path));
}

// SOCKS5 / Fetch
router.route('/fetch-socks5', handleFetchSocks5);
router.route('/fetch', handleFetch);

// Debug endpoint for SOCKS5 pool status
router.route('/debug/socks5-pool', (_req, res) => {
  sendJson(res, 200, getPoolStatus());
});

// ---- HTTP Server ----
const server = http.createServer((req, res) => {
  router.handle(req, res);
});

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
startPoolRefresh();

export { router, server };
