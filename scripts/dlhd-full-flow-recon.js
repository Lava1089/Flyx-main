#!/usr/bin/env node
/**
 * DLHD Full Flow Recon — March 2026
 * 
 * Follows the REAL user flow from the DLHD homepage:
 *   1. Go to dlstreams.top (main site)
 *   2. Navigate to a stream page (stream-44.php)
 *   3. The stream page has an iframe → player page (adffdafdsafds.sbs)
 *   4. Player page does reCAPTCHA v3 → verify → whitelist IP
 *   5. Player fetches M3U8 from go.ai-chatx.site/proxy/...
 *   6. HLS.js fetches keys from /key/premium44/NNNN
 *   7. HLS.js fetches segments from CDN
 * 
 * We capture EVERYTHING at each step.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');

const CHANNEL = process.argv[2] || '44';
const MAIN_SITE = 'https://dlstreams.top';
const STREAM_PAGE = `${MAIN_SITE}/stream/stream-${CHANNEL}.php`;

const recon = {
  step1_mainSite: { status: null, redirects: [] },
  step2_streamPage: { status: null, iframeSrc: null },
  step3_playerPage: { status: null, url: null, html: null },
  step4_recaptcha: { verifyReqs: [], verifyResps: [], cookies: [] },
  step5_m3u8: { url: null, headers: null, content: null, keyUris: [], segUrls: [] },
  step6_keys: { requests: [], responses: [] },
  step7_segments: { count: 0, domains: new Set() },
  allDomains: {},
  pageLogs: [],
};

function log(emoji, msg) { console.log(`${emoji} ${msg}`); }

async function shot(page, name) {
  const f = `scripts/recon-${name}.png`;
  await page.screenshot({ path: f });
  log('📸', `Screenshot: ${f}`);
}


async function main() {
  log('🚀', `DLHD Full Flow Recon — Channel ${CHANNEL}\n`);

  const browser = await puppeteer.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-features=IsolateOrigins,site-per-process', // Allow cross-origin iframe access
    ],
    defaultViewport: { width: 1366, height: 768 },
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
  );

  // Global request/response interceptors
  await page.setRequestInterception(true);

  page.on('request', (req) => {
    const url = req.url();
    const method = req.method();
    const hdrs = req.headers();
    const post = req.postData();

    try { const d = new URL(url).hostname; recon.allDomains[d] = (recon.allDomains[d] || 0) + 1; } catch {}

    // Verify endpoint
    if (url.includes('/verify') && !url.includes('google')) {
      log('🔑', `VERIFY ${method} ${url}`);
      if (post) log('  ', `Body: ${post.substring(0, 400)}`);
      log('  ', `Headers: origin=${hdrs.origin || '-'} referer=${hdrs.referer || '-'}`);
      recon.step4_recaptcha.verifyReqs.push({ url, method, headers: hdrs, body: post });
    }

    // M3U8
    if (url.includes('mono.css') || url.includes('mono.csv') || url.match(/\.m3u8(\?|$)/)) {
      log('📺', `M3U8 REQ ${url.substring(0, 160)}`);
      log('  ', `Referer: ${hdrs.referer || '-'} | Origin: ${hdrs.origin || '-'} | Auth: ${hdrs.authorization ? hdrs.authorization.substring(0, 40) + '...' : '-'}`);
      if (!recon.step5_m3u8.url) {
        recon.step5_m3u8.url = url;
        recon.step5_m3u8.headers = hdrs;
      }
    }

    // Key
    if (url.match(/\/key\/premium\d+\/\d+/)) {
      log('🔐', `KEY REQ ${url.substring(0, 160)}`);
      log('  ', `Headers: ${JSON.stringify(hdrs, null, 2).substring(0, 600)}`);
      recon.step6_keys.requests.push({ url, headers: hdrs, timestamp: Date.now() });
    }

    // Segments
    if (req.resourceType() === 'media' || req.resourceType() === 'image' || req.resourceType() === 'other') {
      if (url.match(/\.(png|jpg|ts)(\?|$)/) && (
        url.includes('r2.dev') || url.includes('r2.flux') || url.includes('dreamvideo') ||
        url.includes('s3.amazonaws') || url.includes('cgdream') || url.includes('visualgpt') ||
        url.includes('iuimg.com')
      )) {
        recon.step7_segments.count++;
        try { recon.step7_segments.domains.add(new URL(url).hostname); } catch {}
      }
    }

    req.continue();
  });

  page.on('response', async (res) => {
    const url = res.url();
    const status = res.status();
    try {
      // Verify response
      if (url.includes('/verify') && !url.includes('google')) {
        const body = await res.text().catch(() => '?');
        const rh = res.headers();
        log('🔑', `VERIFY RESP ${status}: ${body.substring(0, 400)}`);
        if (rh['set-cookie']) log('  ', `Set-Cookie: ${rh['set-cookie']}`);
        recon.step4_recaptcha.verifyResps.push({ status, body, headers: rh });
      }

      // M3U8 response
      if ((url.includes('mono.css') || url.includes('mono.csv') || url.match(/\.m3u8(\?|$)/)) && status === 200) {
        const body = await res.text().catch(() => null);
        if (body && body.includes('#EXTM3U') && !recon.step5_m3u8.content) {
          recon.step5_m3u8.content = body;
          log('📺', `M3U8 RESP ${body.length}b from ${url.substring(0, 120)}`);
          for (const line of body.split('\n')) {
            const m = line.match(/URI="([^"]+)"/);
            if (m) { recon.step5_m3u8.keyUris.push(m[1]); log('  ', `Key URI: ${m[1].substring(0, 200)}`); }
            const t = line.trim();
            if (t && !t.startsWith('#')) recon.step5_m3u8.segUrls.push(t);
          }
        }
      }

      // Key response
      if (url.match(/\/key\/premium\d+\/\d+/)) {
        try {
          const buf = await res.buffer();
          const hex = buf.length === 16 ? buf.toString('hex') : `${buf.length}b`;
          const fakes = new Set(['45db13cfa0ed393fdb7da4dfe9b5ac81', '455806f8bc592fdacb6ed5e071a517b1']);
          const isFake = fakes.has(hex);
          log('🔐', `KEY RESP ${status} | ${buf.length}b | ${hex} | fake=${isFake}`);
          log('  ', `Resp headers: ${JSON.stringify(res.headers(), null, 2).substring(0, 400)}`);
          recon.step6_keys.responses.push({ url, status, size: buf.length, hex, isFake, headers: res.headers() });
        } catch {}
      }
    } catch {}
  });

  // Page console
  page.on('console', (msg) => {
    const t = msg.text();
    if (t.match(/recaptcha|verify|whitelist|error|stream|channel|player|clappr|hls|key|m3u8|mono/i)) {
      log('💬', `[PAGE] ${t.substring(0, 250)}`);
      recon.pageLogs.push(t.substring(0, 300));
    }
  });

  // ============================================================
  // STEP 1: Go to main site
  // ============================================================
  log('📍', `STEP 1: Navigate to main site ${MAIN_SITE}`);
  try {
    const resp = await page.goto(MAIN_SITE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    recon.step1_mainSite.status = resp.status();
    log('  ', `Status: ${resp.status()} | URL: ${page.url()}`);
    await new Promise(r => setTimeout(r, 2000));
    await shot(page, '01-main-site');
  } catch (e) {
    log('❌', `Main site error: ${e.message}`);
  }

  // ============================================================
  // STEP 2: Navigate to stream page
  // ============================================================
  log('\n📍', `STEP 2: Navigate to stream page ${STREAM_PAGE}`);
  try {
    const resp = await page.goto(STREAM_PAGE, { waitUntil: 'domcontentloaded', timeout: 20000, referer: MAIN_SITE + '/' });
    recon.step2_streamPage.status = resp.status();
    log('  ', `Status: ${resp.status()} | URL: ${page.url()}`);
    await new Promise(r => setTimeout(r, 2000));
    await shot(page, '02-stream-page');

    // Find the player iframe
    const iframeSrc = await page.evaluate(() => {
      const iframes = document.querySelectorAll('iframe');
      const srcs = [];
      for (const f of iframes) {
        if (f.src) srcs.push(f.src);
      }
      return srcs;
    });
    log('  ', `Iframes found: ${iframeSrc.length}`);
    for (const src of iframeSrc) {
      log('  ', `  → ${src.substring(0, 200)}`);
    }
    recon.step2_streamPage.iframeSrc = iframeSrc;
  } catch (e) {
    log('❌', `Stream page error: ${e.message}`);
  }

  // ============================================================
  // STEP 3: Navigate directly to the player iframe URL
  // ============================================================
  const playerUrl = recon.step2_streamPage.iframeSrc?.[0];
  if (playerUrl) {
    log('\n📍', `STEP 3: Navigate to player page ${playerUrl.substring(0, 120)}`);
    try {
      // Navigate to the player page with the stream page as referer
      const resp = await page.goto(playerUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
        referer: STREAM_PAGE,
      });
      recon.step3_playerPage.status = resp.status();
      recon.step3_playerPage.url = page.url();
      log('  ', `Status: ${resp.status()} | URL: ${page.url()}`);
      await new Promise(r => setTimeout(r, 3000));
      await shot(page, '03-player-page');

      // Grab the page HTML for analysis
      const html = await page.content();
      recon.step3_playerPage.html = html.substring(0, 5000);
      
      // Check what's on the page
      const pageInfo = await page.evaluate(() => {
        return {
          title: document.title,
          bodyText: document.body?.innerText?.substring(0, 500) || '',
          hasVerifyBox: !!document.getElementById('verify-box'),
          hasGrecaptcha: typeof grecaptcha !== 'undefined',
          hasVerifyFn: typeof verifyRecaptcha === 'function',
          hasClappr: typeof Clappr !== 'undefined',
          scripts: Array.from(document.querySelectorAll('script[src]')).map(s => s.src).slice(0, 10),
          channelKey: typeof CHANNEL_KEY !== 'undefined' ? CHANNEL_KEY : null,
        };
      });
      log('  ', `Title: ${pageInfo.title}`);
      log('  ', `Body: ${pageInfo.bodyText.substring(0, 200)}`);
      log('  ', `Verify box: ${pageInfo.hasVerifyBox} | grecaptcha: ${pageInfo.hasGrecaptcha} | verifyFn: ${pageInfo.hasVerifyFn}`);
      log('  ', `Clappr: ${pageInfo.hasClappr} | CHANNEL_KEY: ${pageInfo.channelKey}`);

      if (pageInfo.bodyText.includes('403') || pageInfo.bodyText.includes('Forbidden')) {
        log('⚠️', 'Player page returned 403 — trying alternate referer...');
        // Try with different referer
        const altReferer = `https://thedaddy.top/stream/stream-${CHANNEL}.php`;
        const resp2 = await page.goto(playerUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
          referer: altReferer,
        });
        log('  ', `Retry status: ${resp2.status()}`);
        await new Promise(r => setTimeout(r, 3000));
        await shot(page, '03b-player-retry');
        const retryInfo = await page.evaluate(() => ({
          bodyText: document.body?.innerText?.substring(0, 300) || '',
          hasVerifyBox: !!document.getElementById('verify-box'),
        }));
        log('  ', `Retry body: ${retryInfo.bodyText.substring(0, 200)}`);
      }
    } catch (e) {
      log('❌', `Player page error: ${e.message}`);
    }
  } else {
    log('⚠️', 'No player iframe found — trying direct player URL');
    const directUrl = `https://adffdafdsafds.sbs/premiumtv/daddyhd.php?id=${CHANNEL}`;
    try {
      const resp = await page.goto(directUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
        referer: STREAM_PAGE,
      });
      recon.step3_playerPage.status = resp.status();
      recon.step3_playerPage.url = page.url();
      log('  ', `Direct status: ${resp.status()}`);
      await new Promise(r => setTimeout(r, 3000));
      await shot(page, '03-player-direct');
    } catch (e) {
      log('❌', `Direct player error: ${e.message}`);
    }
  }

  // ============================================================
  // STEP 4: Wait for reCAPTCHA + verify + stream loading
  // ============================================================
  log('\n📍', 'STEP 4: Waiting for reCAPTCHA verify + stream (90s max)');

  // Try clicking verify box if present
  try {
    const verifyBox = await page.$('#verify-box');
    if (verifyBox) {
      log('  ', 'Found #verify-box — clicking...');
      await verifyBox.click();
      await new Promise(r => setTimeout(r, 3000));
    }
  } catch {}

  // Try triggering verifyRecaptcha() from JS
  try {
    await page.evaluate(() => {
      if (typeof verifyRecaptcha === 'function') verifyRecaptcha(false);
    });
    log('  ', 'Called verifyRecaptcha(false)');
  } catch {}

  const waitStart = Date.now();
  while (Date.now() - waitStart < 90000) {
    await new Promise(r => setTimeout(r, 5000));
    const elapsed = Math.round((Date.now() - waitStart) / 1000);
    const v = recon.step4_recaptcha.verifyResps.length;
    const m = recon.step5_m3u8.content ? 'YES' : 'no';
    const k = recon.step6_keys.responses.length;
    const s = recon.step7_segments.count;
    log('⏳', `[${elapsed}s] verify=${v} m3u8=${m} keys=${k} segs=${s}`);

    if (k > 0 && s > 3) {
      log('✅', 'Got keys + segments — waiting 10s more for extra data...');
      await new Promise(r => setTimeout(r, 10000));
      break;
    }

    // If we have M3U8 but no keys after 30s, take a screenshot
    if (elapsed === 30) await shot(page, '04-30s');
  }

  await shot(page, '05-final');

  // Grab final cookies
  const cookies = await page.cookies();
  recon.step4_recaptcha.cookies = cookies.map(c => ({
    name: c.name, domain: c.domain, value: c.value.substring(0, 80),
    httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite,
  }));

  await browser.close();

  // ============================================================
  // FINAL ANALYSIS
  // ============================================================
  console.log('\n\n' + '='.repeat(60));
  console.log('DLHD FULL FLOW RECON — RESULTS');
  console.log('='.repeat(60));

  console.log('\n1. MAIN SITE');
  console.log(`   Status: ${recon.step1_mainSite.status}`);

  console.log('\n2. STREAM PAGE');
  console.log(`   Status: ${recon.step2_streamPage.status}`);
  console.log(`   Iframes: ${(recon.step2_streamPage.iframeSrc || []).join('\n            ')}`);

  console.log('\n3. PLAYER PAGE');
  console.log(`   Status: ${recon.step3_playerPage.status}`);
  console.log(`   URL: ${recon.step3_playerPage.url}`);

  console.log('\n4. reCAPTCHA');
  console.log(`   Verify requests: ${recon.step4_recaptcha.verifyReqs.length}`);
  console.log(`   Verify responses: ${recon.step4_recaptcha.verifyResps.length}`);
  for (const v of recon.step4_recaptcha.verifyResps) {
    console.log(`   → ${v.status}: ${typeof v.body === 'string' ? v.body.substring(0, 300) : JSON.stringify(v.body).substring(0, 300)}`);
  }

  console.log('\n5. M3U8');
  console.log(`   URL: ${recon.step5_m3u8.url || 'NONE'}`);
  if (recon.step5_m3u8.headers) {
    console.log(`   Referer: ${recon.step5_m3u8.headers.referer || '-'}`);
    console.log(`   Origin: ${recon.step5_m3u8.headers.origin || '-'}`);
  }
  console.log(`   Key URIs: ${recon.step5_m3u8.keyUris.length}`);
  for (const u of recon.step5_m3u8.keyUris.slice(0, 3)) console.log(`   → ${u.substring(0, 200)}`);

  console.log('\n6. KEYS');
  console.log(`   Requests: ${recon.step6_keys.requests.length}`);
  console.log(`   Responses: ${recon.step6_keys.responses.length}`);
  const realKeys = recon.step6_keys.responses.filter(k => !k.isFake && k.size === 16);
  const fakeKeys = recon.step6_keys.responses.filter(k => k.isFake);
  console.log(`   Real: ${realKeys.length} | Fake: ${fakeKeys.length}`);
  if (recon.step6_keys.requests[0]) {
    console.log(`\n   First key request headers:`);
    const h = recon.step6_keys.requests[0].headers;
    for (const [k, v] of Object.entries(h)) {
      if (!['accept-language', 'accept-encoding', 'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'].includes(k)) {
        console.log(`     ${k}: ${String(v).substring(0, 120)}`);
      }
    }
  }
  if (realKeys[0]) console.log(`\n   ✅ REAL KEY: ${realKeys[0].hex} from ${realKeys[0].url.substring(0, 120)}`);

  console.log('\n7. SEGMENTS');
  console.log(`   Count: ${recon.step7_segments.count}`);
  console.log(`   CDN domains: ${[...recon.step7_segments.domains].join(', ')}`);

  console.log('\n8. COOKIES (relevant)');
  for (const c of recon.step4_recaptcha.cookies) {
    if (c.domain.includes('ai-chatx') || c.domain.includes('soyspace') || c.domain.includes('adffdafdsafds') || c.domain.includes('vovlacosa') || c.domain.includes('dlstreams') || c.domain.includes('thedaddy')) {
      console.log(`   ${c.domain}: ${c.name}=${c.value} (httpOnly=${c.httpOnly})`);
    }
  }

  console.log('\n9. ALL DOMAINS');
  const sorted = Object.entries(recon.allDomains).sort((a, b) => b[1] - a[1]);
  for (const [d, c] of sorted.slice(0, 20)) console.log(`   ${String(c).padStart(4)}x ${d}`);

  console.log('\n10. PAGE CONSOLE LOGS');
  for (const l of recon.pageLogs.slice(0, 25)) console.log(`   ${l}`);

  // Key findings
  console.log('\n' + '='.repeat(60));
  console.log('KEY FINDINGS');
  console.log('='.repeat(60));
  if (realKeys.length > 0) {
    console.log('✅ GOT REAL KEYS — whitelist works from this IP');
    console.log('   The key request headers that work need to be replicated on RPI.');
  } else if (fakeKeys.length > 0) {
    console.log('❌ ALL KEYS FAKE — whitelist not working even from browser');
    console.log('   Possible causes:');
    console.log('   - reCAPTCHA verify succeeded but whitelist mechanism changed');
    console.log('   - Key server now requires cookies/session from verify response');
    console.log('   - Key server checks additional headers beyond IP whitelist');
  } else if (recon.step5_m3u8.content) {
    console.log('⚠️ GOT M3U8 BUT NO KEY RESPONSES — HLS.js may not have started');
  } else {
    console.log('❌ NO M3U8 OR KEYS — stream never loaded');
    console.log('   Check screenshots for Cloudflare challenge or 403 errors');
  }

  // Save full data
  const outFile = 'scripts/dlhd-full-flow-recon-result.json';
  const saveData = { ...recon, step7_segments: { count: recon.step7_segments.count, domains: [...recon.step7_segments.domains] } };
  fs.writeFileSync(outFile, JSON.stringify(saveData, null, 2));
  console.log(`\nFull data saved to: ${outFile}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
