// Test lovecdn.ru - the player 6 backend for most channels
const https = require('https');

function httpsReq(url, headers = {}, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', ...headers },
      timeout, family: 4,
    }, (res) => {
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
  console.log('=== lovecdn.ru Analysis ===');
  console.log('Time:', new Date().toISOString());
  
  // First, get the stream names from player 6 pages
  const streamMap = {
    '44': 'ESPN',
    '35': 'SkySportsFootballUK',
    '98': 'beINAR8',
    '51': null, // uses blogspot, not lovecdn
    '321': null, // uses codepcplay
  };
  
  // Fetch a few more player 6 pages to discover more stream names
  console.log('\n[1] Discovering stream names from player 6...');
  const testChannels = [39, 45, 53, 54, 31, 32, 33, 60, 130, 338, 336, 405, 303];
  for (const ch of testChannels) {
    try {
      const r = await httpsReq(`https://dlhd.link/player/stream-${ch}.php`, { 'Referer': 'https://dlhd.link/' }, 8000);
      const html = r.data.toString('utf8');
      // Look for lovecdn iframe
      const lovecdnMatch = html.match(/lovecdn\.ru\/daddy\.php\?stream=([^"'&\s]+)/);
      // Look for blogspot iframe
      const blogMatch = html.match(/tv-bu1\.blogspot\.com\/p\/e1\.html\?id=([^"'&\s]+)/);
      // Look for codepcplay iframe
      const codepcMatch = html.match(/codepcplay\.fun\/premiumtv\/daddyhd\.php\?id=([^"'&\s]+)/);
      
      if (lovecdnMatch) {
        streamMap[ch] = lovecdnMatch[1];
        console.log(`  ch${String(ch).padStart(3)}: lovecdn -> ${lovecdnMatch[1]}`);
      } else if (blogMatch) {
        console.log(`  ch${String(ch).padStart(3)}: blogspot -> ${blogMatch[1]}`);
      } else if (codepcMatch) {
        console.log(`  ch${String(ch).padStart(3)}: codepcplay -> ${codepcMatch[1]}`);
      } else {
        console.log(`  ch${String(ch).padStart(3)}: unknown iframe`);
      }
    } catch (e) { console.log(`  ch${ch}: ERROR ${e.message}`); }
  }
  
  // Now fetch lovecdn.ru pages and analyze them
  console.log('\n[2] Analyzing lovecdn.ru player pages...');
  const streams = ['ESPN', 'SkySportsFootballUK', 'beINAR8'];
  for (const stream of streams) {
    console.log(`\n  --- ${stream} ---`);
    try {
      const r = await httpsReq(`https://lovecdn.ru/daddy.php?stream=${stream}`, {
        'Referer': 'https://dlhd.link/',
        'Origin': 'https://dlhd.link',
      });
      const html = r.data.toString('utf8');
      console.log(`  Status: ${r.status}, Size: ${html.length}b`);
      
      // Look for m3u8 URLs
      const m3u8s = html.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/gi);
      if (m3u8s) console.log(`  m3u8: ${m3u8s.join('\n        ')}`);
      
      // Look for mono.css
      const css = html.match(/https?:\/\/[^\s"']+mono\.css[^\s"']*/gi);
      if (css) console.log(`  mono.css: ${css.join('\n           ')}`);
      
      // Look for source/file/url
      const srcs = html.match(/(?:source|file|url|src)\s*[:=]\s*["']?(https?:\/\/[^\s"']+)/gi);
      if (srcs) {
        const filtered = srcs.filter(s => !s.includes('cloudflare') && !s.includes('jquery'));
        console.log(`  sources: ${filtered.slice(0, 5).join('\n           ')}`);
      }
      
      // Look for EPlayerAuth
      if (html.includes('EPlayerAuth')) console.log(`  Has EPlayerAuth: YES`);
      
      // Look for hls.js or other players
      if (html.includes('Hls(') || html.includes('hls.js')) console.log(`  Has hls.js: YES`);
      if (html.includes('Clappr')) console.log(`  Has Clappr: YES`);
      if (html.includes('jwplayer')) console.log(`  Has jwplayer: YES`);
      
      // Look for moveonjoy
      if (html.includes('moveonjoy')) console.log(`  Has moveonjoy: YES`);
      
      // Look for interesting domains
      const domains = html.match(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/gi);
      if (domains) {
        const unique = [...new Set(domains)].filter(d => 
          !d.includes('google') && !d.includes('jquery') && !d.includes('cloudflare') &&
          !d.includes('bootstrap') && !d.includes('fontawesome') && !d.includes('histats')
        );
        console.log(`  Domains: ${unique.join(', ')}`);
      }
      
      // Print relevant JS sections
      const scriptMatches = html.match(/<script[^>]*>[\s\S]*?<\/script>/gi);
      if (scriptMatches) {
        for (const script of scriptMatches) {
          if (script.includes('m3u8') || script.includes('Hls') || script.includes('source') || 
              script.includes('player') || script.includes('moveonjoy') || script.includes('cdn-live')) {
            console.log(`\n  --- Relevant Script ---`);
            console.log(script.substring(0, 3000));
            console.log(`  --- End Script ---`);
          }
        }
      }
      
    } catch (e) { console.log(`  ERROR: ${e.message}`); }
  }
}

main().catch(console.error);
