"use strict";
/**
 * SOCKS5 fetch route handler
 * /fetch-socks5 — Fetch a URL through a SOCKS5 proxy with auto-retry.
 * /fetch — Generic fetch via residential IP.
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleFetchSocks5 = handleFetchSocks5;
exports.handleFetch = handleFetch;
const net_1 = __importDefault(require("net"));
const tls_1 = __importDefault(require("tls"));
const https_1 = __importDefault(require("https"));
const utils_1 = require("../utils");
const domain_allowlist_1 = require("../services/domain-allowlist");
const socks5_pool_1 = require("../services/socks5-pool");
const MAX_SOCKS5_RETRIES = 5;
function attemptSocks5Fetch(target, targetPort, useTls, customHeaders, proxyHost, proxyPort, proxyStr) {
    return new Promise((resolve) => {
        const attemptTimeout = setTimeout(() => {
            (0, socks5_pool_1.markProxyFailed)(proxyStr);
            resolve({ success: false, error: 'SOCKS5 proxy timeout', proxyStr });
        }, 12000);
        try {
            const socket = net_1.default.connect(proxyPort, proxyHost, () => {
                socket.write(Buffer.from([0x05, 0x01, 0x00]));
            });
            let step = 'greeting';
            socket.on('error', (err) => {
                clearTimeout(attemptTimeout);
                (0, socks5_pool_1.markProxyFailed)(proxyStr);
                socket.destroy();
                resolve({ success: false, error: `SOCKS5 error: ${err.message}`, proxyStr });
            });
            socket.setTimeout(10000, () => {
                clearTimeout(attemptTimeout);
                socket.destroy();
                (0, socks5_pool_1.markProxyFailed)(proxyStr);
                resolve({ success: false, error: 'SOCKS5 socket timeout', proxyStr });
            });
            socket.on('data', (data) => {
                if (step === 'greeting') {
                    if (data[0] !== 0x05 || data[1] !== 0x00) {
                        clearTimeout(attemptTimeout);
                        socket.destroy();
                        (0, socks5_pool_1.markProxyFailed)(proxyStr);
                        resolve({ success: false, error: 'SOCKS5 auth rejected', proxyStr });
                        return;
                    }
                    step = 'connect';
                    const hostBuf = Buffer.from(target.hostname);
                    const portBuf = Buffer.alloc(2);
                    portBuf.writeUInt16BE(targetPort);
                    socket.write(Buffer.concat([
                        Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
                        hostBuf, portBuf,
                    ]));
                }
                else if (step === 'connect') {
                    if (data[0] !== 0x05 || data[1] !== 0x00) {
                        clearTimeout(attemptTimeout);
                        socket.destroy();
                        (0, socks5_pool_1.markProxyFailed)(proxyStr);
                        resolve({ success: false, error: `SOCKS5 connect failed: ${data[1]}`, proxyStr });
                        return;
                    }
                    step = 'connected';
                    if (useTls) {
                        const tlsSocket = tls_1.default.connect({ socket, servername: target.hostname, rejectUnauthorized: false }, () => {
                            sendRequest(tlsSocket);
                        });
                        tlsSocket.on('error', (err) => {
                            clearTimeout(attemptTimeout);
                            (0, socks5_pool_1.markProxyFailed)(proxyStr);
                            resolve({ success: false, error: `TLS error: ${err.message}`, proxyStr });
                        });
                    }
                    else {
                        sendRequest(socket);
                    }
                }
            });
            function sendRequest(sock) {
                const path = target.pathname + target.search;
                const allHeaders = {
                    Host: target.hostname,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    Accept: '*/*',
                    Connection: 'close',
                    ...customHeaders,
                };
                let reqStr = `GET ${path} HTTP/1.1\r\n`;
                for (const [k, v] of Object.entries(allHeaders)) {
                    reqStr += `${k}: ${v}\r\n`;
                }
                reqStr += '\r\n';
                sock.write(reqStr);
                const chunks = [];
                sock.on('data', (c) => chunks.push(c));
                sock.on('end', () => {
                    clearTimeout(attemptTimeout);
                    const raw = Buffer.concat(chunks);
                    const rawStr = raw.toString('latin1');
                    const headerEnd = rawStr.indexOf('\r\n\r\n');
                    if (headerEnd === -1) {
                        resolve({ success: false, error: 'No HTTP header boundary', proxyStr });
                        return;
                    }
                    const headerPart = rawStr.substring(0, headerEnd);
                    const statusMatch = headerPart.match(/HTTP\/[\d.]+ (\d+)/);
                    const status = statusMatch ? parseInt(statusMatch[1]) : 502;
                    const bodyOffset = Buffer.byteLength(rawStr.substring(0, headerEnd + 4), 'latin1');
                    const body = raw.slice(bodyOffset);
                    const ctMatch = headerPart.match(/content-type:\s*([^\r\n]+)/i);
                    const ct = ctMatch ? ctMatch[1].trim() : 'application/octet-stream';
                    resolve({ success: true, status, body, ct, proxyStr });
                });
            }
        }
        catch (err) {
            clearTimeout(attemptTimeout);
            const message = err instanceof Error ? err.message : 'Unknown error';
            resolve({ success: false, error: message, proxyStr });
        }
    });
}
/** /fetch-socks5 — Fetch URL through SOCKS5 proxy with auto-retry */
async function handleFetchSocks5(req, res) {
    const targetUrl = req.url.searchParams.get('url');
    const headersJson = req.url.searchParams.get('headers');
    const proxyParam = req.url.searchParams.get('proxy');
    if (!targetUrl) {
        (0, utils_1.sendJsonError)(res, 400, { error: 'Missing url parameter', timestamp: Date.now() });
        return;
    }
    const decodedUrl = decodeURIComponent(targetUrl);
    if (!(0, domain_allowlist_1.isAllowedProxyDomain)(decodedUrl)) {
        (0, utils_1.sendJsonError)(res, 403, { error: 'Domain not allowed', timestamp: Date.now() });
        return;
    }
    let customHeaders = {};
    if (headersJson) {
        try {
            customHeaders = JSON.parse(headersJson);
        }
        catch {
            try {
                customHeaders = JSON.parse(decodeURIComponent(headersJson));
            }
            catch { /* ignore */ }
        }
    }
    const target = new URL(decodedUrl);
    const targetPort = target.protocol === 'https:' ? 443 : 80;
    const useTls = target.protocol === 'https:';
    const triedProxies = new Set();
    let lastError = 'All SOCKS5 proxies failed';
    for (let attempt = 0; attempt < MAX_SOCKS5_RETRIES; attempt++) {
        let proxyHost, proxyPort, proxyStr;
        if (attempt === 0 && proxyParam) {
            const parts = proxyParam.split(':');
            proxyHost = parts[0];
            proxyPort = parseInt(parts[1]);
            proxyStr = proxyParam;
        }
        else {
            const proxy = (0, socks5_pool_1.getNextProxy)();
            proxyHost = proxy.host;
            proxyPort = proxy.port;
            proxyStr = proxy.str;
        }
        if (triedProxies.has(proxyStr))
            continue;
        triedProxies.add(proxyStr);
        const result = await attemptSocks5Fetch(target, targetPort, useTls, customHeaders, proxyHost, proxyPort, proxyStr);
        if (result.success && result.body) {
            res.writeHead(result.status ?? 200, {
                'Content-Type': result.ct ?? 'application/octet-stream',
                'Content-Length': result.body.length.toString(),
                'Access-Control-Allow-Origin': '*',
                'X-Proxied-By': 'rpi-socks5',
                'X-Socks5-Proxy': `${proxyHost}:${proxyPort}`,
                'X-Socks5-Attempts': String(attempt + 1),
            });
            res.end(result.body);
            return;
        }
        lastError = result.error ?? 'Unknown error';
    }
    (0, utils_1.sendJsonError)(res, 502, {
        error: lastError,
        details: `${triedProxies.size} proxy attempts failed`,
        timestamp: Date.now(),
    });
}
/** /fetch — Generic fetch via residential IP (dumb pipe) */
async function handleFetch(req, res) {
    const targetUrl = req.url.searchParams.get('url');
    const headersJson = req.url.searchParams.get('headers');
    if (!targetUrl) {
        (0, utils_1.sendJsonError)(res, 400, { error: 'Missing url parameter', timestamp: Date.now() });
        return;
    }
    let customHeaders = {};
    if (headersJson) {
        try {
            customHeaders = JSON.parse(headersJson);
        }
        catch {
            try {
                customHeaders = JSON.parse(decodeURIComponent(headersJson));
            }
            catch { /* ignore */ }
        }
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
    const u = new URL(decoded);
    const proxyReq = https_1.default.request({
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: 'GET',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Accept: '*/*',
            ...customHeaders,
        },
        family: 4,
        timeout: 15000,
        rejectUnauthorized: false,
    }, (proxyRes) => {
        const ct = proxyRes.headers['content-type'] ?? 'application/octet-stream';
        const cl = proxyRes.headers['content-length'];
        const responseHeaders = {
            'Content-Type': ct,
            'Access-Control-Allow-Origin': '*',
            'X-Proxied-By': 'rpi-fetch',
            'X-Upstream-Status': String(proxyRes.statusCode),
        };
        if (cl)
            responseHeaders['Content-Length'] = cl;
        res.writeHead(proxyRes.statusCode ?? 502, responseHeaders);
        proxyRes.pipe(res);
        proxyRes.on('error', () => { if (!res.headersSent)
            res.writeHead(502); res.end(); });
    });
    proxyReq.on('error', (err) => {
        (0, utils_1.sendJsonError)(res, 502, { error: err.message, timestamp: Date.now() });
    });
    proxyReq.on('timeout', () => {
        proxyReq.destroy();
        (0, utils_1.sendJsonError)(res, 504, { error: 'Upstream timeout', timestamp: Date.now() });
    });
    proxyReq.end();
}
//# sourceMappingURL=socks5.js.map