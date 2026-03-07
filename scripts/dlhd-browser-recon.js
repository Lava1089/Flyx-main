#!/usr/bin/env node
/**
 * DLHD Browser Recon — March 2026
 * 
 * Opens the REAL DLHD player page in a local Chromium browser,
 * intercepts ALL network traffic, and analyzes:
 *   1. reCAPTCHA v3 flow (token generation → verify endpoint → response)
 *   2. M3U8 playlist fetch (which domain, what headers)
 *   3. Key fetch (which domain, what headers, real vs fake key)
 *   4. Segment fetch (CDN domains, CORS headers)
 *   5. Any new auth mechanisms (cookies, tokens, headers)
 * 
 * This runs on YOUR local machine with YOUR residential IP,
 * so reCAPTCHA whitelist should work and we should get REAL keys.
 */

const puppeteer = require('puppeteer');

const CHANNEL = process.argv[2] || '44';
const PLAYER_URL = `https://adffdafdsafds.sbs/premiumtv/daddyhd.php?id=${CHANNEL}`;
const TIMEOUT_MS = 60000; // 60s to let reCAPTCHA + stream load

// Collected data
const recon = {
  recaptcha: { siteKey: null, tokens: [], verifyRequests: [], verifyResponses: [] },
  m3u8: { requests: [], content: null, keyUris: [], segmentUrls: [] },
  keys: { requests: [], responses: [] },
  segments: { requests: [], firstBytes: [] },
  cookies: [],
  errors: [],
  allRequests: [],
  headers: {},
};


