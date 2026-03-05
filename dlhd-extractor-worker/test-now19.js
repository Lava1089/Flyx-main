// Extract the M3U8 URL from lovetier.bz player page
// The page uses hls.js - need to find where it loads the source
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
  console.log('=== Extract M3U8 from lovetier.bz ===');
  
  const r = await httpsReq('https://lovetier.bz/player/ESPN', {
    'Referer': 'https://lovecdn.ru/',
  });
  const html = r.data.toString('utf8');
  
  // Search for hls.loadSource or hls.attachMedia or loadSource patterns
  const hlsPatterns = [
    /hls\.loadSource\s*\(\s*["']([^"']+)["']\s*\)/g,
    /loadSource\s*\(\s*["']([^"']+)["']\s*\)/g,
    /source\s*[:=]\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/gi,
    /url\s*[:=]\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/gi,
    /file\s*[:=]\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/gi,
    /src\s*[:=]\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/gi,
    /["'](https?:\/\/[^"']*\.m3u8[^"']*)["']/gi,
    /["'](https?:\/\/[^"']*moveonjoy[^"']*)["']/gi,
    /["'](https?:\/\/[^"']*cdn-live[^"']*)["']/gi,
    /["'](https?:\/\/[^"']*lovetier[^"']*)["']/gi,
  ];
  
  console.log('\nSearching for stream URLs...');
  for (const pattern of hlsPatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      console.log(`  Pattern ${pattern.source.substring(0, 30)}: ${match[1] || match[0]}`);
    }
  }
  
  // Search for any URL-like strings that could be stream sources
  console.log('\nSearching for all URLs...');
  const urlPattern = /https?:\/\/[a-z0-9.-]+\.[a-z]{2,}[^\s"'<>\\)}\]]*(?:\.m3u8|\.ts|\.css|\/stream|\/live|\/play|\/channel|\/api)/gi;
  let urlMatch;
  while ((urlMatch = urlPattern.exec(html)) !== null) {
    console.log(`  ${urlMatch[0]}`);
  }
  
  // Look for base64 encoded strings that might contain URLs
  console.log('\nSearching for base64 strings...');
  const b64Pattern = /["']([A-Za-z0-9+/]{40,}={0,2})["']/g;
  let b64Match;
  let count = 0;
  while ((b64Match = b64Pattern.exec(html)) !== null && count < 5) {
    try {
      const decoded = Buffer.from(b64Match[1], 'base64').toString('utf8');
      if (decoded.includes('http') || decoded.includes('.m3u8') || decoded.includes('moveonjoy')) {
        console.log(`  Base64 decoded: ${decoded.substring(0, 200)}`);
        count++;
      }
    } catch {}
  }
  
  // Look for the hls.js initialization code specifically
  console.log('\nSearching for Hls initialization...');
  const hlsInit = html.match(/new\s+Hls\s*\([^)]*\)/g);
  if (hlsInit) console.log(`  Hls init: ${hlsInit.join(', ')}`);
  
  const attachMedia = html.match(/\.attachMedia\s*\([^)]+\)/g);
  if (attachMedia) console.log(`  attachMedia: ${attachMedia.join(', ')}`);
  
  const loadSource = html.match(/\.loadSource\s*\([^)]+\)/g);
  if (loadSource) console.log(`  loadSource: ${loadSource.slice(0, 5).join(', ')}`);
  
  // Look for variable assignments that might contain the URL
  // Often the URL is built dynamically
  console.log('\nSearching for dynamic URL construction...');
  const varPatterns = [
    /var\s+\w+\s*=\s*["'](https?:\/\/[^"']+)["']/g,
    /const\s+\w+\s*=\s*["'](https?:\/\/[^"']+)["']/g,
    /let\s+\w+\s*=\s*["'](https?:\/\/[^"']+)["']/g,
  ];
  for (const p of varPatterns) {
    let m;
    while ((m = p.exec(html)) !== null) {
      if (!m[1].includes('tailwind') && !m[1].includes('jsdelivr') && !m[1].includes('cloudflare')) {
        console.log(`  ${m[0].substring(0, 150)}`);
      }
    }
  }
  
  // Search around "loadSource" in the HTML
  console.log('\nContext around loadSource...');
  const idx = html.indexOf('loadSource');
  if (idx !== -1) {
    console.log(html.substring(Math.max(0, idx - 200), idx + 300));
  }
  
  // Search around "attachMedia"
  console.log('\nContext around attachMedia...');
  const idx2 = html.indexOf('attachMedia');
  if (idx2 !== -1) {
    console.log(html.substring(Math.max(0, idx2 - 200), idx2 + 300));
  }
}

main().catch(console.error);
