/**
 * Generic stream proxy routes — proxies CDN streams via rust-fetch.
 *
 * Handles: /flixer/stream, /hianime/stream, /dlhd/stream, /vidlink/stream, /vidsrc/stream
 *
 * These were in server.js but never ported to the TypeScript codebase.
 * Each route uses rust-fetch (Chrome TLS fingerprint) with provider-specific headers.
 */

import type { ServerResponse } from 'http';
import type { RPIRequest } from '../types';
import { sendJsonError } from '../utils';
import { isAllowedProxyDomain } from '../services/domain-allowlist';

interface StreamConfig {
  referer: string;
  origin: string;
  label: string;
}

const STREAM_CONFIGS: Record<string, StreamConfig> = {
  '/flixer/stream':  { referer: 'https://hexa.su/', origin: 'https://hexa.su', label: 'Flixer' },
  '/hianime/stream': { referer: 'https://megacloud.blog/', origin: 'https://megacloud.blog', label: 'HiAnime' },
  '/dlhd/stream':    { referer: 'https://embedkclx.sbs/', origin: 'https://embedkclx.sbs', label: 'DLHD' },
  '/vidlink/stream': { referer: 'https://vidlink.pro/', origin: 'https://vidlink.pro', label: 'VidLink' },
  '/vidsrc/stream':  { referer: 'https://vidsrc.cc/', origin: 'https://vidsrc.cc', label: 'VidSrc' },
  '/1movies/stream': { referer: 'https://1movies.com/', origin: 'https://1movies.com', label: '1Movies' },
};

/**
 * Create a stream proxy handler for a specific path.
 * Returns an async handler compatible with the router.
 */
export function createStreamProxyHandler(path: string) {
  const config = STREAM_CONFIGS[path];
  if (!config) throw new Error(`No stream config for ${path}`);

  return async function handleStreamProxy(req: RPIRequest, res: ServerResponse): Promise<void> {
    const targetUrl = req.url.searchParams.get('url');
    const customUserAgent = req.url.searchParams.get('ua');
    const customReferer = req.url.searchParams.get('referer');
    const customOrigin = req.url.searchParams.get('origin');
    const customAuth = req.url.searchParams.get('auth');

    if (!targetUrl) {
      sendJsonError(res, 400, { error: 'Missing url parameter', timestamp: Date.now() });
      return;
    }

    // searchParams.get() already decodes the URL — don't double-decode
    // (double-decoding turns %20 into literal spaces, breaking URLs)
    const decoded = targetUrl;
    if (!isAllowedProxyDomain(decoded)) {
      sendJsonError(res, 403, { error: 'Domain not allowed', timestamp: Date.now() });
      return;
    }

    const headers: Record<string, string> = {
      'User-Agent': customUserAgent
        ? decodeURIComponent(customUserAgent)
        : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Encoding': 'identity',
      'Referer': customReferer ? decodeURIComponent(customReferer) : config.referer,
      ...(customOrigin === '__skip__' ? {} : { 'Origin': customOrigin ? decodeURIComponent(customOrigin) : config.origin }),
    };

    if (customAuth) {
      headers['Authorization'] = `Bearer ${decodeURIComponent(customAuth)}`;
    }

    console.log(`[${config.label}] rust-fetch → ${decoded.substring(0, 100)}...`);

    const { spawn } = await import('child_process');
    const args = ['--url', decoded, '--timeout', '30', '--mode', 'fetch-bin', '--headers', JSON.stringify(headers)];

    const rust = spawn('rust-fetch', args);
    const chunks: Buffer[] = [];
    let spawned = true;

    rust.stdout.on('data', (c: Buffer) => chunks.push(c));
    rust.stderr.on('data', (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg) console.log(`[${config.label}] stderr: ${msg.substring(0, 200)}`);
    });

    rust.on('error', (err) => {
      spawned = false;
      console.warn(`[${config.label}] rust-fetch not available: ${err.message}`);
      if (!res.headersSent) {
        sendJsonError(res, 502, { error: 'rust-fetch not available', details: err.message, timestamp: Date.now() });
      }
    });

    rust.on('close', (code) => {
      if (!spawned) return;
      if (code !== 0) {
        console.warn(`[${config.label}] rust-fetch exit ${code}`);
        if (!res.headersSent) {
          sendJsonError(res, 502, { error: `rust-fetch exit ${code}`, timestamp: Date.now() });
        }
        return;
      }

      const body = Buffer.concat(chunks);
      console.log(`[${config.label}] rust-fetch ← ${body.length}b`);

      // Detect content type
      let contentType = 'application/octet-stream';
      const preview = body.toString('utf8', 0, Math.min(200, body.length));
      if (decoded.includes('.m3u8') || preview.includes('#EXTM3U')) {
        contentType = 'application/vnd.apple.mpegurl';
      } else if (body[0] === 0x47) {
        contentType = 'video/mp2t';
      } else if (body.length >= 4 && body[0] === 0x00 && body[1] === 0x00 && body[2] === 0x00) {
        contentType = 'video/mp4';
      }

      if (!res.headersSent) {
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': body.length,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
          'X-Proxied-By': `rpi-${config.label.toLowerCase()}-rust`,
          'Cache-Control': contentType.includes('mpegurl') ? 'public, max-age=5' : 'public, max-age=3600',
        });
        res.end(body);
      }
    });

    res.on('close', () => { rust.kill(); });
  };
}

/** All stream proxy paths */
export const STREAM_PROXY_PATHS = Object.keys(STREAM_CONFIGS);
