// Final test: simulate the new /play flow with player6 -> moveonjoy -> dvalna fallback
const https = require('https');

function httpsReq(url, headers = {}, timeout = 12000) {
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

// Player 6 stream names (subset for testing)
const P6 = {
  '35': 'SkySportsFootballUK', '44': 'ESPN', '98': 'beINAR8',
  '31': 'TNT1UK', '60': 'SkySportsF1', '130': 'skysportspremierleague',
  '405': 'NFLNETWORK', '45': 'ESPN2', '39': 'FOXSPORTS1',
};

async function testPlayer6(ch) {
  const streamName = P6[ch];
  if (!streamName) return null;
  const start = Date.now();
  try {
    const resp = await httpsReq(`https://lovetier.bz/player/${streamName}`, { 'Referer': 'https://lovecdn.ru/' });
    const html = resp.data.toString('utf8');
    const match = html.match(/streamUrl:\s*"([^"]+)"/);
    if (!match) return null;
    const masterUrl = match[1].replace(/\\\//g, '/');
    
    // Fetch master
    const master = await httpsReq(masterUrl, { 'Referer': 'https://lovetier.bz/' });
    if (master.status !== 200) return null;
    const masterText = master.data.toString('utf8');
    if (!masterText.includes('#EXTM3U')) return null;
    
    // Fetch media
    const mediaPath = masterText.split('\n').find(l => l.trim() && !l.startsWith('#'))?.trim();
    const masterBase = masterUrl.substring(0, masterUrl.lastIndexOf('/') + 1);
    const mediaUrl = mediaPath.startsWith('http') ? mediaPath : masterBase + mediaPath;
    const media = await httpsReq(mediaUrl, { 'Referer': 'https://lovetier.bz/' });
    if (media.status !== 200) return null;
    
    return { backend: 'player6', time: Date.now() - start, size: media.data.length };
  } catch { return null; }
}

async function main() {
  console.log('=== New /play Flow Simulation ===');
  console.log('Time:', new Date().toISOString());
  
  const channels = ['35', '44', '98', '31', '60', '130', '405', '45', '39', '51', '321', '53'];
  
  let p6ok = 0, p6fail = 0;
  for (const ch of channels) {
    const start = Date.now();
    process.stdout.write(`ch${ch.padStart(3)}: `);
    
    // Try player 6
    if (P6[ch]) {
      const result = await testPlayer6(ch);
      if (result) {
        console.log(`✅ player6 (${result.time}ms, ${result.size}b)`);
        p6ok++;
        continue;
      }
      p6fail++;
      console.log(`❌ player6 failed, no other backend for this test`);
    } else {
      console.log(`⏭️  no player6 mapping (would use moveonjoy/dvalna)`);
    }
  }
  
  console.log(`\n=== Player 6: ${p6ok} ok, ${p6fail} fail out of ${Object.keys(P6).length} tested ===`);
}

main().catch(console.error);
