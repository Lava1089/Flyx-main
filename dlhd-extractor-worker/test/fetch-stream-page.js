/**
 * Fetch the actual DLHD stream page (stream-XX.php) to analyze how they play so fast
 * 
 * The watch page just embeds an iframe to /stream/stream-{id}.php
 * That's where the actual HLS player and JWT generation happens
 */

const CHANNEL_ID = process.argv[2] || '51';

async function fetchStreamPage() {
  console.log(`\n=== Fetching DLHD Stream Page for Channel ${CHANNEL_ID} ===\n`);
  
  // The actual stream player page URL
  const streamUrl = `https://dlhd.link/stream/stream-${CHANNEL_ID}.php`;
  
  console.log(`Fetching: ${streamUrl}`);
  
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://dlhd.link/',
    'Origin': 'https://dlhd.link',
    'Sec-Fetch-Dest': 'iframe',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
  };
  
  try {
    const start = Date.now();
    const response = await fetch(streamUrl, { headers });
    const elapsed = Date.now() - start;
    
    console.log(`\nResponse Status: ${response.status}`);
    console.log(`Response Time: ${elapsed}ms`);
    console.log(`Content-Type: ${response.headers.get('content-type')}`);
    
    const html = await response.text();
    console.log(`\nHTML Length: ${html.length} bytes`);
    
    // Check if it's a Cloudflare challenge
    if (html.includes('Just a moment') || html.includes('cf-turnstile')) {
      console.log('\n❌ Got Cloudflare challenge page');
      console.log('Need to use browser automation or solve the challenge');
      return;
    }
    
    // Look for the encoded config
    const configMatch = html.match(/window\['([^']+)'\]\s*=\s*'([^']+)'/);
    if (configMatch) {
      console.log(`\n✅ Found encoded config!`);
      console.log(`Config Key: ${configMatch[1]}`);
      console.log(`Config Value (first 100 chars): ${configMatch[2].substring(0, 100)}...`);
      
      // Try to decode it
      try {
        const decoded = Buffer.from(configMatch[2], 'base64').toString('utf-8');
        console.log(`\nDecoded (first 200 chars): ${decoded.substring(0, 200)}...`);
      } catch (e) {
        console.log(`\nCouldn't decode as base64: ${e.message}`);
      }
    }
    
    // Look for HLS.js or video player references
    if (html.includes('hls.js') || html.includes('Hls.')) {
      console.log('\n✅ Found HLS.js reference');
    }
    
    // Look for m3u8 URLs
    const m3u8Match = html.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/g);
    if (m3u8Match) {
      console.log(`\n✅ Found M3U8 URLs:`);
      m3u8Match.forEach(url => console.log(`  - ${url}`));
    }
    
    // Look for mono.css (the actual stream endpoint)
    const monoMatch = html.match(/https?:\/\/[^"'\s]+mono\.css[^"'\s]*/g);
    if (monoMatch) {
      console.log(`\n✅ Found mono.css URLs:`);
      monoMatch.forEach(url => console.log(`  - ${url}`));
    }
    
    // Look for server references
    const serverMatch = html.match(/(ddy\d+|zeko|wind|dokko\d+|nfs|wiki)\.(dvalna|dlhd)/gi);
    if (serverMatch) {
      console.log(`\n✅ Found server references:`);
      [...new Set(serverMatch)].forEach(s => console.log(`  - ${s}`));
    }
    
    // Save the HTML for analysis
    const fs = require('fs');
    const filename = `dlhd-extractor-worker/stream-${CHANNEL_ID}-page.html`;
    fs.writeFileSync(filename, html);
    console.log(`\n📁 Saved HTML to: ${filename}`);
    
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
  }
}

fetchStreamPage();
