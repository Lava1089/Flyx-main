// Deep test: moveonjoy full chain - master -> media playlist -> segments
// Also test more channels to see which are alive
const https = require('https');

function httpsReq(url, headers = {}, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', ...headers },
      timeout, family: 4,
    }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
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
  console.log('=== Moveonjoy Deep Test ===');
  console.log('Time:', new Date().toISOString());
  
  // Test 1: Follow the full chain for ABC (ch51)
  console.log('\n[1] Full chain for ABC (ch51)');
  try {
    // Master playlist
    const master = await httpsReq('https://fl1.moveonjoy.com/AL_BIRMINGHAM_ABC/index.m3u8');
    console.log(`  Master: ${master.status}, ${master.data.length}b`);
    const masterText = master.data.toString('utf8');
    console.log(`  ${masterText.trim()}`);
    
    // Extract media playlist URL
    const lines = masterText.split('\n').filter(l => l.trim() && !l.startsWith('#'));
    if (lines.length > 0) {
      const mediaPath = lines[0].trim();
      const mediaUrl = `https://fl1.moveonjoy.com/AL_BIRMINGHAM_ABC/${mediaPath}`;
      console.log(`\n  Media playlist: ${mediaUrl}`);
      const media = await httpsReq(mediaUrl);
      console.log(`  Status: ${media.status}, ${media.data.length}b`);
      const mediaText = media.data.toString('utf8');
      const mediaLines = mediaText.split('\n').slice(0, 15);
      for (const l of mediaLines) console.log(`    ${l}`);
      
      // Check if encrypted
      const hasKey = mediaText.includes('EXT-X-KEY');
      console.log(`\n  Encrypted: ${hasKey}`);
      if (hasKey) {
        const keyLine = mediaText.split('\n').find(l => l.includes('EXT-X-KEY'));
        console.log(`  Key line: ${keyLine}`);
      }
    }
  } catch (e) { console.log(`  ERROR: ${e.message}`); }
  
  // Test 2: Batch test all moveonjoy channels
  console.log('\n[2] Batch test moveonjoy channels');
  const channels = {
    '11': { url: 'https://fl7.moveonjoy.com/UFC/index.m3u8', name: 'UFC' },
    '19': { url: 'https://fl31.moveonjoy.com/MLB_NETWORK/index.m3u8', name: 'MLB Network' },
    '39': { url: 'https://fl7.moveonjoy.com/FOX_Sports_1/index.m3u8', name: 'FOX Sports 1' },
    '44': { url: 'https://fl2.moveonjoy.com/ESPN/index.m3u8', name: 'ESPN' },
    '45': { url: 'https://fl2.moveonjoy.com/ESPN_2/index.m3u8', name: 'ESPN 2' },
    '51': { url: 'https://fl1.moveonjoy.com/AL_BIRMINGHAM_ABC/index.m3u8', name: 'ABC' },
    '52': { url: 'https://fl1.moveonjoy.com/FL_West_Palm_Beach_CBS/index.m3u8', name: 'CBS' },
    '53': { url: 'https://fl61.moveonjoy.com/FL_Tampa_NBC/index.m3u8', name: 'NBC' },
    '54': { url: 'https://fl61.moveonjoy.com/FL_Tampa_FOX/index.m3u8', name: 'FOX' },
    '98': { url: 'https://fl31.moveonjoy.com/NBA_TV/index.m3u8', name: 'NBA TV' },
    '146': { url: 'https://fl7.moveonjoy.com/WWE/index.m3u8', name: 'WWE' },
    '303': { url: 'https://fl61.moveonjoy.com/AMC_NETWORK/index.m3u8', name: 'AMC' },
    '321': { url: 'https://fl61.moveonjoy.com/HBO/index.m3u8', name: 'HBO' },
    '333': { url: 'https://fl31.moveonjoy.com/SHOWTIME/index.m3u8', name: 'Showtime' },
    '336': { url: 'https://fl7.moveonjoy.com/TBS/index.m3u8', name: 'TBS' },
    '338': { url: 'https://fl7.moveonjoy.com/TNT/index.m3u8', name: 'TNT' },
    '405': { url: 'https://fl31.moveonjoy.com/NFL_NETWORK/index.m3u8', name: 'NFL Network' },
  };
  
  let alive = 0, dead = 0;
  for (const [ch, info] of Object.entries(channels)) {
    try {
      const r = await httpsReq(info.url, {}, 5000);
      const text = r.data.toString('utf8');
      const isM3u8 = text.includes('#EXTM3U');
      if (isM3u8) alive++; else dead++;
      console.log(`  ch${ch.padStart(3)} ${info.name.padEnd(16)}: ${r.status} ${isM3u8 ? '✅' : '❌'}`);
    } catch (e) {
      dead++;
      console.log(`  ch${ch.padStart(3)} ${info.name.padEnd(16)}: ❌ ${e.message}`);
    }
  }
  console.log(`\n  Alive: ${alive}/${alive + dead}`);
  
  console.log('\n=== Done ===');
}

main().catch(console.error);
