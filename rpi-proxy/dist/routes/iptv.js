"use strict";
/**
 * IPTV route handlers
 * /iptv/api — Stalker portal API calls from residential IP
 * /iptv/stream — Raw MPEG-TS streaming with STB headers
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleIPTVApi = handleIPTVApi;
exports.handleIPTVStream = handleIPTVStream;
const https_1 = __importDefault(require("https"));
const http_1 = __importDefault(require("http"));
const utils_1 = require("../utils");
const STB_USER_AGENT = 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3';
function buildSTBHeaders(url, mac, token) {
    const encodedMac = mac ? encodeURIComponent(mac) : '';
    const headers = {
        'User-Agent': STB_USER_AGENT,
        'X-User-Agent': 'Model: MAG250; Link: WiFi',
        Accept: '*/*',
        'Accept-Encoding': 'gzip, deflate',
        'Accept-Language': 'en-US,en;q=0.9',
        Connection: 'keep-alive',
        Referer: `${url.protocol}//${url.host}/`,
    };
    if (mac)
        headers['Cookie'] = `mac=${encodedMac}; stb_lang=en; timezone=GMT`;
    if (token)
        headers['Authorization'] = `Bearer ${token}`;
    return headers;
}
/** /iptv/api — Proxy Stalker portal API calls */
async function handleIPTVApi(req, res) {
    const targetUrl = req.url.searchParams.get('url');
    const mac = req.url.searchParams.get('mac');
    const token = req.url.searchParams.get('token');
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
    const url = new URL(decoded);
    const client = url.protocol === 'https:' ? https_1.default : http_1.default;
    const headers = buildSTBHeaders(url, mac, token);
    const proxyReq = client.request({
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'GET',
        headers,
        timeout: 15000,
        rejectUnauthorized: false,
    }, (proxyRes) => {
        const chunks = [];
        proxyRes.on('data', (chunk) => chunks.push(chunk));
        proxyRes.on('end', () => {
            const data = Buffer.concat(chunks);
            res.writeHead(proxyRes.statusCode ?? 502, {
                'Content-Type': proxyRes.headers['content-type'] ?? 'application/json',
                'Content-Length': data.length,
                'Access-Control-Allow-Origin': '*',
            });
            res.end(data);
        });
    });
    proxyReq.on('error', (err) => {
        (0, utils_1.sendJsonError)(res, 502, { error: 'IPTV API proxy error', details: err.message, timestamp: Date.now() });
    });
    proxyReq.on('timeout', () => {
        proxyReq.destroy();
        (0, utils_1.sendJsonError)(res, 504, { error: 'IPTV API timeout', timestamp: Date.now() });
    });
    proxyReq.end();
}
/** /iptv/stream — Stream raw MPEG-TS data with STB headers, follows redirects */
async function handleIPTVStream(req, res) {
    const targetUrl = req.url.searchParams.get('url');
    const mac = req.url.searchParams.get('mac');
    const token = req.url.searchParams.get('token');
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
    proxyIPTVStream(decoded, mac, token, res, 0);
}
function proxyIPTVStream(targetUrl, mac, token, res, redirectCount) {
    if (redirectCount > 5) {
        (0, utils_1.sendJsonError)(res, 502, { error: 'Too many redirects', timestamp: Date.now() });
        return;
    }
    const url = new URL(targetUrl);
    const client = url.protocol === 'https:' ? https_1.default : http_1.default;
    const headers = buildSTBHeaders(url, mac, token);
    const proxyReq = client.request({
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'GET',
        headers,
        timeout: 30000,
        rejectUnauthorized: false,
    }, (proxyRes) => {
        // Handle redirects
        if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode ?? 0) && proxyRes.headers.location) {
            const redirectUrl = proxyRes.headers.location.startsWith('http')
                ? proxyRes.headers.location
                : new URL(proxyRes.headers.location, targetUrl).toString();
            proxyIPTVStream(redirectUrl, mac, token, res, redirectCount + 1);
            return;
        }
        res.writeHead(proxyRes.statusCode ?? 502, {
            'Content-Type': proxyRes.headers['content-type'] ?? 'video/mp2t',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
            'Cache-Control': 'no-store',
        });
        proxyRes.pipe(res);
        proxyRes.on('error', () => { if (!res.headersSent)
            res.writeHead(502); res.end(); });
    });
    proxyReq.on('error', (err) => {
        (0, utils_1.sendJsonError)(res, 502, { error: 'IPTV proxy error', details: err.message, timestamp: Date.now() });
    });
    proxyReq.on('timeout', () => {
        proxyReq.destroy();
        (0, utils_1.sendJsonError)(res, 504, { error: 'IPTV stream timeout', timestamp: Date.now() });
    });
    res.on('close', () => proxyReq.destroy());
    proxyReq.end();
}
//# sourceMappingURL=iptv.js.map