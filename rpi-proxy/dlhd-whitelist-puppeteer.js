#!/usr/bin/env node
/**
 * DLHD IP Whitelist via Puppeteer (real browser reCAPTCHA v3)
 * 
 * The HTTP-only reCAPTCHA bypass gets LOW scores that don't whitelist.
 * This uses a real headless browser to get HIGH scores.
 * 
 * Install: npm install puppeteer-core
 * Run: node dlhd-whitelist-puppeteer.js [--loop]
 */
const { execSync } = require('child_process');
const https = require('https');

let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  try {
    puppeteer = require('puppeteer');
  } catch {
    console.error('ERROR: Install puppeteer-core: npm install puppeteer-core');
    process.exit(1);
  }
}

const SITE_KEY = '6LfJv4AsAAAAALTLEHKaQ7LN_VYfFqhLPrB2Tvgj';
const VERIFY_URL = 'https://go.ai-chatx.site/verify';
const CHANNEL_KEY = 'premium44';
const FAKES = new Set([
  '45db13cfa0ed393fdb7da4dfe9b5ac81',
  '455806f8bc592fdacb6ed5e071a517b1',
  '4542956ed8680eaccb615f7faad4da8f',
]);

function findChromium() {
  const paths = [
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/snap/bin/chromium',
  ];
  for (const p of paths) {
    try { execSync(`test -f ${p}`, { stdio: 'ignore' }); return p; } catch {}
  }
  return null;
}

function fetchKey(keyUrl) {
  return new Promise((resolve, reject) => {
    https.get(keyUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36',
        'Referer': 'https://adffdafdsafds.sbs/',
        'Origin': 'https://adffdafdsafds.sbs',
      },
      timeout: 10000,
    }, r => {
      const c = [];
      r.on('data', d => c.push(d));
      r.on('end', () => {
        const b = Buffer.concat(c);
        resolve(b.length === 16 ? b.toString('hex') : `(${b.length} bytes)`);
      });
    }).on('error', e => resolve(`ERR: ${e.message}`));
  });
}

async function whitelistViaRealBrowser() {
  const chromePath = findChromium();
  const launchOpts = {
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-extensions',
      '--disable-blink-features=AutomationControlled',
    ],
  };
  if (chromePath) {
    launchOpts.executablePath = chromePath;
    console.log(`[Whitelist] Chromium: ${chromePath}`);
  }

  const browser = await puppeteer.launch(launchOpts);
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36');

    // Hide webdriver flag
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    // APPROACH 1: Load a minimal page that just loads reCAPTCHA and executes it.
    // The player page redirects when not in iframe (window === window.top check).
    // Instead, we create our own page that loads the reCAPTCHA script directly.
    console.log('[Whitelist] Loading reCAPTCHA directly...');
    
    // Set the page to the player domain so reCAPTCHA thinks we're on the right site
    // We intercept the navigation and serve our own HTML
    await page.setRequestInterception(true);
    
    let intercepted = false;
    page.on('request', req => {
      if (!intercepted && req.isNavigationRequest()) {
        intercepted = true;
        req.respond({
          status: 200,
          contentType: 'text/html',
          body: `<!DOCTYPE html>
<html>
<head>
  <script src="https://www.google.com/recaptcha/api.js?render=${SITE_KEY}"></script>
</head>
<body>
  <div id="status">Loading reCAPTCHA...</div>
  <script>
    window.__recaptchaReady = false;
    window.__recaptchaToken = null;
    window.__recaptchaError = null;
    
    // Wait for grecaptcha to be available
    function waitForRecaptcha() {
      if (typeof grecaptcha !== 'undefined' && typeof grecaptcha.execute === 'function') {
        window.__recaptchaReady = true;
        document.getElementById('status').textContent = 'reCAPTCHA ready!';
        return;
      }
      setTimeout(waitForRecaptcha, 200);
    }
    waitForRecaptcha();
  </script>
</body>
</html>`,
        });
      } else {
        req.continue();
      }
    });

    // Navigate to the player domain (our intercepted page will load)
    await page.goto('https://adffdafdsafds.sbs/premiumtv/daddyhd.php?id=44', {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    // Wait for reCAPTCHA to be ready
    console.log('[Whitelist] Waiting for reCAPTCHA to initialize...');
    await page.waitForFunction(() => window.__recaptchaReady === true, { timeout: 20000 });
    console.log('[Whitelist] reCAPTCHA ready!');

    // Small delay to let reCAPTCHA fully initialize
    await new Promise(r => setTimeout(r, 2000));

    // Execute reCAPTCHA v3
    console.log('[Whitelist] Executing reCAPTCHA v3...');
    const token = await page.evaluate((siteKey) => {
      return new Promise((resolve, reject) => {
        grecaptcha.ready(() => {
          grecaptcha.execute(siteKey, { action: 'player_access' })
            .then(resolve)
            .catch(reject);
        });
      });
    }, SITE_KEY);

    console.log(`[Whitelist] Token: ${token.substring(0, 30)}... (${token.length} chars)`);

    // POST to verify endpoint (from the browser context — same IP)
    console.log('[Whitelist] Verifying...');
    const verifyResult = await page.evaluate(async (verifyUrl, tok, chKey) => {
      const res = await fetch(verifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 'recaptcha-token': tok, 'channel_id': chKey }),
      });
      return { status: res.status, body: await res.json() };
    }, VERIFY_URL, token, CHANNEL_KEY);

    console.log(`[Whitelist] Verify:`, JSON.stringify(verifyResult.body));

    if (verifyResult.body.success) {
      const score = verifyResult.body.score || 'N/A';
      console.log(`[Whitelist] ✅ Success! Score: ${score}`);

      // Verify by fetching a key (from this machine's IP, not browser)
      const keyHex = await fetchKey('https://go.ai-chatx.site/key/premium44/5909741');
      const isReal = !FAKES.has(keyHex);
      console.log(`[Whitelist] Key check: ${keyHex} ${isReal ? '✅ REAL KEY!' : '❌ STILL FAKE'}`);

      return { success: true, score, keyHex, isReal };
    } else {
      console.log(`[Whitelist] ❌ Failed:`, verifyResult.body);
      return { success: false, error: verifyResult.body };
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  const loop = process.argv.includes('--loop');
  console.log(`=== DLHD Puppeteer Whitelist (${loop ? 'loop' : 'single'}) ===`);

  try {
    const result = await whitelistViaRealBrowser();
    console.log('Result:', JSON.stringify(result));
  } catch (e) {
    console.error('Error:', e.message);
    if (e.stack) console.error(e.stack.split('\n').slice(0, 5).join('\n'));
  }

  if (loop) {
    setInterval(async () => {
      console.log(`\n[${new Date().toISOString()}] Re-whitelisting...`);
      try {
        const result = await whitelistViaRealBrowser();
        console.log('Result:', JSON.stringify(result));
      } catch (e) {
        console.error('Error:', e.message);
      }
    }, 10 * 60 * 1000);
  }
}

main();
