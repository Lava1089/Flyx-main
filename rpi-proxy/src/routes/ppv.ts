/**
 * PPV route handler
 * /ppv — Proxies poocloud.in streams from residential IP.
 * poocloud.in blocks datacenter IPs and IPv6.
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */

import https from 'https';
import http from 'http';
import type { ServerResponse } from 'http';
import type { RPIRequest } from '../types';
import { sendJsonError } from '../utils';

export async function handlePPV(req: RPIRequest, res: ServerResponse): Promise<void> {
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

  const url = new URL(decoded);
  if (!url.hostname.endsWith('poocloud.in')) {
    sendJsonError(res, 400, { error: 'Invalid domain - only poocloud.in allowed', timestamp: Date.now() });
    return;
  }

  const client = url.protocol === 'https:' ? https : http;

  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: 'https://modistreams.org/',
    Origin: 'https://modistreams.org',
    Connection: 'keep-alive',
  };

  const options: https.RequestOptions = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    method: 'GET',
    headers,
    timeout: 30000,
    family: 4, // Force IPv4 — poocloud.in blocks IPv6
  };

  const proxyReq = client.request(options, (proxyRes) => {
    const contentType = proxyRes.headers['content-type'] ?? 'application/octet-stream';
    const chunks: Buffer[] = [];

    proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
    proxyRes.on('end', () => {
      const data = Buffer.concat(chunks);

      // For m3u8 playlists, rewrite relative URLs to absolute
      if (contentType.includes('mpegurl') || decoded.endsWith('.m3u8') || decoded.includes('.m3u8?')) {
        const text = data.toString('utf8');
        const baseUrl = decoded.substring(0, decoded.lastIndexOf('/') + 1);
        const rewritten = text.split('\n').map(line => {
          const trimmed = line.trim();
          if (trimmed === '' || trimmed.startsWith('#')) {
            // Handle EXT-X-KEY URI
            if (trimmed.includes('URI="')) {
              return trimmed.replace(/URI="([^"]+)"/, (_, uri: string) => {
                const fullUrl = uri.startsWith('http') ? uri : baseUrl + uri;
                return `URI="${fullUrl}"`;
              });
            }
            return line;
          }
          if (trimmed.startsWith('http')) return trimmed;
          if (trimmed.endsWith('.ts') || trimmed.endsWith('.m3u8') || trimmed.includes('.ts?') || trimmed.includes('.m3u8?')) {
            return baseUrl + trimmed;
          }
          return line;
        }).join('\n');

        res.writeHead(proxyRes.statusCode ?? 200, {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Content-Length': Buffer.byteLength(rewritten),
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache',
        });
        res.end(rewritten);
      } else {
        res.writeHead(proxyRes.statusCode ?? 200, {
          'Content-Type': contentType,
          'Content-Length': data.length,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache',
        });
        res.end(data);
      }
    });
  });

  proxyReq.on('error', (err) => {
    sendJsonError(res, 502, { error: 'PPV proxy error', details: err.message, timestamp: Date.now() });
  });
  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    sendJsonError(res, 504, { error: 'PPV proxy timeout', timestamp: Date.now() });
  });
  proxyReq.end();
}
