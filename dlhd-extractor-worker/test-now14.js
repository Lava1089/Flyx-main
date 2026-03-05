// Test: simulate what /play endpoint does with moveonjoy fallback
// Fetches master -> media playlist, makes URLs absolute, serves to player
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

async function testMoveonjoyPlaylist(channelId, masterUrl, name) {
  const start = Date.now();
  console.log(`\n--- ch${channelId} ${name} ---`);
  
  // Step 1: Fetch master
  try {
    const master = await httpsReq(masterUrl);
    if (master.status !== 200) { console.log(`  Master: ${master.status} FAIL`); return false; }
    const masterText = master.data.toString('utf8');
    if (!masterText.includes('#EXTM3U')) { console.log(`  Master: not M3U8`); return false; }
    
    // Step 2: Extract media playlist path
    const mediaPath = masterText.split('\n').find(l => l.trim() && !l.startsWith('#'))?.trim();
    if (!mediaPath) { console.log(`  No media path in master`); return false; }
    
    const baseUrl = masterUrl.substring(0, masterUrl.lastIndexOf('/') + 1);
    const mediaUrl = mediaPath.startsWith('http') ? mediaPath : baseUrl + mediaPath;
    
    // Step 3: Fetch media playlist
    const media = await httpsReq(mediaUrl);
    if (media.status !== 200) { console.log(`  Media: ${media.status} FAIL`); return false; }
    const mediaText = media.data.toString('utf8');
    if (!mediaText.includes('#EXTM3U')) { console.log(`  Media: not M3U8`); return false; }
    
    // Step 4: Make segment URLs absolute
    const mediaBase = mediaUrl.substring(0, mediaUrl.lastIndexOf('/') + 1);
    const lines = mediaText.split('\n');
    const absoluteLines = lines.map(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('http')) {
        return mediaBase + trimmed;
      }
      return line;
    });
    
    const finalPlaylist = absoluteLines.join('\n');
    const elapsed = Date.now() - start;
    
    // Step 5: Verify a segment is fetchable
    const segUrl = absoluteLines.find(l => l.trim().endsWith('.ts'));
    if (segUrl) {
      const seg = await httpsReq(segUrl.trim(), {}, 5000);
      console.log(`  ✅ ${elapsed}ms, ${finalPlaylist.length}b playlist, segment: ${seg.status} ${seg.data.length}b`);
      return seg.status === 200;
    }
    
    console.log(`  ✅ ${elapsed}ms, ${finalPlaylist.length}b playlist (no segment to verify)`);
    return true;
  } catch (e) {
    console.log(`  ❌ ERROR: ${e.message}`);
    return false;
  }
}

async function main() {
  console.log('=== Moveonjoy Full Chain Test ===');
  console.log('Time:', new Date().toISOString());
  
  const tests = [
    ['51', 'https://fl1.moveonjoy.com/AL_BIRMINGHAM_ABC/index.m3u8', 'ABC'],
    ['52', 'https://fl1.moveonjoy.com/FL_West_Palm_Beach_CBS/index.m3u8', 'CBS'],
    ['53', 'https://fl61.moveonjoy.com/FL_Tampa_NBC/index.m3u8', 'NBC'],
    ['321', 'https://fl61.moveonjoy.com/HBO/index.m3u8', 'HBO'],
    ['98', 'https://fl31.moveonjoy.com/NBA_TV/index.m3u8', 'NBA TV'],
    ['303', 'https://fl61.moveonjoy.com/AMC_NETWORK/index.m3u8', 'AMC'],
    ['45', 'https://fl2.moveonjoy.com/ESPN_2/index.m3u8', 'ESPN 2'],
    ['39', 'https://fl7.moveonjoy.com/FOX_Sports_1/index.m3u8', 'FOX Sports 1'],
  ];
  
  let pass = 0, fail = 0;
  for (const [ch, url, name] of tests) {
    const ok = await testMoveonjoyPlaylist(ch, url, name);
    if (ok) pass++; else fail++;
  }
  
  console.log(`\n=== Results: ${pass} pass, ${fail} fail ===`);
}

main().catch(console.error);
