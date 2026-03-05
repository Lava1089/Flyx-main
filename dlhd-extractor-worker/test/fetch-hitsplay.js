/**
 * Fetch the actual player page from hitsplay.fun
 */

async function fetchHitsplay(channelId) {
  const url = `https://hitsplay.fun/premiumtv/daddyhd.php?id=${channelId}`;
  
  console.log(`Fetching: ${url}`);
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': 'https://dlhd.link/',
      }
    });
    
    console.log(`Status: ${response.status}`);
    
    if (response.ok) {
      const html = await response.text();
      console.log(`Response length: ${html.length}`);
      
      // Save the response
      const fs = require('fs');
      fs.writeFileSync(`dlhd-extractor-worker/hitsplay-${channelId}.html`, html);
      console.log(`Saved to dlhd-extractor-worker/hitsplay-${channelId}.html`);
      
      // Analyze the content
      console.log('\n=== Content Analysis ===');
      
      // Look for HLS.js
      if (html.includes('hls.js') || html.includes('Hls.')) {
        console.log('✅ Found HLS.js reference');
      }
      
      // Look for stream URLs
      const urlPattern = /https?:\/\/[a-z0-9.-]+\.dvalna\.ru[^\s'"<>]*/gi;
      const urls = html.match(urlPattern);
      if (urls) {
        console.log('Stream URLs found:');
        [...new Set(urls)].forEach(u => console.log('  -', u));
      }
      
      // Look for JWT/token
      if (html.includes('Bearer') || html.includes('Authorization')) {
        console.log('✅ Found Authorization header');
      }
      
      // Look for the config
      if (html.includes('ZpQw9XkLmN8c3vR3')) {
        console.log('✅ Found ZpQw9XkLmN8c3vR3 config');
      }
      
      // Look for video element
      const videoMatch = html.match(/<video[^>]*>/gi);
      if (videoMatch) {
        console.log('Video elements:', videoMatch.length);
        videoMatch.forEach(v => console.log('  -', v));
      }
      
      // Look for script sources
      const scriptSrcPattern = /<script[^>]+src\s*=\s*['"]([^'"]+)['"]/gi;
      let scriptMatch;
      console.log('\nExternal scripts:');
      while ((scriptMatch = scriptSrcPattern.exec(html)) !== null) {
        console.log('  -', scriptMatch[1]);
      }
      
      // Look for inline scripts with player code
      const inlineScriptPattern = /<script[^>]*>([^<]+)<\/script>/gi;
      let inlineMatch;
      let scriptNum = 0;
      console.log('\nInline scripts:');
      while ((inlineMatch = inlineScriptPattern.exec(html)) !== null) {
        scriptNum++;
        const content = inlineMatch[1];
        if (content.length > 100) {
          console.log(`  Script ${scriptNum}: ${content.length} chars`);
          if (content.includes('Hls') || content.includes('video') || content.includes('source')) {
            console.log('    -> Contains player-related code');
          }
        }
      }
      
      // Print first 2000 chars
      console.log('\n=== First 2000 chars ===');
      console.log(html.substring(0, 2000));
      
    } else {
      console.log('Failed to fetch');
    }
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }
}

fetchHitsplay(51);
