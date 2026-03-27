"use strict";
/**
 * DLHD route handlers
 * /dlhd-key-v4 — passthrough with pre-computed auth headers
 * /dlhd-key — fetches key via V5 auth module
 * /heartbeat — establishes heartbeat session
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleDLHDKeyV4 = handleDLHDKeyV4;
exports.handleDLHDKey = handleDLHDKey;
exports.handleHeartbeat = handleHeartbeat;
exports.handleDLHDWhitelist = handleDLHDWhitelist;
exports.handleDLHDKeyV6 = handleDLHDKeyV6;
exports.handleDLHDRestream = handleDLHDRestream;
const https_1 = __importDefault(require("https"));
const utils_1 = require("../utils");
const domain_allowlist_1 = require("../services/domain-allowlist");
/**
 * Inject a sticky session ID into a ProxyJet SOCKS5 URL.
 * Transforms: socks5://USER:PASS@HOST:PORT → socks5://USER-ip-SESSIONID:PASS@HOST:PORT
 * This ensures the same residential IP is used for whitelist + key fetch.
 */
function injectStickySession(proxyUrl, sessionId) {
    try {
        const url = new URL(proxyUrl);
        // Only inject if not already sticky (no "-ip-" in username)
        if (url.username && !url.username.includes('-ip-')) {
            url.username = `${url.username}-ip-${sessionId}`;
        }
        return url.toString();
    }
    catch {
        // Fallback: try regex replacement for non-standard URLs
        return proxyUrl.replace(/^(socks5:\/\/)([^:]+)(:.+@)/, `$1$2-ip-${sessionId}$3`);
    }
}
/**
 * /dlhd-key-v4 — Simple passthrough with pre-computed auth headers.
 * CF Worker computes PoW and sends jwt/timestamp/nonce.
 */
async function handleDLHDKeyV4(req, res) {
    const targetUrl = req.url.searchParams.get('url');
    const jwt = req.url.searchParams.get('jwt');
    const timestamp = req.url.searchParams.get('timestamp');
    const nonce = req.url.searchParams.get('nonce');
    if (!targetUrl || !jwt || !timestamp || !nonce) {
        (0, utils_1.sendJsonError)(res, 400, {
            error: 'Missing parameters',
            details: '/dlhd-key-v4?url=<key_url>&jwt=<token>&timestamp=<ts>&nonce=<n>',
            timestamp: Date.now(),
        });
        return;
    }
    const url = new URL(targetUrl);
    const proxyReq = https_1.default.request({
        hostname: url.hostname,
        path: url.pathname,
        method: 'GET',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Accept: '*/*',
            Origin: 'https://www.ksohls.ru',
            Referer: 'https://www.ksohls.ru/',
            Authorization: `Bearer ${jwt}`,
            'X-Key-Timestamp': timestamp,
            'X-Key-Nonce': nonce,
        },
        timeout: 15000,
    }, (proxyRes) => {
        const chunks = [];
        proxyRes.on('data', (chunk) => chunks.push(chunk));
        proxyRes.on('end', () => {
            const data = Buffer.concat(chunks);
            const text = data.toString('utf8');
            if (data.length === 16 && !text.startsWith('{') && !text.startsWith('E')) {
                res.writeHead(200, {
                    'Content-Type': 'application/octet-stream',
                    'Content-Length': data.length,
                    'Access-Control-Allow-Origin': '*',
                    'X-Fetched-By': 'rpi-v4-passthrough',
                });
                res.end(data);
            }
            else {
                (0, utils_1.sendJsonError)(res, proxyRes.statusCode ?? 502, {
                    error: 'Invalid key response',
                    details: text.substring(0, 200),
                    timestamp: Date.now(),
                });
            }
        });
    });
    proxyReq.on('error', (err) => {
        (0, utils_1.sendJsonError)(res, 502, { error: err.message, timestamp: Date.now() });
    });
    proxyReq.on('timeout', () => {
        proxyReq.destroy();
        (0, utils_1.sendJsonError)(res, 504, { error: 'Timeout', timestamp: Date.now() });
    });
    proxyReq.end();
}
/**
 * /dlhd-key — Fetches DLHD encryption key via V5 auth module.
 * Falls back to the legacy dlhd-auth-v5 module.
 */
