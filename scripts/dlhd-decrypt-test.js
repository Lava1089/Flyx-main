#!/usr/bin/env node
/**
 * DLHD Full Decryption Validation via Playwright
 *
 * Opens the actual player page, lets reCAPTCHA whitelist our IP,
 * captures the REAL key, fetches a segment, and validates decryption.
 */

const { chromium } = require('playwright');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

const CHANNEL = process.argv[2] || '51';

function fetchBuf(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const u = new URL(url);
    mod.get({ hostname: u.hostname, path: u.pathname + u.search, headers: { 'User-Agent': 'Mozilla/5.0', ...headers } }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

(async () => {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  DLHD FULL DECRYPTION TEST — Channel ${CHANNEL}`);
  console.log(`${'='.repeat(70)}\n`);

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--autoplay-policy=no-user-gesture-required'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
  });

  // Block ads
  await context.route(/doubleclick|googlesyndication|analytics\.google|histats|xadsmart|dtscout|rtmark|protraffic|usrpubtrk|405kk|kofeslos|al5sm/, route => route.abort());

  const captured = {
    m3u8Url: null,
    m3u8Body: null,
    keyUrl: null,
    keyBytes: null,
    keyIV: null,
    segmentUrl: null,
    verifyResult: null,
  };

  const page = await context.newPage();

  // Capture network
  page.on('response', async (resp) => {
    const url = resp.url();
    const status = resp.status();

    if ((url.includes('mono.css') || url.includes('.m3u8')) && status === 200) {
      try {
        const body = await resp.text();
        if (body.includes('#EXTM3U')) {
          captured.m3u8Url = url;
          captured.m3u8Body = body;
          console.log(`📋 M3U8 captured: ${url.substring(0, 80)}`);

          // Parse key info
          const keyLine = body.split('\n').find(l => l.includes('EXT-X-KEY'));
          if (keyLine) {
            const uriMatch = keyLine.match(/URI="([^"]+)"/);
            const ivMatch = keyLine.match(/IV=0x([0-9a-fA-F]+)/);
            if (uriMatch) {
              // Resolve relative URI
              if (uriMatch[1].startsWith('/')) {
                const base = new URL(url);
                captured.keyUrl = `${base.origin}${uriMatch[1]}`;
              } else {
                captured.keyUrl = uriMatch[1];
              }
            }
            if (ivMatch) captured.keyIV = ivMatch[1];
            console.log(`   Key URL: ${captured.keyUrl}`);
            console.log(`   IV: ${captured.keyIV}`);
          }

          // Get first segment URL
          const segs = body.split('\n').filter(l => l.trim() && !l.startsWith('#'));
          if (segs[0]) {
            captured.segmentUrl = segs[0].trim();
            console.log(`   First segment: ${captured.segmentUrl.substring(0, 80)}`);
          }
        }
      } catch {}
    }

    if (url.includes('/key/') && status === 200) {
      try {
        const buf = await resp.body();
        if (buf.length === 16) {
          captured.keyBytes = buf;
          console.log(`🔑 KEY captured: ${buf.toString('hex')} (${buf.length}b) from ${new URL(url).hostname}`);
        }
      } catch {}
    }

    if (url.includes('/verify') && status === 200) {
      try {
        const body = await resp.text();
        captured.verifyResult = body;
        console.log(`✅ VERIFY: ${body.substring(0, 100)}`);
      } catch {}
    }
  });

  // Navigate to the player page
  console.log('Loading player page...\n');
  try {
    await page.goto(`https://dlstreams.top/embed/stream-${CHANNEL}.php`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
  } catch (e) {
    console.log(`Navigation: ${e.message.substring(0, 80)}`);
  }

  // Wait for reCAPTCHA + verify + M3U8 + key
  console.log('\nWaiting for reCAPTCHA → verify → M3U8 → key...\n');
  const start = Date.now();
  while (Date.now() - start < 30000) {
    if (captured.keyBytes && captured.m3u8Body && captured.segmentUrl) {
      console.log('\n✅ All data captured!\n');
      break;
    }
    await page.waitForTimeout(500);
  }

  await browser.close();

  if (!captured.keyBytes || !captured.m3u8Body || !captured.segmentUrl || !captured.keyIV) {
    console.log('❌ Failed to capture all required data');
    console.log(`   M3U8: ${!!captured.m3u8Body}, Key: ${!!captured.keyBytes}, Segment: ${!!captured.segmentUrl}, IV: ${!!captured.keyIV}`);
    process.exit(1);
  }

  // Now test decryption
  console.log(`${'─'.repeat(70)}`);
  console.log('  DECRYPTION VALIDATION');
  console.log(`${'─'.repeat(70)}\n`);

  const key = Buffer.from(captured.keyBytes);
  const iv = Buffer.from(captured.keyIV, 'hex');
  console.log(`Key: ${key.toString('hex')}`);
  console.log(`IV:  ${captured.keyIV}`);

  // Fetch the segment
  console.log(`\nFetching segment: ${captured.segmentUrl.substring(0, 80)}...`);
  const segResp = await fetchBuf(captured.segmentUrl);
  console.log(`Segment: ${segResp.body.length} bytes`);
  console.log(`First 32 bytes: ${segResp.body.slice(0, 32).toString('hex')}`);

  // Try decryption with various offsets
  console.log('\n--- Decryption attempts ---');
  let success = false;

  for (const offset of [0, 32, 16, 48, 64, 128, 256]) {
    const data = segResp.body.slice(offset);

    // Try with PKCS7 padding
    try {
      const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
      const dec = Buffer.concat([decipher.update(data), decipher.final()]);
      const isTS = dec[0] === 0x47;
      const isAAC = dec[0] === 0xFF && (dec[1] & 0xF0) === 0xF0;
      const isID3 = dec.slice(0, 3).toString() === 'ID3';
      console.log(`offset=${offset} (PKCS7): ${dec.length}b, first4=${dec.slice(0, 4).toString('hex')} TS=${isTS} AAC=${isAAC} ID3=${isID3}`);
      if (isTS) {
        let syncs = 0;
        const total = Math.min(Math.floor(dec.length / 188), 20);
        for (let i = 0; i < total * 188; i += 188) if (dec[i] === 0x47) syncs++;
        console.log(`  ✅ VALID MPEG-TS! ${syncs}/${total} sync bytes`);
        success = true;
        break;
      }
      if (isID3 || isAAC) {
        console.log(`  ✅ Valid media format detected (${isID3 ? 'fMP4/ID3' : 'AAC'})`);
        success = true;
        break;
      }
    } catch (e) {
      // Try without padding
      try {
        const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
        decipher.setAutoPadding(false);
        const dec = Buffer.concat([decipher.update(data), decipher.final()]);
        const isTS = dec[0] === 0x47;
        console.log(`offset=${offset} (no pad): ${dec.length}b, first4=${dec.slice(0, 4).toString('hex')} TS=${isTS}`);
        if (isTS) {
          let syncs = 0;
          const total = Math.min(Math.floor(dec.length / 188), 20);
          for (let i = 0; i < total * 188; i += 188) if (dec[i] === 0x47) syncs++;
          console.log(`  ✅ VALID MPEG-TS! ${syncs}/${total} sync bytes`);
          success = true;
          break;
        }
      } catch {}
    }
  }

  // Also compare: fetch key via CF worker and see if it matches
  console.log('\n--- Comparing browser key vs CF Worker key ---');
  const keyNum = captured.keyUrl.match(/\/(\d+)$/)?.[1];
  if (keyNum) {
    const cfKeyResp = await fetchBuf(
      `https://dlhd.vynx.workers.dev/key?url=${encodeURIComponent(`https://sec.ai-hls.site/key/premium${CHANNEL}/${keyNum}`)}`
    );
    console.log(`Browser key:  ${key.toString('hex')}`);
    console.log(`CF Worker key: ${cfKeyResp.body.toString('hex')}`);
    console.log(`Match: ${cfKeyResp.body.equals(key) ? '✅ YES' : '❌ NO — CF Worker is returning FAKE keys!'}`);
  }

  console.log(`\n${'='.repeat(70)}`);
  if (success) {
    console.log('  🎉 DECRYPTION VALIDATED — Segments decrypt to valid media');
  } else {
    console.log('  ❌ DECRYPTION FAILED — No valid media output at any offset');
  }
  console.log(`${'='.repeat(70)}\n`);
})().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
