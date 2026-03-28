/**
 * Generic /proxy route handler
 * Proxies requests to allowed domains from residential IP.
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */

import https from 'https';
import http from 'http';
import type { RPIRequest } from '../types';
import type { ServerResponse } from 'http';
import { sendJsonError, sendJson } from '../utils';
import { isAllowedProxyDomain } from '../services/domain-allowlist';

export async function handleProxy(req: RPIRequest, res: ServerResponse): Promise<void> {
  const targetUrl = req.url.searchParams.get('url');

  if (!targetUrl) {
    sendJsonError(res, 400, { error: 'Missing url parameter', timestamp: Date.now() });
    return;
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

  // Support custom headers via query params (same convention as stream-proxy)
  const customUserAgent = req.url.searchParams.get('ua');
  const customReferer = req.url.searchParams.get('referer');
  const customOrigin = req.url.searchParams.get('origin');

  const url = new URL(decoded);
  const client = url.protocol === 'https:' ? https : http;

  const reqHeaders: Record<string, string> = {
    'User-Agent': customUserAgent
      ? decodeURIComponent(customUserAgent)
      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': '*/*',
  };
  if (customReferer) reqHeaders['Referer'] = decodeURIComponent(customReferer);
  if (customOrigin) reqHeaders['Origin'] = decodeURIComponent(customOrigin);

  const options: https.RequestOptions = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    method: 'GET',
    headers: reqHeaders,
    timeout: 30000,
  };

  const proxyReq = client.request(options, (proxyRes) => {
    const contentType = proxyRes.headers['content-type'] ?? 'application/octet-stream';
    const chunks: Buffer[] = [];

    proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
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
    sendJsonError(res, 502, { error: 'Proxy error', details: err.message, timestamp: Date.now() });
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    sendJsonError(res, 504, { error: 'Timeout', timestamp: Date.now() });
  });

  proxyReq.end();
}
