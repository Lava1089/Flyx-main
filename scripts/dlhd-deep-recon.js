#!/usr/bin/env node
/**
 * DLHD Deep Recon v2 — March 27, 2026
 *
 * Goals:
 *   1. Find the actual working player page URL
 *   2. Capture the full iframe chain
 *   3. Intercept M3U8, key, and segment requests
 *   4. Dump page HTML at each level
 *   5. Figure out the fastest extraction path
 */

const { chromium } = require('playwright');
const fs = require('fs');

const CHANNEL = process.argv[2] || '51';
const TIMEOUT_MS = 90000;

// All known DLHD domains/entry points to try
const ENTRY_POINTS = [
  `https://dlhd.so/embed/stream-${CHANNEL}.php`,
  `https://dlhd.sx/embed/stream-${CHANNEL}.php`,
  `https://daddylive.dad/embed/stream-${CHANNEL}.php`,
  `https://thedaddy.to/embed/stream-${CHANNEL}.php`,
  `https://daddylivehd.com/embed/stream-${CHANNEL}.php`,
  `https://daddylivehd.sx/embed/stream-${CHANNEL}.php`,
  `https://dlhd.link/embed/stream-${CHANNEL}.php`,
  `https://www.ksohls.ru/premiumtv/daddyhd.php?id=${CHANNEL}`,
  `https://enviromentalspace.sbs/premiumtv/daddyhd.php?id=${CHANNEL}`,
];

const networkLog = [];
const keyFetches = [];
const m3u8Fetches = [];
const allResponses = [];
let startTime;

function ts() { return `[${((Date.now() - startTime) / 1000).toFixed(2)}s]`; }

