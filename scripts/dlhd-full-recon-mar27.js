#!/usr/bin/env node
/**
 * DLHD Full Security Recon — March 27, 2026 (post-security-update)
 *
 * Captures EVERYTHING:
 *   - Full request/response headers for verify, key, M3U8
 *   - Request bodies (POST verify)
 *   - Response bodies (verify JSON, M3U8 content, key bytes)
 *   - All cookies set
 *   - All inline JS (player init, auth logic)
 *   - iframe chain
 *   - Console messages
 *   - Any new auth tokens, fingerprints, headers
 */

const { chromium } = require('playwright');
const fs = require('fs');

const CHANNEL = process.argv[2] || '51';
let startTime;
function ts() { return `[${((Date.now() - startTime) / 1000).toFixed(2)}s]`; }

const data = {
  verifyRequests: [],
  verifyResponses: [],
  keyRequests: [],
  keyResponses: [],
  m3u8Requests: [],
  m3u8Responses: [],
  lookupRequests: [],
  lookupResponses: [],
  cookies: [],
  allRequests: [],
  consoleMessages: [],
  scripts: [],
};

(async () => {
  startTime = Date.now();
  console.log(`\n${'='.repeat(80)}`);
  console.log(`  DLHD FULL SECURITY RECON — Channel ${CHANNEL}`);
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

  // Block ads only
  await context.route(/doubleclick|googlesyndication|analytics\.google|histats|xadsmart|dtscout|rtmark|protraffic|usrpubtrk|405kk|kofeslos|al5sm/, r => r.abort());

  context.on('page', (p) => console.log(`${ts()} 🆕 POPUP: ${p.url()}`));

  const page = await context.newPage();

  // ─── REQUEST INTERCEPTION ─────────────────────────────────────────
  page.on('request', (req) => {
    const url = req.url();
    const method = req.method();
    const headers = req.headers();
    const postData = req.postData();

    data.allRequests.push({ url: url.substring(0, 200), method });

    // VERIFY requests — capture EVERYTHING
    if (url.includes('/verify')) {
      const entry = { url, method, headers: { ...headers }, postData, ts: Date.now() - startTime };
      data.verifyRequests.push(entry);
      console.log(`\n${ts()} ━━━ VERIFY REQUEST ━━━`);
      console.log(`  ${method} ${url}`);
      console.log(`  Headers:`);
      for (const [k, v] of Object.entries(headers)) {
        if (!['accept-encoding', 'accept-language', 'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'].includes(k))
          console.log(`    ${k}: ${v}`);
      }
      if (postData) {
        console.log(`  Body: ${postData}`);
        try {
          const parsed = JSON.parse(postData);
          console.log(`  Parsed body keys: ${Object.keys(parsed).join(', ')}`);
        } catch {}
      }
    }

    // KEY requests
    if (url.match(/\/key[\/\?]/)) {
      const entry = { url, method, headers: { ...headers }, ts: Date.now() - startTime };
      data.keyRequests.push(entry);
      console.log(`\n${ts()} ━━━ KEY REQUEST ━━━`);
      console.log(`  ${method} ${url}`);
      console.log(`  Headers:`);
      for (const [k, v] of Object.entries(headers)) {
        if (k.startsWith('x-') || ['origin', 'referer', 'authorization', 'cookie'].includes(k))
          console.log(`    ${k}: ${v}`);
      }
    }

    // M3U8 requests
    if (url.includes('.m3u8') || url.includes('mono.css')) {
      const entry = { url, method, headers: { ...headers }, ts: Date.now() - startTime };
      data.m3u8Requests.push(entry);
      console.log(`\n${ts()} ━━━ M3U8 REQUEST ━━━`);
      console.log(`  ${method} ${url}`);
      console.log(`  Origin: ${headers.origin || '-'}`);
      console.log(`  Referer: ${headers.referer || '-'}`);
    }

    // Server lookup
    if (url.includes('server_lookup')) {
      data.lookupRequests.push({ url, method, headers: { ...headers } });
      console.log(`${ts()} 🔍 LOOKUP: ${url}`);
    }
  });

  // ─── RESPONSE INTERCEPTION ────────────────────────────────────────
  page.on('response', async (resp) => {
    const url = resp.url();
    const status = resp.status();
    const respHeaders = resp.headers();

    // VERIFY responses
    if (url.includes('/verify')) {
      try {
        const body = await resp.text();
        const entry = { url, status, headers: { ...respHeaders }, body, ts: Date.now() - startTime };
        data.verifyResponses.push(entry);
        console.log(`\n${ts()} ━━━ VERIFY RESPONSE ━━━`);
        console.log(`  ${status} ${url}`);
        console.log(`  Body: ${body}`);
        console.log(`  CORS: ${respHeaders['access-control-allow-origin'] || '-'}`);
        console.log(`  Set-Cookie: ${respHeaders['set-cookie'] || '-'}`);
        for (const [k, v] of Object.entries(respHeaders)) {
          if (k.startsWith('x-') || k === 'set-cookie')
            console.log(`    ${k}: ${v}`);
        }
      } catch {}
    }

    // KEY responses
    if (url.match(/\/key[\/\?]/) && status === 200) {
      try {
        const buf = await resp.body();
        const entry = { url, status, size: buf.length, hex: buf.toString('hex'), headers: { ...respHeaders }, ts: Date.now() - startTime };
        data.keyResponses.push(entry);
        console.log(`\n${ts()} ━━━ KEY RESPONSE ━━━`);
        console.log(`  ${status} ${url}`);
        console.log(`  Size: ${buf.length}b  Hex: ${buf.toString('hex')}`);
        console.log(`  CORS: ${respHeaders['access-control-allow-origin'] || '-'}`);
        for (const [k, v] of Object.entries(respHeaders)) {
          if (k.startsWith('x-'))
            console.log(`    ${k}: ${v}`);
        }
      } catch {}
    }

    // M3U8 responses
    if ((url.includes('.m3u8') || url.includes('mono.css')) && status === 200) {
      try {
        const body = await resp.text();
        if (body.includes('#EXTM3U') || body.includes('#EXT-X-')) {
          data.m3u8Responses.push({ url, status, body, headers: { ...respHeaders } });
          console.log(`\n${ts()} ━━━ M3U8 RESPONSE ━━━`);
          console.log(`  ${status} ${url} (${body.length}b)`);
          const lines = body.split('\n');
          for (const line of lines) {
            if (line.trim()) console.log(`  ${line.trim()}`);
          }
        }
      } catch {}
    }

    // Server lookup
    if (url.includes('server_lookup') && status === 200) {
      try {
        const body = await resp.text();
        data.lookupResponses.push({ url, status, body });
        console.log(`${ts()} 🔍 LOOKUP RESPONSE: ${body.substring(0, 200)}`);
      } catch {}
    }
  });

  // ─── CONSOLE MESSAGES ─────────────────────────────────────────────
  page.on('console', (msg) => {
    const text = msg.text();
    data.consoleMessages.push({ ts: Date.now() - startTime, text: text.substring(0, 500) });
    if (text.match(/key|auth|token|hls|m3u8|error|captcha|verify|whitelist|decrypt|stream|source|mono|server|recaptcha|blocked|denied|forbidden/i)) {
      console.log(`${ts()} 💬 ${text.substring(0, 300)}`);
    }
  });

  page.on('framenavigated', (frame) => {
    const url = frame.url();
    if (url && url !== 'about:blank' && !url.startsWith('data:') && !url.startsWith('chrome-error:'))
      console.log(`${ts()} 🖼️  FRAME: ${url}`);
  });

  // ─── NAVIGATE ─────────────────────────────────────────────────────
  console.log(`${ts()} Loading player page...\n`);
  try {
    await page.goto(`https://dlstreams.top/embed/stream-${CHANNEL}.php`, {
      waitUntil: 'domcontentloaded', timeout: 15000,
    });
  } catch (e) {
    console.log(`${ts()} Nav: ${e.message.substring(0, 100)}`);
  }

  // Wait for reCAPTCHA → verify → M3U8 → key
  console.log(`\n${ts()} Waiting for full flow (up to 25s)...\n`);
  const waitStart = Date.now();
  while (Date.now() - waitStart < 25000) {
    if (data.keyResponses.length > 0 && data.m3u8Responses.length > 0) {
      console.log(`${ts()} ✅ Got key + M3U8, waiting 3s more...`);
      await page.waitForTimeout(3000);
      break;
    }
    await page.waitForTimeout(500);
  }

  // ─── DUMP FRAME SCRIPTS ──────────────────────────────────────────
  console.log(`\n${ts()} ─── Extracting scripts from all frames ───\n`);
  for (const frame of page.frames()) {
    const furl = frame.url();
    if (!furl || furl === 'about:blank' || furl.startsWith('data:') || furl.startsWith('chrome-error:')) continue;
    try {
      const fhtml = await frame.content();
      const scriptRegex = /<script(?:\s[^>]*)?>(?!<)([\s\S]*?)<\/script>/gi;
      let match;
      while ((match = scriptRegex.exec(fhtml)) !== null) {
        const s = match[1].trim();
        if (s.length > 30 && s.match(/hls|source|stream|m3u8|mono|key|channel|proxy|chevy|clappr|verify|recaptcha|server|auth|token|whitelist|soyspace|ai-hls|keylocking/i)) {
          data.scripts.push({ frame: furl.substring(0, 60), content: s.substring(0, 8000) });
          console.log(`📜 SCRIPT (${furl.substring(0, 50)}):`);
          console.log('─'.repeat(60));
          console.log(s.substring(0, 6000));
          console.log('─'.repeat(60));
          console.log('');
        }
      }
    } catch {}
  }

  // ─── GET COOKIES ──────────────────────────────────────────────────
  const cookies = await context.cookies();
  data.cookies = cookies;
  if (cookies.length > 0) {
    console.log(`\n${ts()} 🍪 COOKIES (${cookies.length}):`);
    for (const c of cookies) {
      console.log(`  ${c.domain} ${c.name}=${c.value.substring(0, 60)}`);
    }
  }

  // ─── SUMMARY ──────────────────────────────────────────────────────
  console.log(`\n${'='.repeat(80)}`);
  console.log(`  SECURITY ANALYSIS SUMMARY`);
  console.log(`${'='.repeat(80)}\n`);

  console.log(`Verify requests: ${data.verifyRequests.length}`);
  console.log(`Verify responses: ${data.verifyResponses.length}`);
  console.log(`Key requests: ${data.keyRequests.length}`);
  console.log(`Key responses: ${data.keyResponses.length}`);
  console.log(`M3U8 requests: ${data.m3u8Requests.length}`);
  console.log(`M3U8 responses: ${data.m3u8Responses.length}`);
  console.log(`Lookup requests: ${data.lookupRequests.length}`);
  console.log(`Total requests: ${data.allRequests.length}`);
  console.log(`Cookies: ${data.cookies.length}`);

  if (data.verifyRequests.length > 0) {
    console.log(`\n─── VERIFY FLOW ───`);
    const vr = data.verifyRequests[0];
    console.log(`  POST ${vr.url}`);
    console.log(`  Origin: ${vr.headers.origin}`);
    console.log(`  Referer: ${vr.headers.referer}`);
    if (vr.postData) {
      try {
        const body = JSON.parse(vr.postData);
        console.log(`  Body keys: ${Object.keys(body).join(', ')}`);
        for (const [k, v] of Object.entries(body)) {
          if (k === 'recaptcha-token') console.log(`  ${k}: ${String(v).substring(0, 40)}...`);
          else console.log(`  ${k}: ${v}`);
        }
      } catch {}
    }
  }

  if (data.verifyResponses.length > 0) {
    console.log(`\n─── VERIFY RESPONSE ───`);
    console.log(`  ${data.verifyResponses[0].body}`);
  }

  if (data.keyRequests.length > 0) {
    console.log(`\n─── KEY AUTH HEADERS ───`);
    const kr = data.keyRequests[0];
    console.log(`  URL: ${kr.url}`);
    for (const [k, v] of Object.entries(kr.headers)) {
      if (k.startsWith('x-') || ['origin', 'referer', 'authorization', 'cookie'].includes(k))
        console.log(`  ${k}: ${v}`);
    }
  }

  if (data.keyResponses.length > 0) {
    console.log(`\n─── KEY RESPONSE ───`);
    const kr = data.keyResponses[0];
    console.log(`  Hex: ${kr.hex}`);
    console.log(`  Size: ${kr.size}b`);
    for (const [k, v] of Object.entries(kr.headers)) {
      if (k.startsWith('x-'))
        console.log(`  ${k}: ${v}`);
    }
  }

  // Unique domains
  const domains = new Set(data.allRequests.map(r => { try { return new URL(r.url).hostname; } catch { return '?'; } }));
  console.log(`\n─── DOMAINS (${domains.size}) ───`);
  [...domains].sort().forEach(d => console.log(`  ${d}`));

  // Save full data
  const outPath = 'scripts/dlhd-security-recon-mar27.json';
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(`\nFull data saved: ${outPath}`);
  console.log(`Time: ${((Date.now() - startTime) / 1000).toFixed(1)}s\n`);

  await browser.close();
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
