#!/usr/bin/env node
/**
 * DLHD Browser Recon v2 — March 2026
 * 
 * Opens the REAL DLHD player in a visible browser, takes screenshots,
 * clicks verify buttons, and captures all network traffic.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const CHANNEL = process.argv[2] || '44';
const PLAYER_URL = `https://adffdafdsafds.sbs/premiumtv/daddyhd.php?id=${CHANNEL}`;

const recon = {
  recaptcha: { verifyRequests: [], verifyResponses: [] },
  m3u8: { requests: [], content: null, keyUris: [] },
  keys: { requests: [], responses: [] },
  segments: { count: 0 },
  allDomains: {},
  pageLogs: [],
};

async function screenshot(page, name) {
  const file = path.join('scripts', `recon-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`📸 Screenshot: ${file}`);
}


async function main() {
  console.log(`\n=== DLHD Browser Recon v2 ===`);
  console.log(`Channel: ${CHANNEL} | URL: ${PLAYER_URL}\n`);

  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
    defaultViewport: { width: 1280, height: 720 },
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36');

  // Intercept requests
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    const method = req.method();
    const headers = req.headers();
    const postData = req.postData();

    // Track domains
    try { const d = new URL(url).hostname; recon.allDomains[d] = (recon.allDomains[d] || 0) + 1; } catch {}

    if (url.includes('/verify')) {
      console.log(`\n🔑 VERIFY ${method} ${url}`);
      if (postData) console.log(`   Body: ${postData.substring(0, 300)}`);
      recon.recaptcha.verifyRequests.push({ url, method, headers, body: postData });
    }
    if (url.includes('mono.css') || url.includes('.m3u8')) {
      console.log(`\n📺 M3U8 ${url.substring(0, 150)}`);
      console.log(`   Referer: ${headers.referer || 'none'}`);
      console.log(`   Origin: ${headers.origin || 'none'}`);
      recon.m3u8.requests.push({ url, headers: { referer: headers.referer, origin: headers.origin, authorization: headers.authorization } });
    }
    if (url.match(/\/key\/premium\d+\/\d+/)) {
      console.log(`\n🔐 KEY ${url.substring(0, 150)}`);
      console.log(`   All headers:`, JSON.stringify(headers, null, 2).substring(0, 800));
      recon.keys.requests.push({ url, headers });
    }
    if (url.includes('.png') && (url.includes('r2.dev') || url.includes('r2.flux') || url.includes('dreamvideo') || url.includes('s3.amazonaws') || url.includes('cgdream') || url.includes('visualgpt'))) {
      recon.segments.count++;
    }

    req.continue();
  });

  // Intercept responses
  page.on('response', async (res) => {
    const url = res.url();
    const status = res.status();
    try {
      if (url.includes('/verify')) {
        const body = await res.text().catch(() => '?');
        const respHeaders = res.headers();
        console.log(`\n🔑 VERIFY RESPONSE ${status}`);
        console.log(`   Body: ${body.substring(0, 500)}`);
        // Check for set-cookie
        const setCookie = respHeaders['set-cookie'];
        if (setCookie) console.log(`   Set-Cookie: ${setCookie}`);
        recon.recaptcha.verifyResponses.push({ status, body, setCookie, headers: respHeaders });
      }
      if ((url.includes('mono.css') || url.includes('.m3u8')) && status === 200) {
        const body = await res.text().catch(() => null);
        if (body && body.includes('#EXTM3U') && !recon.m3u8.content) {
          recon.m3u8.content = body;
          console.log(`\n📺 M3U8 RESPONSE (${body.length}b)`);
          for (const line of body.split('\n')) {
            const m = line.match(/URI="([^"]+)"/);
            if (m) { recon.m3u8.keyUris.push(m[1]); console.log(`   Key URI: ${m[1].substring(0, 200)}`); }
          }
        }
      }
      if (url.match(/\/key\/premium\d+\/\d+/)) {
        try {
          const buf = await res.buffer();
          const hex = buf.length === 16 ? buf.toString('hex') : `${buf.length}b`;
          const fakes = ['45db13cfa0ed393fdb7da4dfe9b5ac81', '455806f8bc592fdacb6ed5e071a517b1'];
          console.log(`\n🔐 KEY RESPONSE ${status} | ${buf.length}b | hex=${hex} | fake=${fakes.includes(hex)}`);
          console.log(`   Response headers:`, JSON.stringify(res.headers(), null, 2).substring(0, 500));
          recon.keys.responses.push({ url, status, size: buf.length, hex, isFake: fakes.includes(hex), headers: res.headers() });
        } catch {}
      }
    } catch {}
  });

  // Page console
  page.on('console', (msg) => {
    const t = msg.text();
    if (t.includes('reCAPTCHA') || t.includes('verify') || t.includes('whitelist') ||
        t.includes('Error') || t.includes('stream') || t.includes('CHANNEL') ||
        t.includes('player') || t.includes('Clappr') || t.includes('hls')) {
      console.log(`   [PAGE] ${t.substring(0, 200)}`);
      recon.pageLogs.push(t.substring(0, 300));
    }
  });

  // Navigate
  console.log('--- Loading player page ---');
  try {
    await page.goto(PLAYER_URL, { waitUntil: 'domcontentloaded', timeout: 30000, referer: 'https://dlstreams.top/' });
  } catch (e) {
    console.log(`Load warning: ${e.message}`);
  }

  await new Promise(r => setTimeout(r, 3000));
  await screenshot(page, '01-initial');

  // Check for verify box and click it
  console.log('\n--- Checking for verify button ---');
  try {
    const verifyBtn = await page.$('#verify-box button, #verify-box, .verify-btn, [onclick*="verify"]');
    if (verifyBtn) {
      console.log('Found verify button — clicking...');
      await verifyBtn.click();
      await new Promise(r => setTimeout(r, 5000));
      await screenshot(page, '02-after-verify-click');
    } else {
      console.log('No verify button found. Checking page content...');
      const pageText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || '');
      console.log(`Page text: ${pageText.substring(0, 300)}`);
    }
  } catch (e) {
    console.log(`Verify button check error: ${e.message}`);
  }

  // Try to trigger reCAPTCHA manually via page JS
  console.log('\n--- Triggering reCAPTCHA via JS ---');
  try {
    const result = await page.evaluate(() => {
      if (typeof verifyRecaptcha === 'function') {
        verifyRecaptcha(false);
        return 'called verifyRecaptcha()';
      }
      if (typeof grecaptcha !== 'undefined') {
        return 'grecaptcha exists but verifyRecaptcha not found';
      }
      return 'no grecaptcha or verifyRecaptcha';
    });
    console.log(`JS result: ${result}`);
  } catch (e) {
    console.log(`JS error: ${e.message}`);
  }

  // Wait for network activity
  console.log('\n--- Waiting for stream to load (up to 60s) ---');
  const start = Date.now();
  while (Date.now() - start < 60000) {
    await new Promise(r => setTimeout(r, 5000));
    const elapsed = Math.round((Date.now() - start) / 1000);
    console.log(`[${elapsed}s] Verify: ${recon.recaptcha.verifyResponses.length}, M3U8: ${recon.m3u8.requests.length}, Keys: ${recon.keys.responses.length}, Segs: ${recon.segments.count}`);
    
    if (recon.keys.responses.length > 0 && recon.segments.count > 2) {
      console.log('Got key + segments, waiting 10s more...');
      await new Promise(r => setTimeout(r, 10000));
      break;
    }
  }

  await screenshot(page, '03-final');

  // Get cookies
  const cookies = await page.cookies();

  await browser.close();

  // ============================================================
  // ANALYSIS
  // ============================================================
  console.log('\n\n' + '='.repeat(60));
  console.log('ANALYSIS RESULTS');
  console.log('='.repeat(60));

  console.log('\n1. reCAPTCHA Flow:');
  console.log(`   Verify requests: ${recon.recaptcha.verifyRequests.length}`);
  console.log(`   Verify responses: ${recon.recaptcha.verifyResponses.length}`);
  for (const v of recon.recaptcha.verifyResponses) {
    console.log(`   Response ${v.status}: ${typeof v.body === 'string' ? v.body.substring(0, 200) : JSON.stringify(v.body).substring(0, 200)}`);
    if (v.setCookie) console.log(`   Set-Cookie: ${v.setCookie}`);
  }

  console.log('\n2. M3U8:');
  console.log(`   Requests: ${recon.m3u8.requests.length}`);
  if (recon.m3u8.requests[0]) {
    console.log(`   URL: ${recon.m3u8.requests[0].url}`);
    console.log(`   Headers: ${JSON.stringify(recon.m3u8.requests[0].headers)}`);
  }
  console.log(`   Key URIs: ${recon.m3u8.keyUris.length}`);
  for (const u of recon.m3u8.keyUris.slice(0, 3)) console.log(`   → ${u.substring(0, 200)}`);

  console.log('\n3. Keys:');
  console.log(`   Requests: ${recon.keys.requests.length}`);
  console.log(`   Responses: ${recon.keys.responses.length}`);
  const realKeys = recon.keys.responses.filter(k => !k.isFake && k.size === 16);
  const fakeKeys = recon.keys.responses.filter(k => k.isFake);
  console.log(`   Real: ${realKeys.length}, Fake: ${fakeKeys.length}`);
  if (recon.keys.requests[0]) {
    console.log(`\n   First key request headers:`);
    console.log(`   ${JSON.stringify(recon.keys.requests[0].headers, null, 2)}`);
  }
  if (realKeys[0]) {
    console.log(`\n   ✅ REAL KEY: ${realKeys[0].hex}`);
    console.log(`   From: ${realKeys[0].url}`);
  }

  console.log('\n4. Segments:', recon.segments.count);

  console.log('\n5. Cookies:');
  for (const c of cookies) {
    if (c.domain.includes('ai-chatx') || c.domain.includes('soyspace') || c.domain.includes('adffdafdsafds') || c.domain.includes('vovlacosa')) {
      console.log(`   ${c.domain}: ${c.name} = ${c.value.substring(0, 80)}`);
    }
  }

  console.log('\n6. Domains:');
  const sorted = Object.entries(recon.allDomains).sort((a, b) => b[1] - a[1]);
  for (const [d, c] of sorted.slice(0, 15)) console.log(`   ${c}x ${d}`);

  console.log('\n7. Page logs:');
  for (const l of recon.pageLogs.slice(0, 20)) console.log(`   ${l}`);

  // Save
  const outFile = `scripts/dlhd-recon-result.json`;
  fs.writeFileSync(outFile, JSON.stringify({ recon, cookies: cookies.map(c => ({ name: c.name, domain: c.domain, value: c.value.substring(0, 100) })) }, null, 2));
  console.log(`\nSaved to: ${outFile}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
