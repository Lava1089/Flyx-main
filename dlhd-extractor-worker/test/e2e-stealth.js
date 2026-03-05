/**
 * DLHD Stream Extraction with Puppeteer Stealth
 * Bypasses Cloudflare detection
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

async function fetchPage(url, waitForSelector = null) {
  console.log(`\nFetching: ${url}`);
  
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled'
    ]
  });
  
  try {
    const page = await browser.newPage();
    
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Intercept M3U8 requests
    const networkRequests = [];
    await page.setRequestInterception(true);
    page.on('request', req => {
      const url = req.url();
      if (url.includes('.m3u8') || url.includes('m3u8') || url.includes('.ts') || url.includes('.key')) {
        networkRequests.push({ url, headers: req.headers(), type: 'request' });
        console.log(`[REQ] ${url.substring(0, 100)}`);
      }
      req.continue();
    });
    
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });
    
    // Check if we passed Cloudflare
    const title = await page.title();
    console.log(`Page title: ${title}`);
    
    if (title.includes('moment') || title.includes('Cloudflare')) {
      console.log('Still on Cloudflare challenge, waiting longer...');
      await new Promise(r => setTimeout(r, 10000));
    }
    
    if (waitForSelector) {
      try {
        await page.waitForSelector(waitForSelector, { timeout: 10000 });
        console.log(`Found selector: ${waitForSelector}`);
      } catch (e) {
        console.log(`Selector not found: ${waitForSelector}`);
      }
    }
    
    const html = await page.content();
    const finalTitle = await page.title();
    
    return { html, title: finalTitle, networkRequests, page, browser };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

async function testChannels() {
  console.log('=== Testing DLHD Channel List ===');
  
  const { html, title, browser } = await fetchPage('https://dlhd.link/24-7-channels.php');
  
  console.log(`Final title: ${title}`);
  console.log(`HTML length: ${html.length}`);
  
  // Save for analysis
  fs.writeFileSync('dlhd-channels-stealth.html', html);
  
  // Check if we got past Cloudflare
  if (!title.includes('moment')) {
    console.log('SUCCESS: Bypassed Cloudflare!');
    
    // Look for channel links
    const channelMatches = html.match(/watch\.php\?id=(\d+)/g) || [];
    console.log(`Found ${channelMatches.length} channel links`);
    
    const uniqueIds = [...new Set(channelMatches.map(m => m.match(/id=(\d+)/)[1]))];
    console.log(`Unique channel IDs: ${uniqueIds.slice(0, 20).join(', ')}...`);
  }
  
  await browser.close();
}

async function testChannel(channelId) {
  console.log(`\n=== Testing Channel ${channelId} ===`);
  
  const { html, title, networkRequests, page, browser } = await fetchPage(
    `https://dlhd.link/watch.php?id=${channelId}`
  );
  
  console.log(`Final title: ${title}`);
  fs.writeFileSync(`dlhd-channel-${channelId}-stealth.html`, html);
  
  if (!title.includes('moment')) {
    console.log('SUCCESS: Bypassed Cloudflare!');
    
    // Find iframes
    const iframes = await page.$$eval('iframe', frames => 
      frames.map(f => ({ src: f.src, id: f.id, class: f.className }))
    );
    console.log(`Found ${iframes.length} iframes:`);
    iframes.forEach(f => console.log(`  - ${f.src || '(no src)'}`));
    
    // Find player elements
    const players = await page.$$eval('[class*="player"], [id*="player"], [data-player]', els =>
      els.map(e => ({ tag: e.tagName, id: e.id, class: e.className, dataPlayer: e.dataset?.player }))
    );
    console.log(`Found ${players.length} player elements`);
    
    // Look for M3U8 in page source
    const m3u8InSource = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/g) || [];
    console.log(`M3U8 URLs in source: ${m3u8InSource.length}`);
    m3u8InSource.forEach(u => console.log(`  - ${u}`));
    
    // Check network requests
    console.log(`\nNetwork requests captured: ${networkRequests.length}`);
    networkRequests.forEach(r => console.log(`  - ${r.url.substring(0, 100)}`));
  }
  
  await browser.close();
}

async function main() {
  try {
    await testChannels();
    await testChannel('31');
  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();
