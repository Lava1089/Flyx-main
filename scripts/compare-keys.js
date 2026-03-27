const { chromium } = require('playwright');

(async () => {
  console.log('Launching browser to get REAL key...\n');
  const browser = await chromium.launch({ headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true,
  });
  await context.route(/doubleclick|googlesyndication|analytics\.google|histats|xadsmart|dtscout|rtmark|protraffic|usrpubtrk|405kk|kofeslos|al5sm/, r => r.abort());

  let realKey = null, keyUrl = null;

  const page = await context.newPage();
  page.on('response', async (resp) => {
    if (resp.url().includes('/key/premium51/') && resp.status() === 200) {
      try {
        const buf = await resp.body();
        if (buf.length === 16) {
          realKey = buf;
          keyUrl = resp.url();
          console.log(`🔑 Browser key: ${buf.toString('hex')} from ${resp.url()}`);
        }
      } catch {}
    }
  });

  try { await page.goto('https://dlstreams.top/embed/stream-51.php', { waitUntil: 'domcontentloaded', timeout: 15000 }); } catch {}

  const start = Date.now();
  while (!realKey && Date.now() - start < 20000) await page.waitForTimeout(500);
  await browser.close();

  if (!realKey) { console.log('❌ No key captured'); process.exit(1); }

  // Now compare with RPI
  const keyNum = keyUrl.match(/\/(\d+)$/)?.[1];
  console.log(`\nKey number: ${keyNum}`);
  console.log(`Browser key: ${realKey.toString('hex')}`);

  // Fetch same key from RPI
  const https = require('https');
  const RPI_KEY = '5f1845926d725bb2a8230a6ed231fce1d03f07782f74a3f683c30ec04d4ac560';
  const rpiUrl = `https://rpi-proxy.vynx.cc/dlhd-key-v6?url=${encodeURIComponent(`https://sec.ai-hls.site/key/premium51/${keyNum}`)}&key=${RPI_KEY}`;

  console.log('Fetching same key from RPI...');
  const rpiResp = await new Promise((resolve, reject) => {
    https.get(rpiUrl, { headers: { 'X-API-Key': RPI_KEY, 'User-Agent': 'Mozilla/5.0' }, timeout: 30000 }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });

  console.log(`RPI key:     ${rpiResp.body.toString('hex')} (${rpiResp.status})`);
  console.log(`Match: ${realKey.equals(rpiResp.body) ? '✅ YES' : '❌ NO — RPI is returning FAKE key'}`);
})().catch(e => console.error('Fatal:', e.message));
