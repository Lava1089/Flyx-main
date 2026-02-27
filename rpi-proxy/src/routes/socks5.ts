/**
 * SOCKS5 fetch route handler
 * /fetch-socks5 — Fetch a URL through a SOCKS5 proxy with auto-retry.
 * /fetch — Generic fetch via residential IP.
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */

import net from 'net';
import tls from 'tls';
import https from 'https';
import type { ServerResponse } from 'http';
import type { RPIRequest } from '../types';
import { sendJsonError } from '../utils';
import { isAllowedProxyDomain } from '../services/domain-allowlist';
import { getNextProxy, markProxyFailed } from '../services/socks5-pool';

const MAX_SOCKS5_RETRIES = 5;

interface Socks5FetchResult {
  success: boolean;
  status?: number;
  body?: Buffer;
  ct?: string;
  proxyStr: string;
  error?: string;
}

function attemptSocks5Fetch(
  target: URL, targetPort: number, useTls: boolean,
  customHeaders: Record<string, string>,
  proxyHost: string, proxyPort: number, proxyStr: string
): Promise<Socks5FetchResult> {
  return new Promise((resolve) => {
    const attemptTimeout = setTimeout(() => {
      markProxyFailed(proxyStr);
      resolve({ success: false, error: 'SOCKS5 proxy timeout', proxyStr });
    }, 12000);

    try {
      const socket = net.connect(proxyPort, proxyHost, () => {
        socket.write(Buffer.from([0x05, 0x01, 0x00]));
      });

      let step = 'greeting';

      socket.on('error', (err) => {
        clearTimeout(attemptTimeout);
        markProxyFailed(proxyStr);
        socket.destroy();
        resolve({ success: false, error: `SOCKS5 error: ${err.message}`, proxyStr });
      });

      socket.setTimeout(10000, () => {
        clearTimeout(attemptTimeout);
        socket.destroy();
        markProxyFailed(proxyStr);
        resolve({ success: false, error: 'SOCKS5 socket timeout', proxyStr });
      });

      socket.on('data', (data) => {
        if (step === 'greeting') {
          if (data[0] !== 0x05 || data[1] !== 0x00) {
            clearTimeout(attemptTimeout);
            socket.destroy();
            markProxyFailed(proxyStr);
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
        } else if (step === 'connect') {
          if (data[0] !== 0x05 || data[1] !== 0x00) {
            clearTimeout(attemptTimeout);
            socket.destroy();
            markProxyFailed(proxyStr);
            resolve({ success: false, error: `SOCKS5 connect failed: ${data[1]}`, proxyStr });
            return;
          }
          step = 'connected';

          if (useTls) {
            const tlsSocket = tls.connect({ socket, servername: target.hostname, rejectUnauthorized: false }, () => {
              sendRequest(tlsSocket);
            });
            tlsSocket.on('error', (err) => {
              clearTimeout(attemptTimeout);
              markProxyFailed(proxyStr);
              resolve({ success: false, error: `TLS error: ${err.message}`, proxyStr });
            });
          } else {
            sendRequest(socket);
          }
        }
      });

      function sendRequest(sock: net.Socket | tls.TLSSocket): void {
        const path = target.pathname + target.search;
        const allHeaders: Record<string, string> = {
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

        const chunks: Buffer[] = [];
        sock.on('data', (c: Buffer) => chunks.push(c));
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
    } catch (err: unknown) {
      clearTimeout(attemptTimeout);
      const message = err instanceof Error ? err.message : 'Unknown error';
      resolve({ success: false, error: message, proxyStr });
    }
  });
}

/** /fetch-socks5 — Fetch URL through SOCKS5 proxy with auto-retry */
export async function handleFetchSocks5(req: RPIRequest, res: ServerResponse): Promise<void> {
  const targetUrl = req.url.searchParams.get('url');
  const headersJson = req.url.searchParams.get('headers');
  const proxyParam = req.url.searchParams.get('proxy');

  if (!targetUrl) {
    sendJsonError(res, 400, { error: 'Missing url parameter', timestamp: Date.now() });
    return;
  }

  const decodedUrl = decodeURIComponent(targetUrl);
  if (!isAllowedProxyDomain(decodedUrl)) {
    sendJsonError(res, 403, { error: 'Domain not allowed', timestamp: Date.now() });
    return;
  }

  let customHeaders: Record<string, string> = {};
  if (headersJson) {
    try { customHeaders = JSON.parse(headersJson); } catch {
      try { customHeaders = JSON.parse(decodeURIComponent(headersJson)); } catch { /* ignore */ }
    }
  }

  const target = new URL(decodedUrl);
  const targetPort = target.protocol === 'https:' ? 443 : 80;
  const useTls = target.protocol === 'https:';

  const triedProxies = new Set<string>();
  let lastError = 'All SOCKS5 proxies failed';

  for (let attempt = 0; attempt < MAX_SOCKS5_RETRIES; attempt++) {
    let proxyHost: string, proxyPort: number, proxyStr: string;

    if (attempt === 0 && proxyParam) {
      const parts = proxyParam.split(':');
      proxyHost = parts[0];
      proxyPort = parseInt(parts[1]);
      proxyStr = proxyParam;
    } else {
      const proxy = getNextProxy();
      proxyHost = proxy.host;
      proxyPort = proxy.port;
      proxyStr = proxy.str;
    }

    if (triedProxies.has(proxyStr)) continue;
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

  sendJsonError(res, 502, {
    error: lastError,
    details: `${triedProxies.size} proxy attempts failed`,
    timestamp: Date.now(),
  });
}

/** /fetch — Generic fetch via residential IP (dumb pipe) */
export async function handleFetch(req: RPIRequest, res: ServerResponse): Promise<void> {
  const targetUrl = req.url.searchParams.get('url');
  const headersJson = req.url.searchParams.get('headers');

  if (!targetUrl) {
    sendJsonError(res, 400, { error: 'Missing url parameter', timestamp: Date.now() });
    return;
  }

  let customHeaders: Record<string, string> = {};
  if (headersJson) {
    try { customHeaders = JSON.parse(headersJson); } catch {
      try { customHeaders = JSON.parse(decodeURIComponent(headersJson)); } catch { /* ignore */ }
    }
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(targetUrl);
  } catch {
    sendJsonError(res, 400, { error: 'Invalid URL', timestamp: Date.now() });
    return;
  }

  if (!isAllowedProxyDomain(decoded)) {
    sendJsonError(res, 403, { error: 'Domain not allowed', timestamp: Date.now() });
    return;
  }

  const u = new URL(decoded);

  const proxyReq = https.request({
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
    const responseHeaders: Record<string, string> = {
      'Content-Type': ct,
      'Access-Control-Allow-Origin': '*',
      'X-Proxied-By': 'rpi-fetch',
      'X-Upstream-Status': String(proxyRes.statusCode),
    };
    if (cl) responseHeaders['Content-Length'] = cl;
    res.writeHead(proxyRes.statusCode ?? 502, responseHeaders);
    proxyRes.pipe(res);
    proxyRes.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  });

  proxyReq.on('error', (err) => {
    sendJsonError(res, 502, { error: err.message, timestamp: Date.now() });
  });
  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    sendJsonError(res, 504, { error: 'Upstream timeout', timestamp: Date.now() });
  });
  proxyReq.end();
}
