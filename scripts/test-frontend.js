const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();

  page.on('console', m => {
    const t = m.text();
    if (t.match(/error|fail|block|cors|denied|refused|key|hls|m3u8|whitelist|decrypt|stream|play|video|source|EXT-X|VideoPlayer|initPlayer|Stall|recover|reload/i))
      console.log('CON:', t.substring(0, 300));
  });
  page.on('pageerror', e => console.log('ERR:', e.message.substring(0, 200)));
  page.on('requestfailed', req => {
    const url = req.url();
    if (!url.match(/doubleclick|analytics|favicon|_rsc|preload/))
      console.log('FAIL:', url.substring(0, 120), req.failure()?.errorText);
  });
  page.on('response', async resp => {
    const url = resp.url();
    const s = resp.status();
    if (url.match(/\/play\/|\/key|mono\.css|m3u8|whitelist|\/segment|ai-hls|soyspace|dlstreams|backends/)) {
      const cors = resp.headers()['access-control-allow-origin'] || 'NO_CORS';
      console.log(`RESP: ${s} [CORS:${cors}] ${url.substring(0, 140)}`);
      if (s >= 400) { try { console.log('  BODY:', (await resp.text()).substring(0, 200)); } catch {} }
    }
  });

  console.log('1. Loading tv.vynx.cc/livetv...');
  await page.goto('https://tv.vynx.cc/livetv', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(5000);

  console.log('\n2. Clicking TV Channels tab...');
  await page.click('text=TV Channels').catch(() => console.log('   Could not find TV Channels tab'));
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/tv-channels.png' });

  console.log('\n3. Looking for channel cards...');
  // Click the first visible channel card
  const channelText = await page.evaluate(() => {
    // Find channel cards - they should have channel names
    const cards = document.querySelectorAll('[class*="card"], [class*="channel"], [class*="grid"] > div, [class*="list"] > div');
    for (const card of cards) {
      const text = card.textContent?.trim();
      if (text && text.length > 2 && text.length < 100 && card.offsetHeight > 30 && card.offsetWidth > 30) {
        // Check if it has a click handler or is interactive
        const btn = card.querySelector('button') || card.querySelector('a') || card;
        if (btn) {
          btn.click();
          return text.substring(0, 60);
        }
      }
    }
    return null;
  });
  console.log('   Clicked channel:', channelText || 'NONE');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/tv-player.png' });

  console.log('\n4. Waiting 30s for player + stream...\n');
  await page.waitForTimeout(30000);
  await page.screenshot({ path: '/tmp/tv-result.png' });

  // Final video state
  const state = await page.evaluate(() => {
    const v = document.querySelector('video');
    if (!v) return 'NO_VIDEO_ELEMENT';
    return JSON.stringify({
      src: (v.src || '').substring(0, 100),
      currentSrc: (v.currentSrc || '').substring(0, 100),
      readyState: v.readyState,
      networkState: v.networkState,
      paused: v.paused,
      currentTime: v.currentTime,
      error: v.error ? { code: v.error.code, message: v.error.message } : null,
    });
  });
  console.log('\nVIDEO:', state);
  await browser.close();
})();
