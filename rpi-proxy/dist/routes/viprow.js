"use strict";
/**
 * VIPRow route handlers
 * /viprow/stream, /viprow/manifest, /viprow/key, /viprow/segment
 * boanki.net blocks CF Workers — extraction done from residential IP.
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleVIPRowStream = handleVIPRowStream;
exports.handleVIPRowManifest = handleVIPRowManifest;
exports.handleVIPRowKey = handleVIPRowKey;
exports.handleVIPRowSegment = handleVIPRowSegment;
const https_1 = __importDefault(require("https"));
const utils_1 = require("../utils");
const VIPROW_ALLOWED_DOMAINS = ['boanki.net', 'peulleieo.net', 'casthill.net', 'viprow.nu'];
function isVIPRowAllowedUrl(url) {
    try {
        const hostname = new URL(url).hostname;
        return VIPROW_ALLOWED_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
    }
    catch {
        return false;
    }
}
function viprowFetch(targetUrl, referer) {
    return new Promise((resolve, reject) => {
        const url = new URL(targetUrl);
        const req = https_1.default.request({
            hostname: url.hostname,
            port: 443,
            path: url.pathname + url.search,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                Accept: '*/*',
                Referer: referer ?? 'https://viprow.nu/',
            },
            timeout: 15000,
            rejectUnauthorized: false,
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => resolve({ status: res.statusCode ?? 502, body: data }));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        req.end();
    });
}
/** /viprow/stream — Full VIPRow stream extraction */
async function handleVIPRowStream(req, res) {
    const eventUrl = req.url.searchParams.get('url');
    const linkNum = req.url.searchParams.get('link') ?? '1';
    const cfProxy = req.url.searchParams.get('cf_proxy');
    if (!eventUrl) {
        (0, utils_1.sendJsonError)(res, 400, {
            error: 'Missing url parameter',
            details: '/viprow/stream?url=/nba/event-online-stream&link=1&cf_proxy=https://media-proxy.example.com',
            timestamp: Date.now(),
        });
        return;
    }
    try {
        // Construct full stream page URL
        const streamPageUrl = eventUrl.startsWith('http')
            ? eventUrl
            : `https://viprow.nu${eventUrl}`;
        const pageResp = await viprowFetch(streamPageUrl);
        if (pageResp.status !== 200) {
            (0, utils_1.sendJsonError)(res, 502, { error: 'Failed to fetch VIPRow page', details: `HTTP ${pageResp.status}`, timestamp: Date.now() });
            return;
        }
        // Extract m3u8 URL from page (simplified — the real logic is complex)
        const m3u8Match = pageResp.body.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/);
        if (!m3u8Match) {
            (0, utils_1.sendJsonError)(res, 502, { error: 'No m3u8 URL found in VIPRow page', timestamp: Date.now() });
            return;
        }
        (0, utils_1.sendJson)(res, 200, { success: true, m3u8_url: m3u8Match[0], source: 'rpi-viprow' });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        (0, utils_1.sendJsonError)(res, 500, { error: 'VIPRow extraction failed', details: message, timestamp: Date.now() });
    }
}
/** /viprow/manifest — Proxy manifest with URL rewriting */
async function handleVIPRowManifest(req, res) {
    const manifestUrl = req.url.searchParams.get('url');
    if (!manifestUrl) {
        (0, utils_1.sendJsonError)(res, 400, { error: 'Missing url parameter', timestamp: Date.now() });
        return;
    }
    const decoded = decodeURIComponent(manifestUrl);
    if (!isVIPRowAllowedUrl(decoded)) {
        (0, utils_1.sendJsonError)(res, 403, { error: 'Domain not allowed', timestamp: Date.now() });
        return;
    }
    try {
        const resp = await viprowFetch(decoded);
        res.writeHead(resp.status, {
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache',
        });
        res.end(resp.body);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        (0, utils_1.sendJsonError)(res, 502, { error: 'VIPRow manifest proxy error', details: message, timestamp: Date.now() });
    }
}
/** /viprow/key — Proxy AES-128 decryption keys */
async function handleVIPRowKey(req, res) {
    const keyUrl = req.url.searchParams.get('url');
    if (!keyUrl) {
        (0, utils_1.sendJsonError)(res, 400, { error: 'Missing url parameter', timestamp: Date.now() });
        return;
    }
    const decoded = decodeURIComponent(keyUrl);
    if (!isVIPRowAllowedUrl(decoded)) {
        (0, utils_1.sendJsonError)(res, 403, { error: 'Domain not allowed', timestamp: Date.now() });
        return;
    }
    try {
        const url = new URL(decoded);
        const proxyReq = https_1.default.request({
            hostname: url.hostname,
            port: 443,
            path: url.pathname + url.search,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                Accept: '*/*',
                Referer: 'https://viprow.nu/',
            },
            timeout: 10000,
            rejectUnauthorized: false,
        }, (proxyRes) => {
            const chunks = [];
            proxyRes.on('data', (chunk) => chunks.push(chunk));
            proxyRes.on('end', () => {
                const data = Buffer.concat(chunks);
                res.writeHead(proxyRes.statusCode ?? 502, {
                    'Content-Type': 'application/octet-stream',
                    'Content-Length': data.length,
                    'Access-Control-Allow-Origin': '*',
                });
                res.end(data);
            });
        });
        proxyReq.on('error', (err) => {
            (0, utils_1.sendJsonError)(res, 502, { error: 'VIPRow key proxy error', details: err.message, timestamp: Date.now() });
        });
        proxyReq.on('timeout', () => {
            proxyReq.destroy();
            (0, utils_1.sendJsonError)(res, 504, { error: 'VIPRow key proxy timeout', timestamp: Date.now() });
        });
        proxyReq.end();
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        (0, utils_1.sendJsonError)(res, 400, { error: 'Invalid URL', details: message, timestamp: Date.now() });
    }
}
/** /viprow/segment — Proxy video segments */
async function handleVIPRowSegment(req, res) {
    const segmentUrl = req.url.searchParams.get('url');
    if (!segmentUrl) {
        (0, utils_1.sendJsonError)(res, 400, { error: 'Missing url parameter', timestamp: Date.now() });
        return;
    }
    const decoded = decodeURIComponent(segmentUrl);
    if (!isVIPRowAllowedUrl(decoded)) {
        (0, utils_1.sendJsonError)(res, 403, { error: 'Domain not allowed', timestamp: Date.now() });
        return;
    }
    try {
        const url = new URL(decoded);
        const proxyReq = https_1.default.request({
            hostname: url.hostname,
            port: 443,
            path: url.pathname + url.search,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                Accept: '*/*',
                Referer: 'https://viprow.nu/',
            },
            timeout: 30000,
            rejectUnauthorized: false,
        }, (proxyRes) => {
            res.writeHead(proxyRes.statusCode ?? 502, {
                'Content-Type': proxyRes.headers['content-type'] ?? 'video/mp2t',
                'Access-Control-Allow-Origin': '*',
            });
            proxyRes.pipe(res);
        });
        proxyReq.on('error', (err) => {
            (0, utils_1.sendJsonError)(res, 502, { error: 'VIPRow segment proxy error', details: err.message, timestamp: Date.now() });
        });
        proxyReq.on('timeout', () => {
            proxyReq.destroy();
            (0, utils_1.sendJsonError)(res, 504, { error: 'VIPRow segment proxy timeout', timestamp: Date.now() });
        });
        res.on('close', () => proxyReq.destroy());
        proxyReq.end();
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        (0, utils_1.sendJsonError)(res, 400, { error: 'Invalid URL', details: message, timestamp: Date.now() });
    }
}
//# sourceMappingURL=viprow.js.map