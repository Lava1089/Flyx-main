#!/usr/bin/env node
/**
 * DLHD Playwright Deep Recon — March 27, 2026
 *
 * Loads the ACTUAL DLHD player page in a real Chromium browser and captures:
 *   1. All network requests (M3U8, keys, segments, verify, reCAPTCHA)
 *   2. Console logs from the player JS
 *   3. Request/response headers for every call
 *   4. Key bytes (hex) and segment sizes
 *   5. reCAPTCHA flow details
 *   6. Any new auth mechanisms or domain changes
 *   7. Timing for every step
 *
 * Usage: node scripts/dlhd-playwright-recon.js [channelId]
 *        Default: channel 51
 */

const { chromium } = require('playwright');

const CHANNEL = process.argv[2] || '51';
const TIMEOUT_MS = 60000;

// Known DLHD entry points
const PLAYER_URLS = [
  `https://enviromentalspace.sbs/premiumtv/daddyhd.php?id=${CHANNEL}`,
  `https://www.ksohls.ru/premiumtv/daddyhd.php?id=${CHANNEL}`,
];

// Tracking
const networkLog = [];
const keyFetches = [];
const segmentFetches = [];
const m3u8Fetches = [];
const verifyFetches = [];
const recaptchaFetches = [];
const consoleMessages = [];
const iframeUrls = [];

function ts() { return `[${((Date.now() - startTime) / 1000).toFixed(2)}s]`; }
let startTime;

