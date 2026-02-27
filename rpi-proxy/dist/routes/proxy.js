"use strict";
/**
 * Generic /proxy route handler
 * Proxies requests to allowed domains from residential IP.
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleProxy = handleProxy;
const https_1 = __importDefault(require("https"));
const http_1 = __importDefault(require("http"));
const utils_1 = require("../utils");
const domain_allowlist_1 = require("../services/domain-allowlist");
async function handleProxy(req, res) {
    const targetUrl = req.url.searchParams.get('url');
    if (!targetUrl) {
        (0, utils_1.sendJsonError)(res, 400, { error: 'Missing url parameter', timestamp: Date.now() });
        return;
    }
    let decoded;
    try {
        decoded = decodeURIComponent(targetUrl);
    }
    catch {
        (0, utils_1.sendJsonError)(res, 400, { error: 'Invalid URL', timestamp: Date.now() });
        return;
    }
    if (!(0, domain_allowlist_1.isAllowedProxyDomain)(decoded)) {
        (0, utils_1.sendJsonError)(res, 403, { error: 'Domain not allowed', timestamp: Date.now() });
        return;
    }
    const url = new URL(decoded);
    const client = url.protocol === 'https:' ? https_1.default : http_1.default;
    const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': '*/*',
        },
        timeout: 30000,
    };
    const proxyReq = client.request(options, (proxyRes) => {
        const contentType = proxyRes.headers['content-type'] ?? 'application/octet-stream';
        const chunks = [];
        proxyRes.on('data', (chunk) => chunks.push(chunk));
        proxyRes.on('end', () => {
            const data = Buffer.concat(chunks);
            res.writeHead(proxyRes.statusCode ?? 502, {
                'Content-Type': contentType,
                'Content-Length': data.length,
                'Access-Control-Allow-Origin': '*',
            });
            res.end(data);
        });
    });
    proxyReq.on('error', (err) => {
        (0, utils_1.sendJsonError)(res, 502, { error: 'Proxy error', details: err.message, timestamp: Date.now() });
    });
    proxyReq.on('timeout', () => {
        proxyReq.destroy();
        (0, utils_1.sendJsonError)(res, 504, { error: 'Timeout', timestamp: Date.now() });
    });
    proxyReq.end();
}
//# sourceMappingURL=proxy.js.map