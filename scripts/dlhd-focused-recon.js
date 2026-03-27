#!/usr/bin/env node
/**
 * DLHD Focused Recon v4 — March 27, 2026
 *
 * Strategy: Use separate pages for each attempt, don't close popups
 * (they may be required by the site), block only known ad domains.
 */

const { chromium } = require('playwright');
const fs = require('fs');

const CHANNEL = process.argv[2] || '51';
let startTime;
function ts() { return `[${((Date.now() - startTime) / 1000).toFixed(2)}s]`; }

const m3u8Bodies = [];
const keyData = [];
const networkLog = [];

(async () => {
  startTime = Date.now();
  console.log(`\n${'='.repeat(80)}`);
  console.log(`  DLHD FOCUSED RECON v4 — Channel ${CHANNEL}`);
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

  // Block only known ad/tracker domains (not popups)
  const adDomains = /doubleclick|googlesyndication|analytics\.google|facebook\.com\/tr|histats|xadsmart|dtscout|rtmark|protraffic|usrpubtrk/;
  await context.route(url => adDomains.test(url.toString()), route => route.abort());

  // Track popups but don't close them
  const popupPages = [];
  context.on('page', (newPage) => {
    const url = newPage.url();
    console.log(`${ts()} 🆕 POPUP: ${url}`);
    popupPages.push(newPage);
  });

  function instrumentPage(page, label) {
    page.on('request', (req) => {
      const url = req.url();
      networkLog.push({ label, url, method: req.method(), type: req.resourceType() });

      if (url.includes('.m3u8') || url.includes('mono.css') || url.includes('mono.m3u8')) {
        console.log(`${ts()} 📋 M3U8 REQ [${label}]: ${url}`);
        const h = req.headers();
        console.log(`     Origin: ${h.origin || '-'}, Referer: ${h.referer || '-'}`);
      }
      if (url.match(/\/key[\/\?]/) || url.includes('/keys/')) {
        console.log(`${ts()} 🔑 KEY REQ [${label}]: ${url}`);
        const h = req.headers();
        const interesting = Object.entries(h).filter(([k]) =>
          k.startsWith('x-') || k === 'authorization' || k === 'origin' || k === 'referer'
        );
        if (interesting.length) console.log(`     ${JSON.stringify(Object.fromEntries(interesting))}`);
      }
      if (url.includes('/verify')) {
        console.log(`${ts()} ✅ VERIFY REQ [${label}]: ${req.method()} ${url}`);
      }
      if (url.includes('recaptcha') && !url.includes('.js') && !url.includes('.png')) {
        console.log(`${ts()} 🤖 CAPTCHA [${label}]: ${url.substring(0, 120)}`);
      }
    });

    page.on('response', async (resp) => {
      const url = resp.url();
      const status = resp.status();

      if ((url.includes('.m3u8') || url.includes('mono.css') || url.includes('mono.m3u8')) && status === 200) {
        try {
          const body = await resp.text();
          m3u8Bodies.push({ url, body, status });
          console.log(`\n${ts()} 📋 M3U8 BODY [${label}] (${body.length}b):`);
          console.log('─'.repeat(60));
          console.log(body);
          console.log('─'.repeat(60));
        } catch (e) {}
      }
      if (url.match(/\/key[\/\?]/) && status === 200) {
        try {
          const buf = await resp.body();
          const hex = buf.toString('hex');
          keyData.push({ url, hex, size: buf.length });
          console.log(`${ts()} 🔑 KEY RESP [${label}]: ${hex} (${buf.length}b)`);
        } catch (e) {}
      }
      if (url.includes('/verify') && status >= 200) {
        try {
          const body = await resp.text();
          console.log(`${ts()} ✅ VERIFY RESP [${label}] ${status}: ${body.substring(0, 300)}`);
        } catch (e) {}
      }
    });

    page.on('console', (msg) => {
      const text = msg.text();
      if (text.match(/key|auth|token|hls|m3u8|error|captcha|verify|whitelist|decrypt|stream|source|mono|EXT-X/i)) {
        console.log(`${ts()} 💬 [${label}] ${text.substring(0, 400)}`);
      }
    });

    page.on('framenavigated', (frame) => {
      const url = frame.url();
      if (url && url !== 'about:blank' && !url.startsWith('data:') && !url.startsWith('chrome-error:')) {
        const isMain = frame === page.mainFrame() ? ' (MAIN)' : '';
        console.log(`${ts()} 🖼️  FRAME${isMain} [${label}]: ${url}`);
      }
    });
  }

  // Target URLs to try — each in its own page
  const targets = [
    `https://dlstreams.top/embed/stream-${CHANNEL}.php`,
    `https://dlhd.so/embed/stream-${CHANNEL}.php`,
    `https://daddyhd.com/embed/stream-${CHANNEL}.php`,
  ];

  for (const targetUrl of targets) {
    console.log(`\n${ts()} ━━━ Trying: ${targetUrl} ━━━\n`);

    const page = await context.newPage();
    instrumentPage(page, targetUrl.split('/')[2]);

    try {
      const resp = await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 15000
      });
      const status = resp?.status();
      console.log(`${ts()} HTTP ${status}`);

      if (status >= 400) {
        console.log(`${ts()} ⛔ ${status}, skipping`);
        await page.close();
        continue;
      }

      // Wait for content to load
      await page.waitForTimeout(3000);

      // Get the page HTML
      try {
        const html = await page.content();
        console.log(`${ts()} HTML: ${html.length} chars`);

        // Find iframes
        const iframeRegex = /iframe[^>]*src=["']([^"']+)["']/gi;
        let match;
        while ((match = iframeRegex.exec(html)) !== null) {
          console.log(`${ts()} IFRAME SRC: ${match[1]}`);
        }

        // Find inline scripts with player logic
        const scriptRegex = /<script(?:\s[^>]*)?>(?!<)([\s\S]*?)<\/script>/gi;
        while ((match = scriptRegex.exec(html)) !== null) {
          const s = match[1].trim();
          if (s.length > 20 && s.match(/hls|clappr|m3u8|stream|source|player|mono|key|embed|proxy|chevy|soyspace|channel/i)) {
            console.log(`\n${ts()} 📜 SCRIPT:`);
            console.log('─'.repeat(60));
            console.log(s.substring(0, 5000));
            console.log('─'.repeat(60));
          }
        }
      } catch (e) {
        console.log(`${ts()} Could not read HTML: ${e.message.substring(0, 80)}`);
      }

      // Check all frames for player content
      const frames = page.frames();
      console.log(`\n${ts()} ${frames.length} frames:`);
      for (const frame of frames) {
        const furl = frame.url();
        if (!furl || furl === 'about:blank' || furl.startsWith('data:') || furl.startsWith('chrome-error:')) continue;
        console.log(`  → ${furl}`);
        try {
          const fhtml = await frame.content();
          // Find stream URLs
          const urls = fhtml.match(/https?:\/\/[^\s"'<>\\]+(?:mono\.css|\.m3u8|\/proxy\/|chevy\.|soyspace)/g);
          if (urls) {
            console.log(`     🔗 STREAM URLS:`);
            [...new Set(urls)].forEach(s => console.log(`        ${s}`));
          }
          // Check for player code
          const scriptRegex2 = /<script(?:\s[^>]*)?>(?!<)([\s\S]*?)<\/script>/gi;
          let fmatch;
          while ((fmatch = scriptRegex2.exec(fhtml)) !== null) {
            const s = fmatch[1].trim();
            if (s.length > 20 && s.match(/hls|source|stream|m3u8|mono|key|channel|proxy|chevy|clappr/i)) {
              console.log(`\n     📜 IFRAME SCRIPT:`);
              console.log('     ' + '─'.repeat(55));
              console.log(s.substring(0, 5000));
              console.log('     ' + '─'.repeat(55));
            }
          }
        } catch (e) {
          console.log(`     (can't read: ${e.message.substring(0, 60)})`);
        }
      }

      // Wait for M3U8/key network
      if (m3u8Bodies.length === 0) {
        console.log(`\n${ts()} Waiting up to 45s for M3U8...`);
        const waitStart = Date.now();
        while (Date.now() - waitStart < 45000) {
          if (m3u8Bodies.length > 0) {
            console.log(`${ts()} ✅ M3U8 captured! Waiting 10s for keys...`);
            await page.waitForTimeout(10000);
            break;
          }
          await page.waitForTimeout(2000);

          // Periodically re-check frames (new ones may appear)
          if ((Date.now() - waitStart) % 10000 < 2000) {
            const currentFrames = page.frames();
            for (const frame of currentFrames) {
              try {
                const fhtml = await frame.content();
                const urls = fhtml.match(/https?:\/\/[^\s"'<>\\]+(?:mono\.css|\.m3u8|\/proxy\/|chevy\.|soyspace)/g);
                if (urls) {
                  console.log(`${ts()} 🔗 Stream URLs found in frame ${frame.url().substring(0, 50)}:`);
                  [...new Set(urls)].forEach(s => console.log(`     ${s}`));
                }
              } catch {}
            }
          }
        }
      }

      if (m3u8Bodies.length > 0) break;

      // If we didn't get M3U8, dump what we know and move on
      console.log(`${ts()} No M3U8 from this URL, trying next...`);

    } catch (e) {
      console.log(`${ts()} Error: ${e.message.substring(0, 200)}`);
    }
  }

  // ─── ANALYSIS ──────────────────────────────────────────
  console.log(`\n${'='.repeat(80)}`);
  console.log(`  EXTRACTION ANALYSIS`);
  console.log(`${'='.repeat(80)}\n`);

  if (m3u8Bodies.length > 0) {
    console.log(`✅ M3U8 playlists: ${m3u8Bodies.length}`);
    for (const m of m3u8Bodies) {
      console.log(`\n  URL: ${m.url}`);
      const lines = m.body.split('\n');
      const keyLine = lines.find(l => l.includes('EXT-X-KEY'));
      const segments = lines.filter(l => l.trim() && !l.startsWith('#'));
      if (keyLine) console.log(`  KEY LINE: ${keyLine.trim()}`);
      console.log(`  SEGMENTS: ${segments.length}`);
    }
  } else {
    console.log(`❌ No M3U8 captured`);
  }

  if (keyData.length > 0) {
    console.log(`\n✅ Keys: ${keyData.length}`);
    keyData.forEach(k => console.log(`  ${k.hex} (${k.size}b) from ${k.url.substring(0, 80)}`));
  }

  // All unique domains
  const domains = new Set(networkLog.map(e => { try { return new URL(e.url).hostname; } catch { return '?'; } }));
  console.log(`\nAll domains (${domains.size}):`);
  [...domains].sort().forEach(d => console.log(`  ${d}`));

  // Stream-related requests
  const streamReqs = networkLog.filter(e => e.url.match(/m3u8|mono\.css|\/key|\/proxy|chevy|soyspace|\/verify/));
  if (streamReqs.length) {
    console.log(`\nStream-related requests (${streamReqs.length}):`);
    streamReqs.forEach(r => console.log(`  ${r.method} ${r.url.substring(0, 120)}`));
  }

  const outPath = 'scripts/dlhd-recon-v4.json';
  fs.writeFileSync(outPath, JSON.stringify({ m3u8Bodies, keyData, networkLog }, null, 2));
  console.log(`\nSaved to: ${outPath}`);
  console.log(`Time: ${((Date.now() - startTime) / 1000).toFixed(1)}s\n`);

  await browser.close();
})().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
