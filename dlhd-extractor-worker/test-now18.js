// Follow the chain: lovecdn.ru -> lovetier.bz -> ???
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
  console.log('=== lovetier.bz Deep Analysis ===');
  console.log('Time:', new Date().toISOString());
  
  const streams = ['ESPN', 'SkySportsFootballUK', 'beINAR8', 'FOXSPORTS1', 'TNT1UK', 'NFLNETWORK', 'ESPN2', 'SkySportsF1', 'skysportspremierleague'];
  
  for (const stream of streams) {
    console.log(`\n--- ${stream} ---`);
    try {
      const r = await httpsReq(`https://lovetier.bz/player/${stream}`, {
        'Referer': 'https://lovecdn.ru/',
        'Origin': 'https://lovecdn.ru',
      });
      const html = r.data.toString('utf8');
      console.log(`Status: ${r.status}, Size: ${html.length}b`);
      
      // Look for m3u8 URLs
      const m3u8s = html.match(/https?:\/\/[^\s"'\\]+\.m3u8[^\s"'\\]*/gi);
      if (m3u8s) console.log(`m3u8: ${m3u8s.join('\n      ')}`);
      
      // Look for mono.css
      const css = html.match(/https?:\/\/[^\s"'\\]+mono\.css[^\s"'\\]*/gi);
      if (css) console.log(`mono.css: ${css.join('\n         ')}`);
      
      // Look for source/file/url patterns
      const srcs = html.match(/(?:source|file|url|src)\s*[:=]\s*["']?(https?:\/\/[^\s"'\\]+)/gi);
      if (srcs) {
        const filtered = srcs.filter(s => !s.includes('cloudflare') && !s.includes('jquery') && !s.includes('histats'));
        if (filtered.length) console.log(`sources: ${filtered.slice(0, 10).join('\n         ')}`);
      }
      
      // Look for EPlayerAuth
      if (html.includes('EPlayerAuth')) console.log(`EPlayerAuth: YES`);
      
      // Look for hls.js
      if (html.includes('Hls(') || html.includes('Hls.')) console.log(`hls.js: YES`);
      if (html.includes('Clappr')) console.log(`Clappr: YES`);
      
      // Look for moveonjoy
      if (html.includes('moveonjoy')) console.log(`moveonjoy: YES`);
      
      // Look for cdn-live
      if (html.includes('cdn-live')) console.log(`cdn-live: YES`);
      
      // Look for interesting domains
      const domains = html.match(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/gi);
      if (domains) {
        const unique = [...new Set(domains)].filter(d => 
          !d.includes('google') && !d.includes('jquery') && !d.includes('cloudflare') &&
          !d.includes('bootstrap') && !d.includes('fontawesome') && !d.includes('histats') &&
          !d.includes('lovetier')
        );
        if (unique.length) console.log(`Domains: ${unique.join(', ')}`);
      }
      
      // Print the full HTML if it's small enough (player pages are usually small)
      if (html.length < 5000) {
        console.log(`\n--- Full HTML ---`);
        console.log(html);
        console.log(`--- End ---`);
      } else {
        // Print first 3000 chars
        console.log(`\n--- HTML (first 3000) ---`);
        console.log(html.substring(0, 3000));
        console.log(`--- End ---`);
      }
    } catch (e) { console.log(`ERROR: ${e.message}`); }
  }
}

main().catch(console.error);
