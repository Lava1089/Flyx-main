/**
 * DLHD Stream Extraction - Visible Browser Mode
 * Sometimes Cloudflare requires a visible browser
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

async function main() {
  console.log('Launching visible browser...');
  
  const browser = await puppeteer.launch({
    headless: false, // VISIBLE browser
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--start-maximized'
    ],
    defaultViewport: null
  });
  
  const page = await browser.newPage();
  
  // Capture network requests
  const m3u8Requests = [];
  await page.setRequestInterception(true);
  page.on('request', req => {
    const url = req.url();
    if (url.includes('.m3u8') || url.includes('/key/') || url.includes('.key')) {
      m3u8Requests.push({ url, headers: req.headers() });
      console.log(`[M3U8/KEY] ${url}`);
    }
    req.continue();
  });
  
  console.log('Navigating to DLHD...');
  await page.goto('https://dlhd.link/24-7-channels.php', {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });
  
  // Wait for user to solve any challenge manually if needed
  console.log('\nWaiting 30 seconds for page to load (solve CAPTCHA if shown)...');
  await new Promise(r => setTimeout(r, 30000));
  
  const title = await page.title();
  console.log(`\nPage title: ${title}`);
  
  if (!title.includes('moment')) {
    const html = await page.content();
    fs.writeFileSync('dlhd-visible.html', html);
    console.log(`Saved ${html.length} bytes to dlhd-visible.html`);
    
    // Extract channel IDs
    const channelMatches = html.match(/watch\.php\?id=(\d+)/g) || [];
    const uniqueIds = [...new Set(channelMatches.map(m => m.match(/id=(\d+)/)[1]))];
    console.log(`\nFound ${uniqueIds.length} channels: ${uniqueIds.join(', ')}`);
    
    if (uniqueIds.length > 0) {
      // Navigate to first channel
      const channelId = uniqueIds[0];
      console.log(`\nNavigating to channel ${channelId}...`);
      await page.goto(`https://dlhd.link/watch.php?id=${channelId}`, {
        waitUntil: 'networkidle2',
        timeout: 60000
      });
      
      await new Promise(r => setTimeout(r, 10000));
      
      const channelHtml = await page.content();
      fs.writeFileSync(`dlhd-channel-${channelId}-visible.html`, channelHtml);
      
      // Find iframes
      const iframes = await page.$$eval('iframe', frames => 
        frames.map(f => f.src).filter(s => s)
      );
      console.log(`\nFound ${iframes.length} iframes:`);
      iframes.forEach(src => console.log(`  - ${src}`));
      
      console.log(`\nCaptured ${m3u8Requests.length} M3U8/key requests`);
      m3u8Requests.forEach(r => {
        console.log(`  URL: ${r.url}`);
        console.log(`  Headers: ${JSON.stringify(r.headers)}\n`);
      });
    }
  } else {
    console.log('Still stuck on Cloudflare challenge');
  }
  
  console.log('\nKeeping browser open for 60 seconds for manual inspection...');
  await new Promise(r => setTimeout(r, 60000));
  
  await browser.close();
}

main().catch(console.error);
