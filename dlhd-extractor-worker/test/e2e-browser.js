/**
 * E2E Browser Test for DLHD Stream Extraction
 * Uses Puppeteer to bypass Cloudflare and extract stream data
 */

const puppeteer = require('puppeteer');

const DLHD_BASE = 'https://dlhd.link';

async function testChannelList() {
  console.log('=== Testing Channel List ===');
  
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    
    // Set a real browser user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    console.log('Navigating to DLHD 24/7 channels page...');
    await page.goto(`${DLHD_BASE}/24-7-channels.php`, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    // Extract channel data from the page
    const channels = await page.evaluate(() => {
      const results = [];
      
      // Find all channel links - they typically have format /stream/embed/XX/premium
      const links = document.querySelectorAll('a[href*="/stream/"], a[href*="watch.php"]');
      
      links.forEach(link => {
        const href = link.getAttribute('href');
        const text = link.textContent?.trim();
        
        // Extract channel ID from URL
        let id = null;
        const streamMatch = href.match(/\/stream\/embed\/(\d+)/);
        const watchMatch = href.match(/watch\.php\?id=(\d+)/);
        
        if (streamMatch) id = streamMatch[1];
        else if (watchMatch) id = watchMatch[1];
        
        if (id && text) {
          results.push({ id, name: text, href });
        }
      });
      
      return results;
    });
    
    console.log(`Found ${channels.length} channels:`);
    channels.slice(0, 10).forEach(ch => {
      console.log(`  - [${ch.id}] ${ch.name}`);
    });
    
    if (channels.length > 10) {
      console.log(`  ... and ${channels.length - 10} more`);
    }
    
    return channels;
  } finally {
    await browser.close();
  }
}

async function testChannelPage(channelId) {
  console.log(`\n=== Testing Channel ${channelId} Page ===`);
  
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    console.log(`Navigating to channel ${channelId}...`);
    await page.goto(`${DLHD_BASE}/watch.php?id=${channelId}`, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    // Extract player iframes/embeds
    const players = await page.evaluate(() => {
      const results = [];
      
      // Find all iframes that might be players
      const iframes = document.querySelectorAll('iframe');
      iframes.forEach((iframe, idx) => {
        const src = iframe.getAttribute('src') || iframe.getAttribute('data-src');
        if (src) {
          results.push({
            id: idx + 1,
            type: 'iframe',
            src: src
          });
        }
      });
      
      // Also look for player buttons/tabs
      const playerBtns = document.querySelectorAll('[data-player], [onclick*="player"], .player-btn, .server-btn');
      playerBtns.forEach((btn, idx) => {
        const dataPlayer = btn.getAttribute('data-player');
        const onclick = btn.getAttribute('onclick');
        const text = btn.textContent?.trim();
        
        results.push({
          id: results.length + 1,
          type: 'button',
          dataPlayer,
          onclick: onclick?.substring(0, 100),
          text
        });
      });
      
      return results;
    });
    
    console.log(`Found ${players.length} player elements:`);
    players.forEach(p => {
      if (p.type === 'iframe') {
        console.log(`  - [${p.id}] iframe: ${p.src?.substring(0, 80)}...`);
      } else {
        console.log(`  - [${p.id}] button: ${p.text} (data-player: ${p.dataPlayer})`);
      }
    });
    
    // Get the page HTML for analysis
    const html = await page.content();
    console.log(`\nPage HTML length: ${html.length} chars`);
    
    // Look for M3U8 URLs in the page source
    const m3u8Matches = html.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/g) || [];
    if (m3u8Matches.length > 0) {
      console.log(`\nFound ${m3u8Matches.length} M3U8 URLs in page source:`);
      m3u8Matches.forEach(url => console.log(`  - ${url}`));
    }
    
    return { players, html };
  } finally {
    await browser.close();
  }
}

async function testStreamExtraction(channelId) {
  console.log(`\n=== Testing Stream Extraction for Channel ${channelId} ===`);
  
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Intercept network requests to capture M3U8 URLs
    const m3u8Urls = [];
    await page.setRequestInterception(true);
    
    page.on('request', request => {
      const url = request.url();
      if (url.includes('.m3u8')) {
        console.log(`[Network] M3U8 request: ${url}`);
        m3u8Urls.push({
          url,
          headers: request.headers()
        });
      }
      request.continue();
    });
    
    page.on('response', async response => {
      const url = response.url();
      if (url.includes('.m3u8')) {
        console.log(`[Network] M3U8 response: ${response.status()} ${url}`);
      }
    });
    
    console.log(`Navigating to channel ${channelId}...`);
    await page.goto(`${DLHD_BASE}/watch.php?id=${channelId}`, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    // Wait a bit for any lazy-loaded content
    await new Promise(r => setTimeout(r, 3000));
    
    console.log(`\nCaptured ${m3u8Urls.length} M3U8 requests`);
    m3u8Urls.forEach(m => {
      console.log(`  URL: ${m.url}`);
      console.log(`  Headers: ${JSON.stringify(m.headers, null, 2)}`);
    });
    
    return m3u8Urls;
  } finally {
    await browser.close();
  }
}

// Run tests
async function main() {
  try {
    // Test 1: Get channel list
    const channels = await testChannelList();
    
    if (channels.length > 0) {
      // Test 2: Get channel page for first channel
      const firstChannel = channels[0];
      await testChannelPage(firstChannel.id);
      
      // Test 3: Try to extract stream
      await testStreamExtraction(firstChannel.id);
    }
    
    // Also test a known channel (31 is often active)
    console.log('\n\n========== Testing Known Channel 31 ==========');
    await testChannelPage('31');
    await testStreamExtraction('31');
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();