async function handleDLHDKey(req, res) {
    const targetUrl = req.url.searchParams.get('url');
    if (!targetUrl) {
        (0, utils_1.sendJsonError)(res, 400, {
            error: 'Missing url parameter',
            details: '/dlhd-key?url=<key_url>',
            timestamp: Date.now(),
        });
        return;
    }
    const decoded = decodeURIComponent(targetUrl);
    if (!(0, domain_allowlist_1.isAllowedProxyDomain)(decoded)) {
        (0, utils_1.sendJsonError)(res, 403, { error: 'Domain not allowed', timestamp: Date.now() });
        return;
    }
    try {
        // Dynamic require for the legacy JS auth modules
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const dlhdAuthV5 = require('../../dlhd-auth-v5');
        const result = await dlhdAuthV5.fetchDLHDKeyV5(targetUrl);
        if (result.success && result.data) {
            res.writeHead(200, {
                'Content-Type': 'application/octet-stream',
                'Content-Length': result.data.length,
                'Access-Control-Allow-Origin': '*',
                'X-Fetched-By': 'rpi-v5-auth',
            });
            res.end(result.data);
        }
        else {
            (0, utils_1.sendJsonError)(res, 502, {
                error: result.error ?? 'Key fetch failed',
                code: result.code,
                timestamp: Date.now(),
            });
        }
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        (0, utils_1.sendJsonError)(res, 502, { error: message, timestamp: Date.now() });
    }
}
/**
 * /heartbeat — Establishes heartbeat session for DLHD key fetching.
 */
async function handleHeartbeat(req, res) {
    const channel = req.url.searchParams.get('channel');
    const server = req.url.searchParams.get('server');
    const domain = req.url.searchParams.get('domain') ?? 'soyspace.cyou';
    if (!channel || !server) {
        (0, utils_1.sendJsonError)(res, 400, {
            error: 'Missing channel or server parameter',
            details: '/heartbeat?channel=51&server=zeko&domain=soyspace.cyou',
            timestamp: Date.now(),
        });
        return;
    }
    try {
        // Fetch auth token from player page
        const authData = await fetchAuthToken(channel);
        if (!authData?.token) {
            (0, utils_1.sendJsonError)(res, 502, { error: 'Failed to get auth token', timestamp: Date.now() });
            return;
        }
        const result = await establishHeartbeatSession(channel, server, domain, authData.token, authData.country, authData.timestamp);
        (0, utils_1.sendJson)(res, result.success ? 200 : 502, {
            success: result.success,
            channel,
            server,
            domain,
            expiry: result.expiry,
            error: result.error,
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        (0, utils_1.sendJsonError)(res, 502, { error: message, timestamp: Date.now() });
    }
}
function fetchAuthToken(channel) {
    // UPDATED Mar 27 2026: www.ksohls.ru is primary (browser recon confirmed)
    return fetchAuthTokenFromDomain(channel, 'www.ksohls.ru')
        .then(result => result || fetchAuthTokenFromDomain(channel, 'www.ksohls.ru'));
}
function fetchAuthTokenFromDomain(channel, domain) {
    return new Promise((resolve) => {
        const url = `https://${domain}/premiumtv/daddyhd.php?id=${channel}`;
        https_1.default.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                Referer: 'https://dlstreams.top/',
            },
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                const tokenMatch = data.match(/AUTH_TOKEN\s*=\s*["']([^"']+)["']/);
                if (!tokenMatch) {
                    resolve(null);
                    return;
                }
                const countryMatch = data.match(/AUTH_COUNTRY\s*=\s*["']([^"']+)["']/);
                const tsMatch = data.match(/AUTH_TS\s*=\s*["']([^"']+)["']/);
                resolve({
                    token: tokenMatch[1],
                    country: countryMatch?.[1] ?? 'US',
                    timestamp: tsMatch?.[1] ?? String(Math.floor(Date.now() / 1000)),
                });
            });
        }).on('error', () => resolve(null));
    });
}
function establishHeartbeatSession(channel, server, domain, authToken, country, timestamp) {
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    const channelKey = `premium${channel}`;
    const fingerprint = `${userAgent}|1920x1080|America/New_York|en-US`;
    const signData = `${channelKey}|${country}|${timestamp}|${userAgent}|${fingerprint}`;
    const clientToken = Buffer.from(signData).toString('base64');
    return new Promise((resolve) => {
        const hbUrl = `https://${server}.${domain}/heartbeat`;
        const hbReq = https_1.default.get(hbUrl, {
            headers: {
                'User-Agent': userAgent,
                Accept: '*/*',
                Origin: 'https://www.ksohls.ru',
                Referer: 'https://www.ksohls.ru/',
                Authorization: `Bearer ${authToken}`,
                'X-Channel-Key': channelKey,
                'X-Client-Token': clientToken,
                'X-User-Agent': userAgent,
            },
            timeout: 10000,
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                if (res.statusCode === 404) {
                    resolve({ success: false, error: 'No heartbeat endpoint (404)' });
                    return;
                }
                if (res.statusCode === 200 && (data.includes('"ok"') || data.includes('"status":"ok"'))) {
                    let expiry = Math.floor(Date.now() / 1000) + 1800;
                    try {
                        const json = JSON.parse(data);
                        if (json.expiry)
                            expiry = json.expiry;
                    }
                    catch { /* ignore */ }
                    resolve({ success: true, expiry });
                }
                else {
                    resolve({ success: false, error: data.substring(0, 200) });
                }
            });
        });
        hbReq.on('error', (err) => resolve({ success: false, error: err.message }));
        hbReq.on('timeout', () => { hbReq.destroy(); resolve({ success: false, error: 'Timeout' }); });
    });
}
/**
 * /dlhd-whitelist — Trigger reCAPTCHA v3 whitelist refresh via rust-fetch.
 *
 * March 2026: DLHD key servers require IP whitelisting via reCAPTCHA v3.
 * This endpoint runs rust-fetch --mode dlhd-whitelist via ProxyJet residential SOCKS5
 * to solve reCAPTCHA and POST to ai.the-sunmoon.site/verify.
 *
 * The whitelist lasts ~20 minutes. The CF worker should call this before key fetches.
 */