async function main() {
  console.log(`\n=== DLHD Browser Recon ===`);
  console.log(`Channel: ${CHANNEL}`);
  console.log(`Player URL: ${PLAYER_URL}`);
  console.log(`Timeout: ${TIMEOUT_MS / 1000}s\n`);

  const browser = await puppeteer.launch({
    headless: false, // Show browser so we can see what happens
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-web-security', // Allow cross-origin for analysis
    ],
    defaultViewport: { width: 1280, height: 720 },
  });

  const page = await browser.newPage();

  // Set realistic UA
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36');

  // Enable request interception for analysis (but don't block anything)
  await page.setRequestInterception(true);

  page.on('request', (req) => {
    const url = req.url();
    const method = req.method();
    const headers = req.headers();
    const postData = req.postData();

    // Track ALL requests
    const entry = {
      url: url.substring(0, 200),
      method,
      type: req.resourceType(),
      timestamp: Date.now(),
    };
    recon.allRequests.push(entry);

    // reCAPTCHA verify requests
    if (url.includes('/verify')) {
      console.log(`\n🔑 [VERIFY REQUEST] ${method} ${url}`);
      console.log(`   Headers:`, JSON.stringify(headers, null, 2).substring(0, 500));
      if (postData) {
        console.log(`   Body:`, postData.substring(0, 500));
        try {
          const parsed = JSON.parse(postData);
          recon.recaptcha.verifyRequests.push({ url, headers, body: parsed });
        } catch {
          recon.recaptcha.verifyRequests.push({ url, headers, body: postData });
        }
      }
    }

    // M3U8 requests
    if (url.includes('mono.css') || url.includes('.m3u8') || url.includes('mono.csv')) {
      console.log(`\n📺 [M3U8 REQUEST] ${url.substring(0, 150)}`);
      console.log(`   Headers:`, JSON.stringify(headers, null, 2).substring(0, 500));
      recon.m3u8.requests.push({ url, headers });
    }

    // Key requests
    if (url.includes('/key/premium') || url.includes('/key/')) {
      console.log(`\n🔐 [KEY REQUEST] ${url.substring(0, 150)}`);
      console.log(`   Headers:`, JSON.stringify(headers, null, 2).substring(0, 500));
      recon.keys.requests.push({ url, headers });
    }

    // Segment requests (CDN)
    if (url.includes('.png') && (url.includes('r2.dev') || url.includes('r2.flux') || 
        url.includes('dreamvideo') || url.includes('visualgpt') || url.includes('s3.amazonaws') ||
        url.includes('cgdream'))) {
      if (recon.segments.requests.length < 3) {
        console.log(`\n📦 [SEGMENT REQUEST] ${url.substring(0, 150)}`);
      }
      recon.segments.requests.push({ url: url.substring(0, 200) });
    }

    // reCAPTCHA API calls
    if (url.includes('recaptcha/api') || url.includes('recaptcha/enterprise')) {
      if (url.includes('reload')) {
        console.log(`\n🤖 [RECAPTCHA RELOAD] ${url.substring(0, 150)}`);
      }
    }

    req.continue();
  });

  // Intercept responses
  page.on('response', async (res) => {
    const url = res.url();
    const status = res.status();

    try {
      // Verify endpoint responses
      if (url.includes('/verify')) {
        const body = await res.text().catch(() => '(could not read)');
        console.log(`\n🔑 [VERIFY RESPONSE] ${status} ${url}`);
        console.log(`   Body:`, body.substring(0, 500));
        console.log(`   Headers:`, JSON.stringify(Object.fromEntries(res.headers().entries ? res.headers().entries() : Object.entries(res.headers())), null, 2).substring(0, 500));
        try {
          recon.recaptcha.verifyResponses.push({ url, status, body: JSON.parse(body), headers: res.headers() });
        } catch {
          recon.recaptcha.verifyResponses.push({ url, status, body, headers: res.headers() });
        }
      }

      // M3U8 responses
      if ((url.includes('mono.css') || url.includes('.m3u8')) && status === 200) {
        const body = await res.text().catch(() => null);
        if (body && body.includes('#EXTM3U') && !recon.m3u8.content) {
          recon.m3u8.content = body;
          console.log(`\n📺 [M3U8 RESPONSE] ${body.length} bytes from ${url.substring(0, 100)}`);
          // Extract key URIs
          const lines = body.split('\n');
          for (const line of lines) {
            const uriMatch = line.match(/URI="([^"]+)"/);
            if (uriMatch) {
              recon.m3u8.keyUris.push(uriMatch[1]);
              console.log(`   Key URI: ${uriMatch[1].substring(0, 150)}`);
            }
            if (line.trim() && !line.trim().startsWith('#')) {
              recon.m3u8.segmentUrls.push(line.trim());
            }
          }
        }
      }

      // Key responses
      if (url.includes('/key/premium') || url.includes('/key/')) {
        if (res.headers()['content-type']?.includes('octet') || status === 200) {
          try {
            const buf = await res.buffer();
            const hex = buf.length === 16 ? buf.toString('hex') : `${buf.length}b`;
            const fakes = ['45db13cfa0ed393fdb7da4dfe9b5ac81', '455806f8bc592fdacb6ed5e071a517b1'];
            const isFake = fakes.includes(hex);
            console.log(`\n🔐 [KEY RESPONSE] ${status} ${url.substring(0, 100)}`);
            console.log(`   Size: ${buf.length} bytes`);
            console.log(`   Hex: ${hex}`);
            console.log(`   Fake: ${isFake}`);
            console.log(`   Response headers:`, JSON.stringify(res.headers(), null, 2).substring(0, 500));
            recon.keys.responses.push({ url, status, size: buf.length, hex, isFake, headers: res.headers() });
          } catch (e) {
            console.log(`\n🔐 [KEY RESPONSE] ${status} ${url.substring(0, 100)} — could not read buffer: ${e.message}`);
          }
        }
      }
    } catch (e) {
      // Ignore response read errors for non-critical requests
    }
  });

  // Capture console logs from the page
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('reCAPTCHA') || text.includes('verify') || text.includes('whitelist') ||
        text.includes('key') || text.includes('error') || text.includes('Error') ||
        text.includes('stream') || text.includes('player') || text.includes('CHANNEL')) {
      console.log(`   [PAGE LOG] ${text.substring(0, 200)}`);
    }
  });

  // Navigate to the player page
  console.log(`\n--- Navigating to player page ---`);
  try {
    await page.goto(PLAYER_URL, {
      waitUntil: 'networkidle2',
      timeout: 30000,
      referer: 'https://dlstreams.top/',
    });
    console.log('Page loaded.\n');
  } catch (e) {
    console.log(`Page load warning: ${e.message} (continuing anyway)\n`);
  }

  // Wait for reCAPTCHA to complete and stream to start loading
  console.log('--- Waiting for reCAPTCHA + stream (up to 60s) ---');
  
  // Wait in intervals, checking for key responses
  const startWait = Date.now();
  while (Date.now() - startWait < TIMEOUT_MS) {
    await new Promise(r => setTimeout(r, 3000));
    
    const elapsed = Math.round((Date.now() - startWait) / 1000);
    const keyCount = recon.keys.responses.length;
    const m3u8Count = recon.m3u8.requests.length;
    const verifyCount = recon.recaptcha.verifyResponses.length;
    
    console.log(`   [${elapsed}s] Verify: ${verifyCount}, M3U8: ${m3u8Count}, Keys: ${keyCount}, Segments: ${recon.segments.requests.length}`);
    
    // If we have key responses and segments, we have enough data
    if (keyCount > 0 && recon.segments.requests.length > 2) {
      console.log('   Got enough data, wrapping up...');
      // Wait a bit more for additional data
      await new Promise(r => setTimeout(r, 5000));
      break;
    }
  }

  // Capture cookies
  const cookies = await page.cookies();
  recon.cookies = cookies.map(c => ({ name: c.name, domain: c.domain, value: c.value.substring(0, 50) }));

  // Close browser
  await browser.close();

  // ============================================================
  // ANALYSIS
  // ============================================================
  console.log('\n\n' + '='.repeat(60));
  console.log('RECON ANALYSIS');
  console.log('='.repeat(60));

  // 1. reCAPTCHA
  console.log('\n--- reCAPTCHA ---');
  console.log(`Verify requests: ${recon.recaptcha.verifyRequests.length}`);
  console.log(`Verify responses: ${recon.recaptcha.verifyResponses.length}`);
  for (const vr of recon.recaptcha.verifyResponses) {
    console.log(`  ${vr.status}: ${JSON.stringify(vr.body).substring(0, 300)}`);
    if (vr.headers) {
      const interesting = ['set-cookie', 'x-whitelist', 'x-session', 'authorization'];
      for (const h of interesting) {
        if (vr.headers[h]) console.log(`  Header ${h}: ${vr.headers[h]}`);
      }
    }
  }

  // 2. M3U8
  console.log('\n--- M3U8 ---');
  console.log(`Requests: ${recon.m3u8.requests.length}`);
  if (recon.m3u8.requests.length > 0) {
    const first = recon.m3u8.requests[0];
    console.log(`First M3U8 URL: ${first.url}`);
    console.log(`First M3U8 headers:`, JSON.stringify(first.headers, null, 2).substring(0, 500));
  }
  console.log(`Key URIs in M3U8: ${recon.m3u8.keyUris.length}`);
  for (const uri of recon.m3u8.keyUris.slice(0, 3)) {
    console.log(`  ${uri.substring(0, 200)}`);
  }

  // 3. Keys
  console.log('\n--- Keys ---');
  console.log(`Key requests: ${recon.keys.requests.length}`);
  console.log(`Key responses: ${recon.keys.responses.length}`);
  for (const kr of recon.keys.responses) {
    console.log(`  ${kr.status} ${kr.hex} fake=${kr.isFake} from ${kr.url.substring(0, 100)}`);
  }
  if (recon.keys.requests.length > 0) {
    console.log(`\nFirst key request headers:`);
    console.log(JSON.stringify(recon.keys.requests[0].headers, null, 2));
  }

  // 4. Segments
  console.log('\n--- Segments ---');
  console.log(`Segment requests: ${recon.segments.requests.length}`);
  if (recon.segments.requests.length > 0) {
    const domains = [...new Set(recon.segments.requests.map(s => {
      try { return new URL(s.url).hostname; } catch { return 'unknown'; }
    }))];
    console.log(`CDN domains: ${domains.join(', ')}`);
  }

  // 5. Cookies
  console.log('\n--- Cookies ---');
  for (const c of recon.cookies) {
    console.log(`  ${c.domain}: ${c.name} = ${c.value}`);
  }

  // 6. Domain summary
  console.log('\n--- All domains contacted ---');
  const domains = {};
  for (const r of recon.allRequests) {
    try {
      const d = new URL(r.url).hostname;
      domains[d] = (domains[d] || 0) + 1;
    } catch {}
  }
  const sorted = Object.entries(domains).sort((a, b) => b[1] - a[1]);
  for (const [d, count] of sorted) {
    console.log(`  ${count}x ${d}`);
  }

  // 7. Key findings
  console.log('\n--- KEY FINDINGS ---');
  const realKeys = recon.keys.responses.filter(k => !k.isFake && k.size === 16);
  const fakeKeys = recon.keys.responses.filter(k => k.isFake);
  
  if (realKeys.length > 0) {
    console.log(`✅ GOT ${realKeys.length} REAL KEY(S)!`);
    console.log(`   The browser's residential IP IS whitelisted.`);
    console.log(`   Key request headers that work:`);
    const matchingReq = recon.keys.requests.find(r => r.url.includes(realKeys[0].url.split('/key/')[1]?.split('?')[0] || 'xxx'));
    if (matchingReq) console.log(JSON.stringify(matchingReq.headers, null, 2));
  } else if (fakeKeys.length > 0) {
    console.log(`❌ ALL ${fakeKeys.length} KEYS ARE FAKE`);
    console.log(`   reCAPTCHA whitelist may not be working, or key server changed auth.`);
  } else {
    console.log(`⚠️ NO KEY RESPONSES CAPTURED`);
    console.log(`   Stream may not have loaded. Check if reCAPTCHA completed.`);
  }

  // Write full recon data to file
  const fs = require('fs');
  const outFile = `scripts/dlhd-recon-data-${Date.now()}.json`;
  fs.writeFileSync(outFile, JSON.stringify(recon, null, 2));
  console.log(`\nFull recon data saved to: ${outFile}`);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
