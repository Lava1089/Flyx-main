// Test the full player 6 chain:
// 1. dlhd.link/player/stream-{ch}.php -> iframe src (lovecdn.ru)
// 2. lovecdn.ru -> iframe src (lovetier.bz)
// 3. lovetier.bz -> config.streamUrl (planetary.lovecdn.ru M3U8 with token)
// 4. Fetch the M3U8 and verify it works
const https = require('https');

function httpsReq(url, headers = {}, timeout = 15000, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname, path: u.pathname + u.search, method,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', ...headers },
      timeout, family: 4,
    };
    if (body) opts.headers['Content-Length'] = Buffer.byteLength(body);
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

async function extractPlayer6Stream(channelId) {
  const start = Date.now();
  
  // Step 1: Get player 6 page to find iframe src
  const playerUrl = `https://dlhd.link/player/stream-${channelId}.php`;
  const playerResp = await httpsReq(playerUrl, { 'Referer': 'https://dlhd.link/' });
  const playerHtml = playerResp.data.toString('utf8');
  
  // Check for lovecdn iframe
  const lovecdnMatch = playerHtml.match(/lovecdn\.ru\/daddy\.php\?stream=([^"'&\s]+)/);
  if (!lovecdnMatch) {
    // Check for other iframe types
    const codepcMatch = playerHtml.match(/codepcplay\.fun\/premiumtv\/daddyhd\.php\?id=([^"'&\s]+)/);
    const blogMatch = playerHtml.match(/tv-bu1\.blogspot\.com\/p\/e1\.html\?id=([^"'&\s]+)/);
    if (codepcMatch) return { type: 'codepcplay', id: codepcMatch[1] };
    if (blogMatch) return { type: 'blogspot', id: blogMatch[1] };
    return null;
  }
  
  const streamName = lovecdnMatch[1];
  
  // Step 2: Get lovetier.bz player page (skip lovecdn.ru middleman)
  const lovetierUrl = `https://lovetier.bz/player/${streamName}`;
  const lovetierResp = await httpsReq(lovetierUrl, { 'Referer': 'https://lovecdn.ru/' });
  const lovetierHtml = lovetierResp.data.toString('utf8');
  
  // Step 3: Extract config.streamUrl
  const streamUrlMatch = lovetierHtml.match(/streamUrl:\s*"([^"]+)"/);
  if (!streamUrlMatch) return null;
  
  const streamUrl = streamUrlMatch[1].replace(/\\\//g, '/');
  const elapsed = Date.now() - start;
  
  return { type: 'lovecdn', streamName, streamUrl, elapsed };
}

async function main() {
  console.log('=== Player 6 Full Chain Test ===');
  console.log('Time:', new Date().toISOString());
  
  // Test multiple channels
  const channels = [44, 35, 98, 39, 45, 31, 32, 60, 130, 405, 51, 321, 53, 54, 303, 338];
  
  for (const ch of channels) {
    console.log(`\n--- ch${ch} ---`);
    try {
      const result = await extractPlayer6Stream(ch);
      if (!result) {
        console.log(`  No stream found`);
        continue;
      }
      
      if (result.type !== 'lovecdn') {
        console.log(`  Type: ${result.type} (id: ${result.id})`);
        continue;
      }
      
      console.log(`  Stream: ${result.streamName}`);
      console.log(`  URL: ${result.streamUrl.substring(0, 120)}...`);
      console.log(`  Extract time: ${result.elapsed}ms`);
      
      // Step 4: Fetch the M3U8 to verify it works
      const m3u8Resp = await httpsReq(result.streamUrl, { 'Referer': 'https://lovetier.bz/' }, 8000);
      const m3u8Text = m3u8Resp.data.toString('utf8');
      const isM3u8 = m3u8Text.includes('#EXTM3U');
      const hasKey = m3u8Text.includes('EXT-X-KEY');
      console.log(`  M3U8: ${m3u8Resp.status}, ${m3u8Resp.data.length}b, valid=${isM3u8}, encrypted=${hasKey}`);
      
      if (isM3u8) {
        // Show first few lines
        const lines = m3u8Text.split('\n').slice(0, 8);
        for (const l of lines) console.log(`    ${l}`);
      }
    } catch (e) { console.log(`  ERROR: ${e.message}`); }
  }
}

main().catch(console.error);
