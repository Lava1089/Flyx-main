// Test player 6: https://dlhd.link/player/stream-{channel}.php
// Figure out what it serves and how to extract the stream
const https = require('https');

function httpsReq(url, headers = {}, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', ...headers },
      timeout, family: 4,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        console.log(`  Redirect: ${res.statusCode} -> ${res.headers.location}`);
        httpsReq(res.headers.location, headers, timeout).then(resolve).catch(reject);
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

async function main() {
  console.log('=== Player 6 Analysis ===');
  console.log('Time:', new Date().toISOString());
  
  // Test a few channels
  const channels = [51, 44, 35, 98, 321];
  
  for (const ch of channels) {
    console.log(`\n--- Channel ${ch} ---`);
    const url = `https://dlhd.link/player/stream-${ch}.php`;
    try {
      const r = await httpsReq(url, { 'Referer': 'https://dlhd.link/' });
      const html = r.data.toString('utf8');
      console.log(`  Status: ${r.status}, Size: ${html.length}b`);
      
      // Look for iframe src
      const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
      if (iframeMatch) console.log(`  iframe: ${iframeMatch[1]}`);
      
      // Look for m3u8 URLs
      const m3u8Matches = html.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/gi);
      if (m3u8Matches) console.log(`  m3u8: ${m3u8Matches.join(', ')}`);
      
      // Look for .css (dvalna uses mono.css)
      const cssMatches = html.match(/https?:\/\/[^\s"']+mono\.css[^\s"']*/gi);
      if (cssMatches) console.log(`  mono.css: ${cssMatches.join(', ')}`);
      
      // Look for source/src URLs
      const srcMatches = html.match(/(?:source|src|file|url)\s*[:=]\s*["']?(https?:\/\/[^\s"']+)/gi);
      if (srcMatches) console.log(`  sources: ${srcMatches.slice(0, 5).join('\n           ')}`);
      
      // Look for EPlayerAuth
      const authMatch = html.match(/EPlayerAuth/);
      if (authMatch) console.log(`  Has EPlayerAuth: YES`);
      
      // Look for any player init
      const playerMatch = html.match(/(?:jwplayer|videojs|hls\.js|Clappr|flowplayer|player\s*\()/i);
      if (playerMatch) console.log(`  Player: ${playerMatch[0]}`);
      
      // Look for moveonjoy
      const movMatch = html.match(/moveonjoy/i);
      if (movMatch) console.log(`  Has moveonjoy: YES`);
      
      // Look for cdn-live
      const cdnMatch = html.match(/cdn-live/i);
      if (cdnMatch) console.log(`  Has cdn-live: YES`);
      
      // Look for any interesting domains
      const domainMatches = html.match(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/gi);
      if (domainMatches) {
        const unique = [...new Set(domainMatches)].filter(d => 
          !d.includes('google') && !d.includes('jquery') && !d.includes('cloudflare') &&
          !d.includes('bootstrap') && !d.includes('fontawesome')
        );
        console.log(`  Domains: ${unique.slice(0, 10).join(', ')}`);
      }
      
      // Print first 2000 chars for manual inspection
      console.log(`\n  --- HTML Preview (first 2000 chars) ---`);
      console.log(html.substring(0, 2000));
      console.log(`  --- End Preview ---`);
      
    } catch (e) { console.log(`  ERROR: ${e.message}`); }
  }
}

main().catch(console.error);
