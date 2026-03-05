// Scan all channels to build the lovecdn stream name map
const https = require('https');

function httpsReq(url, headers = {}, timeout = 10000) {
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
  console.log('=== Scanning player 6 for lovecdn stream names ===');
  
  // Scan channels 1-200 (most popular range)
  const lovecdnMap = {};
  const codepcplayMap = {};
  const blogspotMap = {};
  const unknownChannels = [];
  
  // Batch in groups of 10 to avoid hammering
  const allChannels = [];
  for (let i = 1; i <= 450; i++) allChannels.push(i);
  
  for (let batch = 0; batch < allChannels.length; batch += 10) {
    const batchChannels = allChannels.slice(batch, batch + 10);
    const promises = batchChannels.map(async (ch) => {
      try {
        const r = await httpsReq(`https://dlhd.link/player/stream-${ch}.php`, { 'Referer': 'https://dlhd.link/' }, 8000);
        const html = r.data.toString('utf8');
        
        const lovecdnMatch = html.match(/lovecdn\.ru\/daddy\.php\?stream=([^"'&\s]+)/);
        const codepcMatch = html.match(/codepcplay\.fun\/premiumtv\/daddyhd\.php\?id=([^"'&\s]+)/);
        const blogMatch = html.match(/tv-bu1\.blogspot\.com\/p\/e1\.html\?id=([^"'&\s]+)/);
        
        if (lovecdnMatch) {
          lovecdnMap[ch] = lovecdnMatch[1];
        } else if (codepcMatch) {
          codepcplayMap[ch] = codepcMatch[1];
        } else if (blogMatch) {
          blogspotMap[ch] = blogMatch[1];
        } else {
          unknownChannels.push(ch);
        }
      } catch (e) {
        // timeout or error - skip
      }
    });
    await Promise.all(promises);
    
    if ((batch + 10) % 50 === 0) {
      console.log(`  Scanned ${batch + 10}/${allChannels.length}... (lovecdn: ${Object.keys(lovecdnMap).length}, codepcplay: ${Object.keys(codepcplayMap).length})`);
    }
  }
  
  console.log(`\n=== Results ===`);
  console.log(`lovecdn channels: ${Object.keys(lovecdnMap).length}`);
  console.log(`codepcplay channels: ${Object.keys(codepcplayMap).length}`);
  console.log(`blogspot channels: ${Object.keys(blogspotMap).length}`);
  console.log(`unknown channels: ${unknownChannels.length}`);
  
  // Output the lovecdn map as TypeScript
  console.log(`\n=== LOVECDN MAP (TypeScript) ===`);
  const sorted = Object.entries(lovecdnMap).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
  console.log(`const PLAYER6_STREAMS: Record<string, string> = {`);
  for (const [ch, stream] of sorted) {
    console.log(`  '${ch}': '${stream}',`);
  }
  console.log(`};`);
}

main().catch(console.error);
