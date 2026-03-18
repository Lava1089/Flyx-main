#!/usr/bin/env node
/**
 * Sniff flixer.su network requests with Puppeteer.
 * Navigates to movie, clicks play, captures all API requests.
 */
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080'],
    defaultViewport: { width: 1920, height: 1080 },
  });

  const page = await browser.newPage();
  const apiRequests = [];
  const capRequests = [];

  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('plsdontscrapemelove') || url.includes('cap.hexa.su') || 
        (url.includes('/api/') && url.includes('flixer'))) {
      const headers = req.headers();
      const entry = {
        url,
        method: req.method(),
        headers: { ...headers },
        postData: req.postData() || null,
        ts: Date.now(),
      };
      if (url.includes('cap.hexa.su')) capRequests.push(entry);
      else apiRequests.push(entry);
      
      console.log(`\n>>> ${req.method()} ${url.substring(0, 150)}`);
      // Print ALL headers for API requests
      for (const [k, v] of Object.entries(headers)) {
        if (k !== 'user-agent') {
          console.log(`    ${k}: ${typeof v === 'string' && v.length > 120 ? v.substring(0, 120) + '...' : v}`);
        }
      }
      if (req.postData()) console.log(`    BODY: ${req.postData().substring(0, 200)}`);
    }
    req.continue();
  });

  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('plsdontscrapemelove') || url.includes('cap.hexa.su')) {
      let bodyPreview = '';
      try { const t = await res.text(); bodyPreview = t.substring(0, 300); } catch {}
      console.log(`\n<<< ${res.status()} ${url.substring(0, 150)}`);
      console.log(`    Body: ${bodyPreview}`);
    }
  });

  console.log('=== Loading flixer.su/movie/550 ===\n');
  await page.goto('https://flixer.su/movie/550', { waitUntil: 'networkidle2', timeout: 30000 });
  console.log('Page loaded. Looking for play button...');

  // Try to find and click play/watch button
  await new Promise(r => setTimeout(r, 2000));
  
  // Screenshot to see what's on the page
  await page.screenshot({ path: 'scripts/flixer-page.png' });
  console.log('Screenshot saved to scripts/flixer-page.png');

  // Try various selectors for play button
  const selectors = [
    'button[class*="play"]', 'a[class*="play"]', '[class*="play"]',
    'button[class*="watch"]', 'a[class*="watch"]', '[class*="watch"]',
    '.btn-play', '.play-btn', '#play', '.watch-btn',
    'button[class*="Play"]', 'a[href*="watch"]',
    'svg[class*="play"]', '[data-testid*="play"]',
  ];
  
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) {
      console.log(`Found element: ${sel}`);
      const text = await page.evaluate(e => e.textContent?.trim(), el);
      console.log(`  Text: "${text}"`);
    }
  }

  // Get all buttons and links text
  const buttons = await page.evaluate(() => {
    const els = [...document.querySelectorAll('button, a[href], [role="button"]')];
    return els.slice(0, 30).map(e => ({
      tag: e.tagName,
      text: e.textContent?.trim().substring(0, 50),
      href: e.getAttribute('href'),
      class: e.className?.substring?.(0, 80),
    }));
  });
  console.log('\nButtons/links on page:');
  for (const b of buttons) {
    if (b.text) console.log(`  <${b.tag}> "${b.text}" class="${b.class}" href="${b.href}"`);
  }

  // Try clicking anything that looks like play/watch
  try {
    const watchBtn = await page.evaluateHandle(() => {
      const els = [...document.querySelectorAll('button, a, [role="button"]')];
      return els.find(e => {
        const t = (e.textContent || '').toLowerCase();
        return t.includes('watch') || t.includes('play') || t.includes('stream');
      });
    });
    if (watchBtn) {
      console.log('\nClicking watch/play button...');
      await watchBtn.click();
      await new Promise(r => setTimeout(r, 10000));
    }
  } catch (e) {
    console.log('No watch button found, trying direct URL...');
    await page.goto('https://flixer.su/watch/movie/550', { waitUntil: 'networkidle0', timeout: 30000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 10000));
  }

  console.log('\n\n========== SUMMARY ==========');
  console.log(`Cap requests: ${capRequests.length}`);
  console.log(`API requests: ${apiRequests.length}`);
  
  for (const req of [...capRequests, ...apiRequests]) {
    console.log(`\n${req.method} ${req.url.substring(0, 200)}`);
    // Print key headers
    for (const [k, v] of Object.entries(req.headers)) {
      if (k.startsWith('x-') || k === 'origin' || k === 'referer' || 
          k.includes('cap') || k.includes('token') || k.includes('fingerprint') ||
          k === 'accept' || k === 'content-type') {
        console.log(`  ${k}: ${v}`);
      }
    }
  }

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
