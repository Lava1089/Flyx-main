"use strict";
/**
 * SOCKS5 Proxy Pool Manager
 * Fetches, validates, and maintains a pool of working SOCKS5 proxies.
 * Provides round-robin selection and failure tracking.
 * Requirement: 3.5
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.refreshProxyPool = refreshProxyPool;
exports.getNextProxy = getNextProxy;
exports.markProxyFailed = markProxyFailed;
exports.getPoolStatus = getPoolStatus;
exports.startPoolRefresh = startPoolRefresh;
exports.stopPoolRefresh = stopPoolRefresh;
const net_1 = __importDefault(require("net"));
const tls_1 = __importDefault(require("tls"));
const FALLBACK_SOCKS5_PROXIES = [
    '192.111.129.145:16894', '184.178.172.5:15303', '98.181.137.80:4145',
    '192.252.210.233:4145', '68.71.245.206:4145', '142.54.228.193:4145',
    '199.58.184.97:4145', '192.252.214.20:15864', '184.178.172.25:15291',
    '70.166.167.38:57728', '198.177.252.24:4145', '174.77.111.196:4145',
    '184.181.217.213:4145', '192.252.208.67:14287', '184.170.251.30:11288',
    '174.75.211.193:4145', '199.187.210.54:4145', '192.111.134.10:4145',
    '24.249.199.12:4145', '69.61.200.104:36181',
];
const DEFAULT_CONFIG = {
    minPoolSize: 100,
    refreshIntervalMs: 10 * 60 * 1000,
    validationTimeoutMs: 6000,
    maxConcurrentValidations: 50,
    sources: [
        'https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/socks5/data.txt',
        'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt',
        'https://raw.githubusercontent.com/officialputuid/KangProxy/KangProxy/socks5/socks5.txt',
    ],
};
const pool = {
    validated: [],
    validating: false,
    lastRefresh: 0,
    totalFetched: 0,
    totalValidated: 0,
    totalFailed: 0,
    roundRobinIndex: 0,
};
let fallbackIndex = 0;
let refreshTimer = null;
/** Fetch proxy lists from all GitHub sources */
async function fetchProxyLists(config) {
    const allProxies = new Set();
    for (const sourceUrl of config.sources) {
        try {
            const resp = await fetch(sourceUrl, { signal: AbortSignal.timeout(15000) });
            if (!resp.ok)
                continue;
            const text = await resp.text();
            const lines = text.split('\n').map(l => l.trim()).filter(l => /^\d+\.\d+\.\d+\.\d+:\d+$/.test(l));
            for (const line of lines)
                allProxies.add(line);
            console.log(`[ProxyPool] Fetched ${lines.length} proxies from ${sourceUrl.split('/')[4] ?? sourceUrl.substring(0, 60)}`);
        }
        catch {
            // Silently skip failed sources
        }
    }
    for (const p of FALLBACK_SOCKS5_PROXIES)
        allProxies.add(p);
    pool.totalFetched = allProxies.size;
    return Array.from(allProxies);
}
/** Validate a single SOCKS5 proxy by connecting through it */
function validateSocks5Proxy(proxyStr, timeoutMs) {
    return new Promise((resolve) => {
        const [proxyHost, proxyPortStr] = proxyStr.split(':');
        const proxyPort = parseInt(proxyPortStr);
        const targetHost = 'cloudnestra.com';
        const targetPort = 443;
        const timer = setTimeout(() => resolve(false), timeoutMs);
        try {
            const socket = net_1.default.connect(proxyPort, proxyHost, () => {
                socket.write(Buffer.from([0x05, 0x01, 0x00]));
            });
            let step = 'greeting';
            socket.on('error', () => { clearTimeout(timer); socket.destroy(); resolve(false); });
            socket.setTimeout(timeoutMs - 500, () => { socket.destroy(); clearTimeout(timer); resolve(false); });
            socket.on('data', (data) => {
                if (step === 'greeting') {
                    if (data[0] !== 0x05 || data[1] !== 0x00) {
                        clearTimeout(timer);
                        socket.destroy();
                        resolve(false);
                        return;
                    }
                    step = 'connect';
                    const hostBuf = Buffer.from(targetHost);
                    const portBuf = Buffer.alloc(2);
                    portBuf.writeUInt16BE(targetPort);
                    socket.write(Buffer.concat([
                        Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
                        hostBuf, portBuf,
                    ]));
                }
                else if (step === 'connect') {
                    if (data[0] !== 0x05 || data[1] !== 0x00) {
                        clearTimeout(timer);
                        socket.destroy();
                        resolve(false);
                        return;
                    }
                    const tlsSocket = tls_1.default.connect({ socket, servername: targetHost, rejectUnauthorized: false }, () => {
                        clearTimeout(timer);
                        tlsSocket.destroy();
                        socket.destroy();
                        resolve(true);
                    });
                    tlsSocket.on('error', () => { clearTimeout(timer); socket.destroy(); resolve(false); });
                }
            });
        }
        catch {
            clearTimeout(timer);
            resolve(false);
        }
    });
}
/** Validate proxies in batches */
async function validateProxiesBatch(proxies, config) {
    const results = [];
    const concurrency = config.maxConcurrentValidations;
    for (let i = 0; i < proxies.length; i += concurrency) {
        const batch = proxies.slice(i, i + concurrency);
        const batchResults = await Promise.all(batch.map(async (proxyStr) => ({
            proxyStr,
            valid: await validateSocks5Proxy(proxyStr, config.validationTimeoutMs),
        })));
        for (const r of batchResults) {
            if (r.valid)
                results.push(r.proxyStr);
        }
        if (results.length >= config.minPoolSize * 1.5)
            break;
    }
    return results;
}
/** Main pool refresh: fetch lists, validate, update pool */
async function refreshProxyPool(config = DEFAULT_CONFIG) {
    if (pool.validating)
        return;
    pool.validating = true;
    try {
        const allProxies = await fetchProxyLists(config);
        // Shuffle
        for (let i = allProxies.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [allProxies[i], allProxies[j]] = [allProxies[j], allProxies[i]];
        }
        const validated = await validateProxiesBatch(allProxies, config);
        pool.totalValidated = validated.length;
        pool.totalFailed = allProxies.length - validated.length;
        pool.lastRefresh = Date.now();
        if (validated.length > 0) {
            pool.validated = validated.map(p => ({
                host: p.split(':')[0],
                port: parseInt(p.split(':')[1]),
                str: p,
                lastValidated: Date.now(),
                failures: 0,
            }));
            pool.roundRobinIndex = 0;
            console.log(`[ProxyPool] ✅ Pool refreshed: ${validated.length} working proxies`);
        }
        else {
            console.log(`[ProxyPool] ⚠️ No proxies validated, keeping existing pool of ${pool.validated.length}`);
        }
    }
    catch (e) {
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.log(`[ProxyPool] ❌ Refresh error: ${message}`);
    }
    finally {
        pool.validating = false;
    }
}
/** Get next proxy from the validated pool (round-robin) */
function getNextProxy() {
    if (pool.validated.length > 0) {
        const proxy = pool.validated[pool.roundRobinIndex % pool.validated.length];
        pool.roundRobinIndex++;
        return { host: proxy.host, port: proxy.port, str: proxy.str, source: 'pool' };
    }
    // Fallback to hardcoded list
    const p = FALLBACK_SOCKS5_PROXIES[fallbackIndex % FALLBACK_SOCKS5_PROXIES.length];
    fallbackIndex++;
    const [host, portStr] = p.split(':');
    return { host, port: parseInt(portStr), str: p, source: 'fallback' };
}
/** Mark a proxy as failed */
function markProxyFailed(proxyStr) {
    const idx = pool.validated.findIndex(p => p.str === proxyStr);
    if (idx !== -1) {
        pool.validated[idx].failures++;
        if (pool.validated[idx].failures >= 3) {
            pool.validated.splice(idx, 1);
        }
    }
}
/** Get pool status for debugging */
function getPoolStatus() {
    return {
        poolSize: pool.validated.length,
        minRequired: DEFAULT_CONFIG.minPoolSize,
        isRefreshing: pool.validating,
        lastRefresh: pool.lastRefresh ? new Date(pool.lastRefresh).toISOString() : 'never',
        stats: {
            totalFetched: pool.totalFetched,
            totalValidated: pool.totalValidated,
            totalFailed: pool.totalFailed,
        },
    };
}
/** Start periodic pool refresh */
function startPoolRefresh(config = DEFAULT_CONFIG) {
    // Initial refresh
    refreshProxyPool(config);
    // Periodic refresh
    refreshTimer = setInterval(() => refreshProxyPool(config), config.refreshIntervalMs);
}
/** Stop periodic pool refresh */
function stopPoolRefresh() {
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
    }
}
//# sourceMappingURL=socks5-pool.js.map