(async () => {
  startTime = Date.now();
  console.log(`\n${'='.repeat(80)}`);
  console.log(`  DLHD DEEP RECON v2 — Channel ${CHANNEL}`);
  console.log(`  ${new Date().toISOString()}`);
  console.log(`${'='.repeat(80)}\n`);

  const browser = await chromium.launch({
    headless: false,
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

  // Block ads/tracking to speed things up
  await context.route(/doubleclick|googlesyndication|adservice|analytics|facebook|twitter|popads|popcash/, route => {
    route.abort();
  });

  function instrumentPage(page, label) {
    page.on('request', (req) => {
      const url = req.url();
      networkLog.push({ label, url, method: req.method(), type: req.resourceType() });

      if (url.includes('.m3u8') || url.includes('mono.css')) {
        m3u8Fetches.push({ url, headers: req.headers() });
        console.log(`${ts()} 📋 M3U8: ${url}`);
        const hdrs = req.headers();
        if (hdrs.origin) console.log(`     Origin: ${hdrs.origin}`);
        if (hdrs.referer) console.log(`     Referer: ${hdrs.referer}`);
      }
      if (url.includes('/key') || url.includes('/keys/')) {
        keyFetches.push({ url, headers: req.headers() });
        console.log(`${ts()} 🔑 KEY: ${url}`);
      }
    });

    page.on('response', async (resp) => {
      const url = resp.url();
      const status = resp.status();

      if ((url.includes('.m3u8') || url.includes('mono.css')) && status === 200) {
        try {
          const body = await resp.text();
          console.log(`${ts()} 📋 M3U8 BODY (${body.length}b):`);
          // Print the full M3U8 content for analysis
          const lines = body.split('\n');
          for (const line of lines) {
            if (line.trim()) console.log(`     ${line.trim()}`);
          }
        } catch {}
      }
      if (url.includes('/key') && status === 200) {
        try {
          const buf = await resp.body();
          console.log(`${ts()} 🔑 KEY RESPONSE: ${buf.length}b, hex=${buf.toString('hex').substring(0, 64)}`);
        } catch {}
      }
    });

    page.on('console', (msg) => {
      const text = msg.text();
      if (text.match(/key|auth|token|hls|m3u8|error|captcha|verify|whitelist|decrypt|stream/i)) {
        console.log(`${ts()} 💬 ${text.substring(0, 300)}`);
      }
    });

    page.on('frameattached', (frame) => {
      const url = frame.url();
      if (url && url !== 'about:blank') console.log(`${ts()} 🖼️  FRAME ATTACHED: ${url}`);
    });
    page.on('framenavigated', (frame) => {
      const url = frame.url();
      if (url && url !== 'about:blank') console.log(`${ts()} 🖼️  FRAME NAV: ${url}`);
    });
  }

  const page = await context.newPage();
  instrumentPage(page, 'main');

  // Listen for new pages (popups)
  context.on('page', async (newPage) => {
    console.log(`${ts()} 🆕 NEW PAGE/POPUP: ${newPage.url()}`);
    instrumentPage(newPage, 'popup');
  });

  // Try each entry point
  let workingUrl = null;
  let foundPlayer = false;

  for (const entryUrl of ENTRY_POINTS) {
    console.log(`\n${ts()} ─── Trying: ${entryUrl} ───`);
    try {
      const resp = await page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: 12000 });
      const status = resp?.status();
      const finalUrl = page.url();
      console.log(`${ts()} HTTP ${status} → ${finalUrl}`);

      if (status === 403 || status === 503 || status === 502) {
        console.log(`${ts()} ⛔ Blocked, next...`);
        continue;
      }

      // Get page HTML
      const html = await page.content();
      console.log(`${ts()} HTML length: ${html.length}`);

      // Check for iframe src in the HTML
      const iframeSrcs = html.match(/iframe[^>]*src=["']([^"']+)["']/gi);
      if (iframeSrcs) {
        console.log(`${ts()} Found iframes in HTML:`);
        iframeSrcs.forEach(m => console.log(`     ${m.substring(0, 200)}`));
      }

      // Check for known player patterns
      const hasPlayer = html.includes('daddyhd') || html.includes('stream-') || html.includes('clappr') ||
                        html.includes('hls.js') || html.includes('Hls(') || html.includes('jwplayer') ||
                        html.includes('video') || html.includes('player');

      if (hasPlayer) {
        console.log(`${ts()} ✅ PLAYER PAGE DETECTED`);
        workingUrl = entryUrl;
        foundPlayer = true;

        // Dump relevant HTML sections
        // Find script tags
        const scripts = html.match(/<script[^>]*>[\s\S]*?<\/script>/gi) || [];
        console.log(`${ts()} Found ${scripts.length} script tags`);
        for (const script of scripts) {
          if (script.includes('hls') || script.includes('Hls') || script.includes('m3u8') ||
              script.includes('key') || script.includes('clappr') || script.includes('source') ||
              script.includes('stream') || script.includes('channel') || script.includes('daddyhd') ||
              script.includes('embed') || script.includes('player')) {
            console.log(`\n${ts()} 📜 RELEVANT SCRIPT:`);
            console.log(script.substring(0, 2000));
          }
        }

        // Wait for iframes and network
        await page.waitForTimeout(3000);

        // Check all frames
        const frames = page.frames();
        console.log(`\n${ts()} ─── ${frames.length} frames total ───`);
        for (const frame of frames) {
          const furl = frame.url();
          if (furl && furl !== 'about:blank') {
            console.log(`  Frame: ${furl}`);
            try {
              const fhtml = await frame.content();
              console.log(`  HTML length: ${fhtml.length}`);

              // Check for player JS in iframes
              const fscripts = fhtml.match(/<script[^>]*>[\s\S]*?<\/script>/gi) || [];
              for (const script of fscripts) {
                if (script.includes('hls') || script.includes('Hls') || script.includes('m3u8') ||
                    script.includes('source') || script.includes('stream') || script.includes('mono')) {
                  console.log(`\n${ts()} 📜 IFRAME SCRIPT (${furl.substring(0, 60)}):`);
                  console.log(script.substring(0, 3000));
                }
              }

              // Look for video elements
              const videos = fhtml.match(/<video[^>]*>[\s\S]*?<\/video>/gi);
              if (videos) {
                console.log(`${ts()} 🎬 VIDEO ELEMENTS:`);
                videos.forEach(v => console.log(`     ${v.substring(0, 500)}`));
              }

              // Look for source URLs in HTML
              const sources = fhtml.match(/https?:\/\/[^\s"'<>]+(?:mono\.css|\.m3u8|stream|proxy)[^\s"'<>]*/g);
              if (sources) {
                console.log(`${ts()} 🔗 STREAM URLS FOUND IN HTML:`);
                [...new Set(sources)].forEach(s => console.log(`     ${s}`));
              }
            } catch (e) {
              console.log(`  (couldn't read frame content: ${e.message.substring(0, 80)})`);
            }
          }
        }

        // Wait for M3U8/key network calls
        console.log(`\n${ts()} Waiting up to 40s for M3U8 + key fetches...`);
        const waitStart = Date.now();
        while (Date.now() - waitStart < 40000) {
          if (m3u8Fetches.length > 0 && keyFetches.length > 0) {
            console.log(`${ts()} ✅ Got M3U8 + keys! Waiting 5s more...`);
            await page.waitForTimeout(5000);
            break;
          }
          if (m3u8Fetches.length > 0 && Date.now() - waitStart > 15000) {
            console.log(`${ts()} Got M3U8 but no keys after 15s, continuing...`);
            break;
          }
          await page.waitForTimeout(1000);
        }

        break; // Found a working player, stop trying
      }

      // Even if no player detected, dump HTML for analysis if it's not a redirect to root
      if (finalUrl !== 'about:blank' && !finalUrl.endsWith('/') && html.length > 500) {
        console.log(`${ts()} Page content preview:`);
        console.log(html.substring(0, 1500));
      }

    } catch (e) {
      console.log(`${ts()} Error: ${e.message.substring(0, 200)}`);
    }
  }

  // ─── SUMMARY ──────────────────────────────────────────────────
  console.log(`\n${'='.repeat(80)}`);
  console.log(`  SUMMARY`);
  console.log(`${'='.repeat(80)}\n`);

  console.log(`Working URL: ${workingUrl || 'NONE'}`);
  console.log(`Total requests: ${networkLog.length}`);
  console.log(`M3U8 fetches: ${m3u8Fetches.length}`);
  console.log(`Key fetches: ${keyFetches.length}`);

  if (m3u8Fetches.length > 0) {
    console.log(`\nM3U8 URLs:`);
    m3u8Fetches.forEach(f => console.log(`  ${f.url}`));
  }
  if (keyFetches.length > 0) {
    console.log(`\nKey URLs:`);
    keyFetches.forEach(f => console.log(`  ${f.url}`));
  }

  // Unique domains
  const domains = new Set(networkLog.map(e => { try { return new URL(e.url).hostname; } catch { return '?'; } }));
  console.log(`\nDomains contacted (${domains.size}):`);
  [...domains].sort().forEach(d => console.log(`  ${d}`));

  // Dump full network log to file for analysis
  const logPath = 'scripts/dlhd-recon-network.json';
  fs.writeFileSync(logPath, JSON.stringify({ networkLog, m3u8Fetches, keyFetches }, null, 2));
  console.log(`\nFull network log saved to: ${logPath}`);

  console.log(`\nTotal time: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

  await browser.close();
})().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
