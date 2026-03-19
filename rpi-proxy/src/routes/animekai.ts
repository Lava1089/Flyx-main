/**
 * AnimeKai route handler
 * /animekai — Proxies MegaUp/Flixer/DLHD CDN streams from residential IP.
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */

import https from 'https';
import http from 'http';
import type { ServerResponse } from 'http';
import type { RPIRequest } from '../types';
import { sendJsonError } from '../utils';
import { isAllowedProxyDomain } from '../services/domain-allowlist';

export async function handleAnimeKai(req: RPIRequest, res: ServerResponse): Promise<void> {
  const targetUrl = req.url.searchParams.get('url');
  const customUserAgent = req.url.searchParams.get('ua');
  const customReferer = req.url.searchParams.get('referer');
  const customOrigin = req.url.searchParams.get('origin');
  const customAuth = req.url.searchParams.get('auth');

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

  const decodedUa = customUserAgent ? decodeURIComponent(customUserAgent) : null;
  const decodedReferer = customReferer ? decodeURIComponent(customReferer) : null;
  const decodedOrigin = customOrigin ? decodeURIComponent(customOrigin) : null;
  const decodedAuth = customAuth ? decodeURIComponent(customAuth) : null;

  proxyAnimeKaiStream(decoded, decodedUa, decodedReferer, decodedOrigin, decodedAuth, res);
}

function proxyAnimeKaiStream(
  targetUrl: string,
  customUserAgent: string | null,
  customReferer: string | null,
  customOrigin: string | null,
  customAuth: string | null,
  res: ServerResponse
): void {
  const url = new URL(targetUrl);

  // MegaCloud CDN uses /_v paths — use fetch() for TLS bypass
  if (url.pathname.startsWith('/_v')) {
    const fetchUA = customUserAgent ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
    fetch(targetUrl, {
      headers: { 'User-Agent': fetchUA, Accept: '*/*' },
      signal: AbortSignal.timeout(60000),
    })
      .then(async (fetchRes) => {
        if (!fetchRes.ok) {
          const errText = await fetchRes.text();
          res.writeHead(fetchRes.status, {
            'Content-Type': fetchRes.headers.get('content-type') ?? 'text/plain',
            'Access-Control-Allow-Origin': '*',
          });
          res.end(errText);
          return;
        }
        const contentType = fetchRes.headers.get('content-type') ?? 'application/octet-stream';
        const responseHeaders: Record<string, string> = {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
          'X-Proxied-By': 'rpi-residential-fetch',
        };
        const cl = fetchRes.headers.get('content-length');
        if (cl) responseHeaders['Content-Length'] = cl;
        res.writeHead(200, responseHeaders);

        const reader = fetchRes.body?.getReader();
        if (!reader) { res.end(); return; }
        const pump = async (): Promise<void> => {
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const { done, value } = await reader.read();
            if (done) { res.end(); return; }
            res.write(Buffer.from(value));
          }
        };
        pump().catch(() => { if (!res.writableEnded) res.end(); });
      })
      .catch((err: Error) => {
        sendJsonError(res, 502, { error: 'MegaCloud CDN fetch error', details: err.message, timestamp: Date.now() });
      });
    return;
  }

  const client = url.protocol === 'https:' ? https : http;
  const defaultUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
  const userAgent = customUserAgent ?? defaultUserAgent;

  const headers: Record<string, string> = {
    'User-Agent': userAgent,
    Accept: '*/*',
    'Accept-Encoding': 'identity',
    Connection: 'keep-alive',
  };

  // CDN-specific header logic
  const isDlhdCdn = url.hostname.includes('dvalna.ru') || url.hostname.includes('soyspace.cyou') ||
    url.hostname.includes('adsfadfds.cfd') || url.hostname.includes('ksohls.ru') ||
    url.hostname.includes('ai-chatx.site') || url.hostname.includes('adffdafdsafds.sbs');
  const isFlixerCdn = /^p\.\d+\.workers\.dev$/.test(url.hostname);

  if (isDlhdCdn) {
    headers['Referer'] = customReferer ?? 'https://www.ksohls.ru/';
    headers['Origin'] = customOrigin ?? 'https://www.ksohls.ru';
    if (customAuth) headers['Authorization'] = customAuth;
  } else if (isFlixerCdn) {
    headers['Referer'] = customReferer ?? 'https://flixer.su/';
  } else if (customReferer) {
    headers['Referer'] = customReferer;
    if (customOrigin) headers['Origin'] = customOrigin;
  }

  const options: https.RequestOptions = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    method: 'GET',
    headers,
    timeout: 60000,
    rejectUnauthorized: false,
  };

  const proxyReq = client.request(options, (proxyRes) => {
    const contentType = proxyRes.headers['content-type'] ?? 'application/octet-stream';

    // Handle redirects
    if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode ?? 0) && proxyRes.headers.location) {
      const redirectUrl = proxyRes.headers.location.startsWith('http')
        ? proxyRes.headers.location
        : new URL(proxyRes.headers.location, targetUrl).toString();
      proxyAnimeKaiStream(redirectUrl, customUserAgent, customReferer, customOrigin, customAuth, res);
      return;
    }

    res.writeHead(proxyRes.statusCode ?? 502, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
      'X-Proxied-By': 'rpi-residential',
    });
    proxyRes.pipe(res);
    proxyRes.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  });

  proxyReq.on('error', (err) => {
    sendJsonError(res, 502, { error: 'AnimeKai proxy error', details: err.message, timestamp: Date.now() });
  });
  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    sendJsonError(res, 504, { error: 'AnimeKai stream timeout', timestamp: Date.now() });
  });
  res.on('close', () => proxyReq.destroy());
  proxyReq.end();
}