async function handleDLHDWhitelist(req, res) {
    const channel = req.url.searchParams.get('channel') ?? 'premium44';
    console.log(`[DLHD-Whitelist] Refreshing whitelist for ${channel}...`);
    const { execFile } = await Promise.resolve().then(() => __importStar(require('child_process')));
    const { promisify } = await Promise.resolve().then(() => __importStar(require('util')));
    const execFileAsync = promisify(execFile);
    // Build args — route through SOCKS5 proxy with sticky session
    const baseProxyUrl = process.env.PROXY_SOCKS5_URL || '';
    // Use caller-provided session or create new one for standalone whitelist
    const sessionId = req.url.searchParams.get('session') || `w${Date.now().toString(36)}`;
    const proxyUrl = baseProxyUrl ? injectStickySession(baseProxyUrl, sessionId) : '';
    const args = ['--mode', 'dlhd-whitelist', '--url', channel, '--timeout', '20'];
    if (proxyUrl) {
        args.push('--proxy', proxyUrl);
        console.log(`[DLHD-Whitelist] routing through proxy: ${proxyUrl.substring(0, 40)}...`);
    }
    try {
        const { stdout, stderr } = await execFileAsync('rust-fetch', args, { timeout: 25000, windowsHide: true });
        console.log(`[DLHD-Whitelist] stderr: ${stderr.substring(0, 200)}`);
        let result;
        try {
            result = JSON.parse(stdout.trim());
        }
        catch {
            result = { raw: stdout.trim().substring(0, 500) };
        }
        const success = result.success === true;
        console.log(`[DLHD-Whitelist] ${success ? '✅' : '❌'} result:`, JSON.stringify(result));
        (0, utils_1.sendJson)(res, success ? 200 : 502, {
            ...result,
            channel,
            timestamp: Date.now(),
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[DLHD-Whitelist] Error: ${message}`);
        (0, utils_1.sendJsonError)(res, 502, {
            error: 'Whitelist refresh failed',
            details: message,
            channel,
            timestamp: Date.now(),
        });
    }
}
/**
 * /dlhd-key-v6 — ProxyJet sticky session key fetching via rust-fetch.
 *
 * March 25, 2026: EPlayerAuth is GONE from DLHD. Keys require ZERO auth headers —
 * only reCAPTCHA IP whitelist. This endpoint:
 *
 *   1. Creates a fresh ProxyJet sticky session (unique residential IP)
 *   2. Whitelists that IP via reCAPTCHA v3 HTTP bypass + POST /verify
 *   3. Fetches the key through the SAME sticky IP (now whitelisted)
 *   4. Returns the valid 16-byte key
 *
 * The sticky session is ephemeral — one session per key request, no reuse.
 * This avoids the 4-channel concurrent limit and ensures a clean IP every time.
 */
async function handleDLHDKeyV6(req, res) {
    const startTime = Date.now();
    const targetUrl = req.url.searchParams.get('url');
    if (!targetUrl) {
        (0, utils_1.sendJsonError)(res, 400, {
            error: 'Missing url parameter',
            details: '/dlhd-key-v6?url=<key_url>',
            timestamp: Date.now(),
        });
        return;
    }
    const decoded = decodeURIComponent(targetUrl);
    if (!(0, domain_allowlist_1.isAllowedProxyDomain)(decoded)) {
        (0, utils_1.sendJsonError)(res, 403, { error: 'Domain not allowed', timestamp: Date.now() });
        return;
    }
    // Extract key path for trying multiple servers
    const keyPathMatch = decoded.match(/(\/key\/[^?]+)/);
    const keyPath = keyPathMatch ? keyPathMatch[1] : new URL(decoded).pathname;
    const channelMatch = keyPath.match(/\/(premium\d+)\//);
    const channel = channelMatch ? channelMatch[1] : 'premium44';
    // Key servers — UPDATED Mar 27 2026: sec.ai-hls.site is primary (no chevy. prefix)
    const keyServers = [
        ...new Set([
            decoded,
            `https://sec.ai-hls.site${keyPath}`,
            `https://chevy.soyspace.cyou${keyPath}`,
            `https://chevy.vovlacosa.sbs${keyPath}`,
        ])
    ];
    // Known fake/poison keys returned to non-whitelisted IPs
    const FAKE_KEYS = new Set([
        '45db13cfa0ed393fdb7da4dfe9b5ac81',
        '455806f8bc592fdacb6ed5e071a517b1',
        '4542956ed8680eaccb615f7faad4da8f',
        '45a542173e0b81d2a9c13cbc2bdcfd8c',
    ]);
    const { spawn } = await Promise.resolve().then(() => __importStar(require('child_process')));
    const { execFile } = await Promise.resolve().then(() => __importStar(require('child_process')));
    const { promisify } = await Promise.resolve().then(() => __importStar(require('util')));
    const execFileAsync = promisify(execFile);
    // ─── Step 1: Create ephemeral ProxyJet sticky session ───────────
    const baseProxyUrl = process.env.PROXY_SOCKS5_URL || '';
    if (!baseProxyUrl) {
        (0, utils_1.sendJsonError)(res, 502, { error: 'PROXY_SOCKS5_URL not configured', timestamp: Date.now() });
        return;
    }
    const sessionId = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const proxyUrl = injectStickySession(baseProxyUrl, sessionId);
    console.log(`[DLHD-Key-V6] ── START ── channel=${channel} session=${sessionId}`);
    // Helper: fetch binary data via rust-fetch through sticky proxy
    function fetchBin(url, timeoutSec = 5) {
        return new Promise((resolve, reject) => {
            const args = [
                '--url', url, '--timeout', String(timeoutSec), '--mode', 'fetch-bin',
                '--headers', JSON.stringify({
                    'Referer': 'https://www.ksohls.ru/',
                    'Origin': 'https://www.ksohls.ru',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
                }),
                '--proxy', proxyUrl,
            ];
            const proc = spawn('rust-fetch', args);
            const chunks = [];
            proc.stdout.on('data', (c) => chunks.push(c));
            proc.on('error', reject);
            proc.on('close', (code) => code !== 0 ? reject(new Error(`rust-fetch exit ${code}`)) : resolve(Buffer.concat(chunks)));
        });
    }
    let validKey = null;
    try {
        // ─── Step 2: Whitelist the sticky IP via reCAPTCHA ──────────────
        // Two-step: solve reCAPTCHA v3 token (no proxy needed), then POST /verify through sticky proxy
        console.log(`[DLHD-Key-V6] [Step 2] Whitelisting sticky IP...`);
        const wlStart = Date.now();
        // Step 2a: Solve reCAPTCHA v3 (direct, no proxy — Google doesn't block server IPs)
        const siteKey = '6LfJv4AsAAAAALTLEHKaQ7LN_VYfFqhLPrB2Tvgj';
        const pageUrl = `https://www.ksohls.ru/premiumtv/daddyhd.php?id=${channel.replace('premium', '')}`;
        const action = `verify_${channel}`;
        const recapArgs = ['--mode', 'recaptcha-v3', '--site-key', siteKey, '--action', action, '--url', pageUrl, '--timeout', '10'];
        const { stdout: recapOut } = await execFileAsync('rust-fetch', recapArgs, { timeout: 12000, windowsHide: true });
        const recapToken = recapOut.trim();
        if (!recapToken || recapToken.length < 20) {
            throw new Error(`reCAPTCHA solve failed: ${recapToken.substring(0, 100)}`);
        }
        console.log(`[DLHD-Key-V6] [Step 2a] reCAPTCHA token: ${recapToken.length} chars [${Date.now() - wlStart}ms]`);
        // Step 2b: POST /verify through sticky SOCKS5 proxy (whitelists the ProxyJet IP)
        // Use curl with --socks5 since rust-fetch doesn't support POST
        const verifyBody = JSON.stringify({ 'recaptcha-token': recapToken, 'channel_id': channel });
        // CRITICAL: verify MUST hit the SAME server as the key fetch.
        // Extract the host from the key URL and verify on that host.
        const keyHostname = (() => { try {
            return new URL(decoded).origin;
        }
        catch {
            return 'https://sec.ai-hls.site';
        } })();
        const verifyUrls = [`${keyHostname}/verify`];
        let whitelisted = false;
        for (const verifyUrl of verifyUrls) {
            try {
                const curlArgs = [
                    '-s', '--max-time', '8',
                    '--socks5-hostname', proxyUrl.replace('socks5://', ''),
                    '-X', 'POST',
                    '-H', 'Content-Type: application/json',
                    '-H', 'Origin: https://www.ksohls.ru',
                    '-H', 'Referer: https://www.ksohls.ru/',
                    '-d', verifyBody,
                    verifyUrl,
                ];
                const { stdout: verifyOut } = await execFileAsync('curl', curlArgs, { timeout: 12000, windowsHide: true });
                const verifyResult = verifyOut.trim();
                console.log(`[DLHD-Key-V6] [Step 2b] Verify (${new URL(verifyUrl).hostname}): ${verifyResult.substring(0, 150)} [${Date.now() - wlStart}ms]`);
                try {
                    if (JSON.parse(verifyResult).success) {
                        whitelisted = true;
                        break;
                    }
                }
                catch { /* try next */ }
            }
            catch (e) {
                console.log(`[DLHD-Key-V6] [Step 2b] Verify failed (${verifyUrl}): ${e instanceof Error ? e.message : String(e)}`);
            }
        }
        if (!whitelisted) {
            console.log(`[DLHD-Key-V6] [Step 2b] WARNING: verify may have failed — trying key fetch anyway`);
        }
        // ─── Step 3: Fetch key through the SAME sticky IP ───────────────
        console.log(`[DLHD-Key-V6] [Step 3] Fetching key through whitelisted proxy...`);
        const keyStart = Date.now();
        for (const url of keyServers) {
            try {
                const buf = await fetchBin(url, 5);
                if (buf.length === 16) {
                    const hex = buf.toString('hex');
                    if (!FAKE_KEYS.has(hex)) {
                        validKey = buf;
                        console.log(`[DLHD-Key-V6] [Step 3] ✅ REAL key: ${hex} from ${new URL(url).hostname} [${Date.now() - keyStart}ms]`);
                        break;
                    }
                    console.log(`[DLHD-Key-V6] [Step 3] Fake key from ${new URL(url).hostname}: ${hex}`);
                }
                else {
                    console.log(`[DLHD-Key-V6] [Step 3] Bad size from ${new URL(url).hostname}: ${buf.length}b`);
                }
            }
            catch (e) {
                console.log(`[DLHD-Key-V6] [Step 3] ${new URL(url).hostname} failed: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
    }
    catch (e) {
        console.log(`[DLHD-Key-V6] Pipeline error: ${e instanceof Error ? e.message : String(e)}`);
    }
    // ─── Step 4: Return key (session is ephemeral, no cleanup needed) ──
    const totalMs = Date.now() - startTime;
    console.log(`[DLHD-Key-V6] ── END ── ${validKey ? '✅' : '❌'} [${totalMs}ms] session=${sessionId}`);
    if (validKey) {
        res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Length': validKey.length,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': '*',
            'Cache-Control': 'no-store',
            'X-Fetched-By': 'rpi-v6-sticky',
            'X-Session-Id': sessionId,
            'X-Total-Ms': String(totalMs),
        });
        res.end(validKey);
    }
    else {
        (0, utils_1.sendJsonError)(res, 502, {
            error: 'Key fetch failed — all servers returned fake keys after whitelist',
            hint: 'ProxyJet session may have failed to whitelist',
            session: sessionId,
            totalMs,
            timestamp: Date.now(),
        });
    }
}
// =============================================================================
// RESTREAM — Clean M3U8 for VRChat / external players
// =============================================================================
const RESTREAM_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const LOOKUP_DOMAINS = ['vovlacosa.sbs', 'soyspace.cyou'];
const CDN_DOMAIN = 'soyspace.cyou';
const NEW_M3U8_SERVER = 'sec.ai-hls.site';
/** Fetch a URL via https and return the body as a string */
function httpGet(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        https_1.default.get({
            hostname: parsed.hostname,
            path: parsed.pathname + parsed.search,
            headers: { 'User-Agent': RESTREAM_UA, ...headers },
            timeout: 10000,
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
        }).on('error', reject);
    });
}
/** Fetch server key for a channel from lookup endpoints */
async function fetchServerKey(channelKey) {
    // Try new primary M3U8 server first (March 24, 2026)
    try {
        const { status, body } = await httpGet(`https://${NEW_M3U8_SERVER}/server_lookup?channel_id=${channelKey}`, { Origin: 'https://www.ksohls.ru', Referer: 'https://www.ksohls.ru/' });
        if (status === 200 && body.startsWith('{')) {
            const data = JSON.parse(body);
            if (data.server_key)
                return data.server_key;
        }
    }
    catch { /* try fallbacks */ }
    for (const domain of LOOKUP_DOMAINS) {
        try {
            const { status, body } = await httpGet(`https://chevy.${domain}/server_lookup?channel_id=${channelKey}`, { Origin: 'https://www.ksohls.ru', Referer: 'https://www.ksohls.ru/' });
            if (status === 200 && body.startsWith('{')) {
                const data = JSON.parse(body);
                if (data.server_key)
                    return data.server_key;
            }
        }
        catch { /* try next */ }
    }
    return null;
}
/**
 * /dlhd/restream — Returns a rewritten M3U8 for VRChat / external players.
 *
 * All key and segment URLs point back to this RPI proxy so the residential IP
 * handles DLHD's whitelist requirements. VRChat clients just consume the stream.
 *
 * Usage: GET /dlhd/restream?channel=303&key=<api_key>
 */
async function handleDLHDRestream(req, res) {
    const channel = req.url.searchParams.get('channel');
    if (!channel || !/^\d{1,10}$/.test(channel)) {
        (0, utils_1.sendJsonError)(res, 400, { error: 'Missing or invalid channel parameter', timestamp: Date.now() });
        return;
    }
    const apiKey = req.url.searchParams.get('key') ?? '';
    console.log(`[DLHD-Restream] Channel ${channel} requested`);
    // Step 1: Fetch auth token (enviromentalspace.sbs → ksohls.ru fallback)
    const auth = await fetchAuthToken(channel);
    if (!auth) {
        (0, utils_1.sendJsonError)(res, 502, { error: 'Failed to fetch auth token', timestamp: Date.now() });
        return;
    }
    // Decode JWT to get channelKey
    let channelKey = `premium${channel}`;
    try {
        const payload = JSON.parse(Buffer.from(auth.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
        if (payload.sub)
            channelKey = payload.sub;
    }
    catch { /* use default */ }
    console.log(`[DLHD-Restream] Auth OK, channelKey=${channelKey}`);
    // Step 2: Fetch server key
    const serverKey = await fetchServerKey(channelKey);
    if (!serverKey) {
        (0, utils_1.sendJsonError)(res, 502, { error: 'Failed to fetch server key', timestamp: Date.now() });
        return;
    }
    console.log(`[DLHD-Restream] Server key: ${serverKey}`);
    // Step 3: Fetch M3U8 from DLHD CDN (RPI residential IP)
    // Try new primary M3U8 server first, fall back to chevy.soyspace.cyou
    const m3u8Url = `https://${NEW_M3U8_SERVER}/proxy/${serverKey}/${channelKey}/mono.css`;
    let m3u8Content;
    try {
        let { status, body } = await httpGet(m3u8Url, {
            Origin: 'https://www.ksohls.ru',
            Referer: 'https://www.ksohls.ru/',
        });
        // Fallback to chevy.soyspace.cyou if primary fails
        if (status !== 200 || !body.includes('#EXTM3U')) {
            const fallbackUrl = `https://chevy.${CDN_DOMAIN}/proxy/${serverKey}/${channelKey}/mono.css`;
            const fallback = await httpGet(fallbackUrl, {
                Origin: 'https://www.ksohls.ru',
                Referer: 'https://www.ksohls.ru/',
            });
            status = fallback.status;
            body = fallback.body;
        }
        if (status !== 200 || !body.includes('#EXTM3U')) {
            (0, utils_1.sendJsonError)(res, 502, {
                error: 'M3U8 fetch failed',
                status,
                preview: body.substring(0, 200),
                timestamp: Date.now(),
            });
            return;
        }
        m3u8Content = body;
    }
    catch (e) {
        (0, utils_1.sendJsonError)(res, 502, { error: 'M3U8 fetch error', details: e.message, timestamp: Date.now() });
        return;
    }
    console.log(`[DLHD-Restream] M3U8 fetched (${m3u8Content.length} bytes)`);
    // Step 4: Build the base URL for this RPI proxy (so VRChat can reach us)
    const host = req.raw.headers['host'] ?? 'localhost:3001';
    const proto = req.raw.headers['x-forwarded-proto'] ?? 'http';
    const rpiBase = `${proto}://${host}`;
    // Step 5: Rewrite M3U8
    // - Key URIs → /dlhd-key-v6?url=<absolute_key_url>&key=<api_key>
    // - Segment URLs → /proxy?url=<absolute_segment_url>&key=<api_key>
    let rewritten = m3u8Content;
    // Rewrite key URIs
    rewritten = rewritten.replace(/URI="([^"]+)"/g, (_, keyUrl) => {
        let absoluteKey = keyUrl;
        if (!absoluteKey.startsWith('http')) {
            const base = new URL(m3u8Url);
            absoluteKey = new URL(keyUrl, base.origin + base.pathname.replace(/\/[^/]*$/, '/')).toString();
        }
        return `URI="${rpiBase}/dlhd-key-v6?url=${encodeURIComponent(absoluteKey)}&key=${apiKey}"`;
    });
    // Remove ENDLIST for live streams
    rewritten = rewritten.replace(/\n?#EXT-X-ENDLIST\s*$/m, '');
    // Join split URLs (DLHD sometimes splits long URLs across lines)
    const lines = rewritten.split('\n');
    const joined = [];
    let cur = '';
    for (const line of lines) {
        const t = line.trim();
        if (!t || t.startsWith('#')) {
            if (cur) {
                joined.push(cur);
                cur = '';
            }
            joined.push(line);
        }
        else if (t.startsWith('http://') || t.startsWith('https://')) {
            if (cur)
                joined.push(cur);
            cur = t;
        }
        else {
            cur += t;
        }
    }
    if (cur)
        joined.push(cur);
    // Rewrite segment URLs
    const output = joined.map((line) => {
        const t = line.trim();
        if (!t || t.startsWith('#'))
            return line;
        // Already rewritten
        if (t.includes('/proxy?url=') || t.includes('/dlhd-key-v6?'))
            return line;
        // Absolute DLHD segment URL
        if ((t.startsWith('http://') || t.startsWith('https://')) && !t.includes('mono.css')) {
            return `${rpiBase}/proxy?url=${encodeURIComponent(t)}&key=${apiKey}`;
        }
        // Relative segment URL — make absolute then proxy
        if (!t.startsWith('http')) {
            try {
                const base = new URL(m3u8Url);
                const abs = new URL(t, base.origin + base.pathname.replace(/\/[^/]*$/, '/')).toString();
                return `${rpiBase}/proxy?url=${encodeURIComponent(abs)}&key=${apiKey}`;
            }
            catch {
                return line;
            }
        }
        return line;
    });
    const finalM3U8 = output.join('\n');
    console.log(`[DLHD-Restream] Serving rewritten M3U8 (${finalM3U8.length} bytes)`);
    res.writeHead(200, {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': '*',
    });
    res.end(finalM3U8);
}
//# sourceMappingURL=dlhd.js.map