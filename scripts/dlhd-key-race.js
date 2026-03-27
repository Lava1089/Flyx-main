#!/usr/bin/env node
/**
 * Race test: Browser key vs RPI key for the EXACT same key number + segment
 * Proves whether RPI is returning real or fake keys.
 */
const { chromium } = require('playwright');
const crypto = require('crypto');
const https = require('https');

const RPI_KEY = '5f1845926d725bb2a8230a6ed231fce1d03f07782f74a3f683c30ec04d4ac560';

function fetchBuf(url, hdrs = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: { 'User-Agent': 'Mozilla/5.0', ...hdrs }, timeout: 45000 }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

(async () => {
  console.log('=== Browser vs RPI Key Race Test ===\n');

  const browser = await chromium.launch({ headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true });
  await context.route(/doubleclick|googlesyndication|histats|xadsmart|dtscout|rtmark|protraffic|usrpubtrk|405kk|kofeslos|al5sm/, r => r.abort());

  let browserKey = null, m3u8Body = null, keyUrl = null;

  const page = await context.newPage();
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('/key/premium51/') && resp.status() === 200 && !browserKey) {
      try {
        const buf = await resp.body();
        if (buf.length === 16) { browserKey = buf; keyUrl = url; }
      } catch {}
    }
    if ((url.includes('mono.css') || url.includes('.m3u8')) && resp.status() === 200 && !m3u8Body) {
      try {
        const body = await resp.text();
        if (body.includes('#EXTM3U')) m3u8Body = body;
      } catch {}
    }
  });

  try { await page.goto('https://dlstreams.top/embed/stream-51.php', { waitUntil: 'domcontentloaded', timeout: 15000 }); } catch {}

  const start = Date.now();
  while ((!browserKey || !m3u8Body) && Date.now() - start < 20000) await page.waitForTimeout(300);
  await browser.close();

  if (!browserKey || !m3u8Body) { console.log('❌ Failed to capture browser data'); process.exit(1); }

  // Parse M3U8
  const keyLine = m3u8Body.split('\n').find(l => l.includes('EXT-X-KEY'));
  const keyNum = keyUrl.match(/\/(\d+)$/)[1];
  const ivHex = keyLine.match(/IV=0x([a-f0-9]+)/)[1];
  const segUrl = m3u8Body.split('\n').filter(l => l.trim() && !l.startsWith('#'))[0].trim();

  console.log(`Browser key: ${browserKey.toString('hex')}`);
  console.log(`Key number:  ${keyNum}`);
  console.log(`IV:          ${ivHex}`);
  console.log(`Segment:     ${segUrl.substring(0, 60)}...\n`);

  // Fetch same key from RPI
  console.log('Fetching same key from RPI /dlhd-key-v6...');
  const rpiResp = await fetchBuf(
    `https://rpi-proxy.vynx.cc/dlhd-key-v6?url=${encodeURIComponent(`https://sec.ai-hls.site/key/premium51/${keyNum}`)}&key=${RPI_KEY}`,
    { 'X-API-Key': RPI_KEY }
  );
  const rpiKey = rpiResp.body;
  console.log(`RPI key:     ${rpiKey.toString('hex')} (${rpiResp.status})`);
  console.log(`Keys match:  ${browserKey.equals(rpiKey) ? '✅ YES' : '❌ NO'}\n`);

  // Fetch segment
  console.log('Fetching segment...');
  const seg = await fetchBuf(segUrl);
  console.log(`Segment:     ${seg.body.length}b\n`);

  // Try decrypting with BOTH keys
  const iv = Buffer.from(ivHex, 'hex');
  for (const [label, key] of [['Browser', browserKey], ['RPI', rpiKey]]) {
    try {
      const d = crypto.createDecipheriv('aes-128-cbc', key, iv);
      const dec = Buffer.concat([d.update(seg.body), d.final()]);
      let syncs = 0;
      const total = Math.min(Math.floor(dec.length / 188), 20);
      for (let i = 0; i < total * 188; i += 188) if (dec[i] === 0x47) syncs++;
      console.log(`${label} key decrypt: ${dec[0] === 0x47 ? '✅' : '❌'} first=0x${dec[0].toString(16)} syncs=${syncs}/${total}`);
    } catch (e) {
      console.log(`${label} key decrypt: ❌ ${e.message.substring(0, 40)}`);
    }
  }

  console.log('\n=== CONCLUSION ===');
  if (browserKey.equals(rpiKey)) {
    console.log('RPI returns the SAME key as the browser — the issue is elsewhere');
  } else {
    console.log('RPI returns a DIFFERENT (fake) key — the SOCKS5 verify/whitelist is broken');
    console.log('The ProxyJet residential IP is NOT being whitelisted by reCAPTCHA verify');
  }
})().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