(async () => {
  startTime = Date.now();
  console.log(`\n${'='.repeat(80)}`);
  console.log(`  DLHD PLAYWRIGHT DEEP RECON — Channel ${CHANNEL}`);
  console.log(`  ${new Date().toISOString()}`);
  console.log(`${'='.repeat(80)}\n`);

  const browser = await chromium.launch({
    headless: false, // visible so we can see what happens
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
  });

  // Intercept ALL network activity across all frames
  async function instrumentPage(page, label) {
    page.on('request', (req) => {
      const url = req.url();
      const entry = {
        label,
        ts: Date.now() - startTime,
        method: req.method(),
        url,
        headers: req.headers(),
        resourceType: req.resourceType(),
      };
      networkLog.push(entry);

      if (url.includes('/key/')) {
        keyFetches.push(entry);
        console.log(`${ts()} 🔑 KEY REQUEST: ${url.substring(0, 120)}`);
        console.log(`     Headers: ${JSON.stringify(Object.fromEntries(Object.entries(req.headers()).filter(([k]) => ['authorization','origin','referer','x-key-timestamp','x-key-nonce'].includes(k))))}`);
      }
      if (url.includes('mono.css') || url.includes('mono.m3u8') || url.includes('.m3u8')) {
        m3u8Fetches.push(entry);
        console.log(`${ts()} 📋 M3U8 REQUEST: ${url.substring(0, 120)}`);
      }
      if (url.includes('/verify')) {
        verifyFetches.push(entry);
        const postData = req.postData();
        console.log(`${ts()} ✅ VERIFY REQUEST: ${url}`);
        console.log(`     Method: ${req.method()}`);
        console.log(`     Origin: ${req.headers()['origin']}`);
        console.log(`     Body: ${postData ? postData.substring(0, 200) : '(none)'}`);
      }
      if (url.includes('recaptcha') || url.includes('google.com/recaptcha')) {
        recaptchaFetches.push(entry);
        if (!url.includes('.js') && !url.includes('.png')) {
          console.log(`${ts()} 🤖 RECAPTCHA: ${url.substring(0, 120)}`);
        }
      }
    });

    page.on('response', async (resp) => {
      const url = resp.url();
      const status = resp.status();

      if (url.includes('/key/') && status === 200) {
        try {
          const buf = await resp.body();
          if (buf.length === 16) {
            const hex = buf.toString('hex');
            console.log(`${ts()} 🔑 KEY RESPONSE: ${hex} (${buf.length}b) from ${new URL(url).hostname}`);
            console.log(`     Response headers: ${JSON.stringify(Object.fromEntries([...Object.entries(resp.headers())].filter(([k]) => ['access-control-allow-origin','content-type','x-key-source'].includes(k))))}`);
            keyFetches.push({ type: 'response', url, hex, size: buf.length, status });
          } else {
            console.log(`${ts()} 🔑 KEY RESPONSE: ${buf.length}b (unexpected size) from ${new URL(url).hostname}`);
          }
        } catch {}
      }

      if (url.includes('/verify')) {
        try {
          const body = await resp.text();
          console.log(`${ts()} ✅ VERIFY RESPONSE: ${status} → ${body.substring(0, 200)}`);
          console.log(`     CORS: ${resp.headers()['access-control-allow-origin'] || 'none'}`);
        } catch {}
      }

      if (url.includes('mono.css') || url.includes('mono.m3u8') || url.includes('.m3u8')) {
        try {
          const body = await resp.text();
          console.log(`${ts()} 📋 M3U8 RESPONSE: ${status} (${body.length}b)`);
          // Extract key URI and first few segment URLs
          const lines = body.split('\n');
          for (const line of lines) {
            if (line.includes('EXT-X-KEY')) {
              console.log(`     KEY LINE: ${line.trim()}`);
            }
          }
          const segments = lines.filter(l => l.trim() && !l.startsWith('#'));
          console.log(`     SEGMENTS: ${segments.length} segments`);
          if (segments[0]) console.log(`     FIRST: ${segments[0].substring(0, 120)}`);
          // Track segment CDN domains
          const domains = new Set(segments.map(s => { try { return new URL(s).hostname; } catch { return s.substring(0, 50); } }));
          console.log(`     CDN DOMAINS: ${[...domains].join(', ')}`);
        } catch {}
      }

      // Track segment responses
      if (url.match(/\.(png|ts|bin|seg)(\?|$)/) && !url.includes('recaptcha') && !url.includes('google') && resp.headers()['content-type']?.includes('octet')) {
        const size = resp.headers()['content-length'] || '?';
        segmentFetches.push({ url, status, size });
      }
    });

    page.on('console', (msg) => {
      const text = msg.text();
      consoleMessages.push({ ts: Date.now() - startTime, text });
      // Only log interesting console messages
      if (text.includes('key') || text.includes('Key') || text.includes('auth') || text.includes('Auth') ||
          text.includes('token') || text.includes('verify') || text.includes('captcha') ||
          text.includes('whitelist') || text.includes('error') || text.includes('Error') ||
          text.includes('hls') || text.includes('Hls') || text.includes('m3u8')) {
        console.log(`${ts()} 💬 CONSOLE: ${text.substring(0, 200)}`);
      }
    });

    page.on('pageerror', (err) => {
      console.log(`${ts()} ❌ PAGE ERROR: ${err.message.substring(0, 200)}`);
    });

    // Catch new iframes
    page.on('frameattached', (frame) => {
      const url = frame.url();
      if (url && url !== 'about:blank') {
        iframeUrls.push(url);
        console.log(`${ts()} 🖼️  IFRAME: ${url.substring(0, 120)}`);
      }
    });
    page.on('framenavigated', (frame) => {
      const url = frame.url();
      if (url && url !== 'about:blank' && frame !== page.mainFrame()) {
        iframeUrls.push(url);
        console.log(`${ts()} 🖼️  IFRAME NAV: ${url.substring(0, 120)}`);
      }
    });
  }

  const page = await context.newPage();
  await instrumentPage(page, 'main');

  // Try each player URL
  let loaded = false;
  for (const playerUrl of PLAYER_URLS) {
    console.log(`\n${ts()} ─── Trying: ${playerUrl} ───\n`);
    try {
      const resp = await page.goto(playerUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      const status = resp?.status();
      console.log(`${ts()} HTTP ${status}`);

      if (status === 403 || status === 503) {
        console.log(`${ts()} ⛔ Blocked (${status}), trying next...`);
        continue;
      }

      loaded = true;
      console.log(`${ts()} ✅ Page loaded, waiting for network activity...\n`);

      // Wait for the page to load iframes and start playback
      // The player page loads in an iframe, which then loads HLS
      await page.waitForTimeout(5000);

      // Check all frames for video elements and HLS activity
      const frames = page.frames();
      console.log(`\n${ts()} ─── Found ${frames.length} frames ───`);
      for (const frame of frames) {
        const url = frame.url();
        if (url && url !== 'about:blank') {
          console.log(`  Frame: ${url.substring(0, 120)}`);
        }
      }

      // Wait longer for key fetches and segment loads
      console.log(`\n${ts()} Waiting for key + segment fetches (up to 30s)...\n`);

      // Wait until we see key fetches or timeout
      const waitStart = Date.now();
      while (Date.now() - waitStart < 30000) {
        if (keyFetches.length > 0 && segmentFetches.length > 0) {
          console.log(`${ts()} Got keys and segments, waiting 5s more for stability...`);
          await page.waitForTimeout(5000);
          break;
        }
        await page.waitForTimeout(1000);
      }

      break; // Don't try next URL if this one loaded
    } catch (e) {
      console.log(`${ts()} Error: ${e.message.substring(0, 200)}`);
    }
  }

  if (!loaded) {
    console.log(`\n${ts()} ❌ All player URLs failed to load!\n`);
  }

  // ─── SUMMARY ──────────────────────────────────────────────────────────────
  console.log(`\n${'='.repeat(80)}`);
  console.log(`  RECON SUMMARY — Channel ${CHANNEL}`);
  console.log(`${'='.repeat(80)}\n`);

  console.log(`Total network requests: ${networkLog.length}`);
  console.log(`M3U8 fetches: ${m3u8Fetches.length}`);
  console.log(`Key fetches: ${keyFetches.length}`);
  console.log(`Segment fetches: ${segmentFetches.length}`);
  console.log(`Verify calls: ${verifyFetches.length}`);
  console.log(`reCAPTCHA calls: ${recaptchaFetches.length}`);
  console.log(`Iframes: ${iframeUrls.length}`);

  // Deduplicate key hex values
  const keyHexes = keyFetches.filter(k => k.hex).map(k => k.hex);
  const uniqueKeys = [...new Set(keyHexes)];
  console.log(`\nUnique keys received: ${uniqueKeys.length}`);
  uniqueKeys.forEach(k => console.log(`  ${k}`));

  // Show unique domains contacted
  const domains = new Set(networkLog.map(e => { try { return new URL(e.url).hostname; } catch { return '?'; } }));
  console.log(`\nUnique domains contacted:`);
  [...domains].sort().forEach(d => console.log(`  ${d}`));

  // Show verify details
  if (verifyFetches.length > 0) {
    console.log(`\nVerify endpoint details:`);
    verifyFetches.forEach(v => {
      console.log(`  ${v.method} ${v.url}`);
      console.log(`    Origin: ${v.headers?.origin || 'none'}`);
      console.log(`    Referer: ${v.headers?.referer || 'none'}`);
    });
  }

  // Show key request headers (auth mechanism)
  const keyRequests = keyFetches.filter(k => k.method);
  if (keyRequests.length > 0) {
    console.log(`\nKey request auth headers:`);
    const first = keyRequests[0];
    const authHeaders = Object.entries(first.headers || {}).filter(([k]) =>
      k.startsWith('x-') || k === 'authorization' || k === 'origin' || k === 'referer' || k === 'cookie'
    );
    authHeaders.forEach(([k, v]) => console.log(`  ${k}: ${v}`));
  }

  // Show all console messages related to auth/keys
  const authConsole = consoleMessages.filter(m =>
    m.text.match(/key|auth|token|verify|captcha|whitelist|decrypt|error/i)
  );
  if (authConsole.length > 0) {
    console.log(`\nRelevant console messages (${authConsole.length}):`);
    authConsole.slice(0, 30).forEach(m => console.log(`  [${(m.ts/1000).toFixed(1)}s] ${m.text.substring(0, 200)}`));
  }

  // Show segment CDN domains
  if (segmentFetches.length > 0) {
    const segDomains = new Set(segmentFetches.map(s => { try { return new URL(s.url).hostname; } catch { return '?'; } }));
    console.log(`\nSegment CDN domains:`);
    [...segDomains].forEach(d => console.log(`  ${d}`));
  }

  console.log(`\nTotal time: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  console.log(`${'='.repeat(80)}\n`);

  await browser.close();
})().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
