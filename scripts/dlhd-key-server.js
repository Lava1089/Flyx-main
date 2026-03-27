#!/usr/bin/env node
/**
 * DLHD Key Server
 *
 * Runs on your machine (or RPI). Maintains a whitelisted IP via Playwright,
 * then serves real keys via HTTP. The CF worker calls this instead of ProxyJet.
 *
 * Flow:
 *   1. Playwright loads DLHD embed → reCAPTCHA whitelists this machine's IP
 *   2. HTTP server on port 8787 serves /key?url=... requests
 *   3. Keys fetched directly from sec.ai-hls.site (this IP is whitelisted)
 *   4. Re-whitelists every 14 minutes automatically
 *
 * Usage: node scripts/dlhd-key-server.js
 * Test:  curl http://localhost:8787/key?url=https://sec.ai-hls.site/key/premium51/5915440
 */
const http = require('http');
const https = require('https');
const { chromium } = require('playwright');

const PORT = parseInt(process.env.PORT || '8787');
const WHITELIST_INTERVAL_MS = 14 * 60 * 1000;
let lastWhitelist = 0;
let whitelistOk = false;

// ─── HTTPS fetch helper ─────────────────────────────────────────────
function fetchBuf(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.get({
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36', ...headers },
      timeout: 8000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ─── Whitelist via Playwright ────────────────────────────────────────
// Channels that cover ALL known servers:
// 51 → zeko, 100 → ddy6, 33 → nfs, 70 → wind, 130 → dokko1
const WHITELIST_CHANNELS = ['51', '100', '33', '70', '130'];

async function whitelist() {
  const ts = () => new Date().toISOString().substring(11, 19);
  console.log(`[${ts()}] Whitelisting ALL servers via ${WHITELIST_CHANNELS.length} channels...`);

  let browser;
  try {
    browser = await chromium.launch({
      headless: false, // headed mode required — reCAPTCHA detects headless
      args: ['--disable-blink-features=AutomationControlled', '--autoplay-policy=no-user-gesture-required', '--window-position=-32000,-32000'],
    });
    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
      ignoreHTTPSErrors: true,
    });
    await ctx.route(/doubleclick|googlesyndication|histats|xadsmart|dtscout|rtmark|protraffic|usrpubtrk|405kk|kofeslos|al5sm/, (r) => r.abort());

    let verifyCount = 0;
    // Open each channel in a separate tab — all whitelist in parallel
    for (const ch of WHITELIST_CHANNELS) {
      const page = await ctx.newPage();
      page.on('response', async (r) => {
        if (r.url().includes('/verify') && r.status() === 200) {
          try { if (JSON.parse(await r.text()).success) { verifyCount++; console.log(`[${ts()}] ✅ CH ${ch} verified (${verifyCount}/${WHITELIST_CHANNELS.length})`); } } catch {}
        }
      });
      try {
        await page.goto(`https://dlstreams.top/embed/stream-${ch}.php`, { waitUntil: 'domcontentloaded', timeout: 12000 });
      } catch {}
    }

    // Wait for all verifies
    const start = Date.now();
    while (verifyCount < WHITELIST_CHANNELS.length && Date.now() - start < 15000) {
      await new Promise((r) => setTimeout(r, 500));
    }

    await browser.close();
    browser = null;

    lastWhitelist = Date.now();
    whitelistOk = true;
    console.log(`[${ts()}] Done: ${verifyCount}/${WHITELIST_CHANNELS.length} servers whitelisted`);
  } catch (e) {
    console.log(`[${new Date().toISOString().substring(11, 19)}] Whitelist error: ${e.message}`);
    if (browser) await browser.close().catch(() => {});
  }
}

// ─── HTTP Key Server ─────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Health
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, whitelisted: whitelistOk, lastWhitelist, age: Date.now() - lastWhitelist }));
    return;
  }

  // Key fetch
  if (url.pathname === '/key') {
    const keyUrl = url.searchParams.get('url');
    if (!keyUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'missing url param' }));
      return;
    }

    // Re-whitelist if stale
    if (Date.now() - lastWhitelist > WHITELIST_INTERVAL_MS) {
      await whitelist();
    }

    try {
      const resp = await fetchBuf(keyUrl, {
        'Origin': 'https://www.ksohls.ru',
        'Referer': 'https://www.ksohls.ru/',
      });

      if (resp.status === 200 && resp.body.length === 16) {
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': '16',
          'Cache-Control': 'no-store',
        });
        res.end(resp.body);
      } else {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad key', status: resp.status, size: resp.body.length }));
      }
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

// ─── Start ───────────────────────────────────────────────────────────
(async () => {
  console.log(`DLHD Key Server starting on port ${PORT}...`);
  await whitelist();

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Key server running: http://localhost:${PORT}`);
    console.log(`Test: curl http://localhost:${PORT}/health`);
    console.log(`\nThe CF worker should call: http://<your-ip>:${PORT}/key?url=<key_url>`);
    console.log('Or expose via cloudflare tunnel: cloudflared tunnel --url http://localhost:8787\n');
  });

  // Re-whitelist every 14 minutes
  setInterval(whitelist, WHITELIST_INTERVAL_MS);
})();
