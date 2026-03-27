#!/usr/bin/env node
/**
 * DLHD Whitelist Keeper
 *
 * Runs in the background. Opens the DLHD player page every 15 minutes
 * to whitelist THIS machine's IP via real browser reCAPTCHA.
 *
 * After running this, the RPI proxy (same network = same public IP)
 * can fetch real keys from sec.ai-hls.site.
 *
 * Usage: node scripts/dlhd-whitelist-keeper.js
 */
const { chromium } = require('playwright');

const INTERVAL_MS = 14 * 60 * 1000; // 14 min (whitelist lasts ~20-30 min)

async function whitelist() {
  const ts = () => new Date().toISOString().substring(11, 19);
  console.log(`[${ts()}] Whitelisting...`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--autoplay-policy=no-user-gesture-required'],
  });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    ignoreHTTPSErrors: true,
  });
  await ctx.route(/doubleclick|googlesyndication|histats|xadsmart|dtscout|rtmark|protraffic|usrpubtrk|405kk|kofeslos|al5sm/, r => r.abort());

  let verified = false;
  const page = await ctx.newPage();
  page.on('response', async r => {
    if (r.url().includes('/verify') && r.status() === 200) {
      try {
        const body = await r.text();
        if (JSON.parse(body).success) { verified = true; console.log(`[${ts()}] ✅ Verified: ${body}`); }
      } catch {}
    }
  });

  try {
    await page.goto('https://dlstreams.top/embed/stream-51.php', { waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch {}

  // Wait for reCAPTCHA + verify
  const start = Date.now();
  while (!verified && Date.now() - start < 12000) await page.waitForTimeout(500);

  if (!verified) console.log(`[${ts()}] ⚠️  Verify not captured (may still have worked)`);

  await browser.close();
  console.log(`[${ts()}] Done. Next whitelist in ${INTERVAL_MS / 60000} min.\n`);
}

(async () => {
  console.log('DLHD Whitelist Keeper — keeps your IP whitelisted for key fetches');
  console.log('Press Ctrl+C to stop.\n');

  await whitelist();
  setInterval(whitelist, INTERVAL_MS);
})();
