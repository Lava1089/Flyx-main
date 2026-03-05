/**
 * Dump DLHD page HTML for analysis
 */

const puppeteer = require('puppeteer');
const fs = require('fs');

async function dumpPage(url, filename) {
  console.log(`Fetching: ${url}`);
  
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Log console messages
    page.on('console', msg => console.log('[Console]', msg.text()));
    
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });
    
    // Wait for potential JS execution
    await new Promise(r => setTimeout(r, 5000));
    
    const html = await page.content();
    fs.writeFileSync(filename, html);
    console.log(`Saved ${html.length} bytes to ${filename}`);
    
    // Also get the page title
    const title = await page.title();
    console.log(`Page title: ${title}`);
    
    // Check for Cloudflare challenge
    if (html.includes('challenge-platform') || html.includes('cf-browser-verification')) {
      console.log('WARNING: Cloudflare challenge detected!');
    }
    
    // Look for key patterns
    const patterns = [
      { name: 'iframe', regex: /<iframe[^>]*>/gi },
      { name: 'player', regex: /player/gi },
      { name: 'm3u8', regex: /\.m3u8/gi },
      { name: 'hls', regex: /hls/gi },
      { name: 'stream', regex: /stream/gi },
      { name: 'embed', regex: /embed/gi },
    ];
    
    console.log('\nPattern matches:');
    patterns.forEach(p => {
      const matches = html.match(p.regex) || [];
      console.log(`  ${p.name}: ${matches.length} matches`);
    });
    
  } finally {
    await browser.close();
  }
}

async function main() {
  // Dump the 24/7 channels page
  await dumpPage('https://dlhd.link/24-7-channels.php', 'dlhd-channels.html');
  
  // Dump a channel page
  await dumpPage('https://dlhd.link/watch.php?id=31', 'dlhd-channel-31.html');
}

main().catch(console.error);
