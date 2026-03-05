// Test moveonjoy.com and cdn-live-tv domains - are they alive?
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
  console.log('=== Testing moveonjoy.com and cdn-live-tv backends ===');
  console.log('Time:', new Date().toISOString());
  
  // Test 1: moveonjoy - direct M3U8, no auth
  console.log('\n[1] MOVEONJOY.COM - Direct M3U8 (no auth, no encryption)');
  const moveonjoyTests = [
    { ch: '51', url: 'https://fl1.moveonjoy.com/AL_BIRMINGHAM_ABC/index.m3u8', name: 'ABC' },
    { ch: '44', url: 'https://fl2.moveonjoy.com/ESPN/index.m3u8', name: 'ESPN' },
    { ch: '321', url: 'https://fl61.moveonjoy.com/HBO/index.m3u8', name: 'HBO' },
    { ch: '338', url: 'https://fl7.moveonjoy.com/TNT/index.m3u8', name: 'TNT' },
  ];
  
  for (const test of moveonjoyTests) {
    try {
      const r = await httpsReq(test.url);
      const text = r.data.toString('utf8');
      const isM3u8 = text.includes('#EXTM3U') || text.includes('#EXT-X-');
      const hasKey = text.includes('EXT-X-KEY');
      console.log(`  ch${test.ch} ${test.name}: ${r.status}, ${r.data.length}b, ${isM3u8 ? 'VALID M3U8' : 'NOT M3U8'}, encrypted=${hasKey}`);
      if (isM3u8) {
        // Show first few lines
        const lines = text.split('\n').slice(0, 8);
        for (const l of lines) console.log(`    ${l}`);
      }
    } catch (e) { console.log(`  ch${test.ch} ${test.name}: ERROR ${e.message}`); }
  }
  
  // Test 2: cdn-live-tv - need to figure out the URL pattern
  // From the cracker script, it goes through ddyplayer.cfd to get a token
  console.log('\n[2] CDN-LIVE-TV - Testing direct access');
  const cdnLiveTests = [
    'https://edge.cdn-live-tv.ru/api/v1/channels/us-espn/tracks-v1a1/mono.m3u8',
    'https://edge.cdn-live-tv.cfd/api/v1/channels/us-espn/tracks-v1a1/mono.m3u8',
    'https://edge.cdn-live.ru/api/v1/channels/us-espn/tracks-v1a1/mono.m3u8',
  ];
  
  for (const url of cdnLiveTests) {
    try {
      const r = await httpsReq(url, { 'Referer': 'https://ddyplayer.cfd/' });
      const text = r.data.toString('utf8').substring(0, 200);
      console.log(`  ${new URL(url).hostname}: ${r.status}, ${r.data.length}b, ${text.substring(0, 100)}`);
    } catch (e) { console.log(`  ${new URL(url).hostname}: ERROR ${e.message}`); }
  }
  
  // Test 3: cdn-live-tv via RPI proxy
  console.log('\n[3] CDN-LIVE-TV via RPI proxy');
  const rpiKey = '5f1845926d725bb2a8230a6ed231fce1d03f07782f74a3f683c30ec04d4ac560';
  for (const cdnUrl of cdnLiveTests.slice(0, 1)) {
    try {
      const headers = JSON.stringify({ 'Referer': 'https://ddyplayer.cfd/', 'Origin': 'https://ddyplayer.cfd' });
      const rpiUrl = `https://rpi-proxy.vynx.cc/fetch?url=${encodeURIComponent(cdnUrl)}&headers=${encodeURIComponent(headers)}&key=${rpiKey}`;
      const r = await httpsReq(rpiUrl, { 'X-API-Key': rpiKey });
      const text = r.data.toString('utf8').substring(0, 200);
      console.log(`  RPI->cdn-live-tv.ru: ${r.status}, ${r.data.length}b, ${text.substring(0, 100)}`);
    } catch (e) { console.log(`  RPI->cdn-live-tv.ru: ERROR ${e.message}`); }
  }
  
  // Test 4: moveonjoy via RPI proxy (shouldn't need it, but let's verify)
  console.log('\n[4] MOVEONJOY via RPI proxy (verification)');
  try {
    const movUrl = 'https://fl2.moveonjoy.com/ESPN/index.m3u8';
    const headers = JSON.stringify({});
    const rpiUrl = `https://rpi-proxy.vynx.cc/fetch?url=${encodeURIComponent(movUrl)}&headers=${encodeURIComponent(headers)}&key=${rpiKey}`;
    const r = await httpsReq(rpiUrl, { 'X-API-Key': rpiKey });
    const text = r.data.toString('utf8');
    const isM3u8 = text.includes('#EXTM3U');
    console.log(`  RPI->moveonjoy ESPN: ${r.status}, ${r.data.length}b, ${isM3u8 ? 'VALID M3U8' : text.substring(0, 100)}`);
  } catch (e) { console.log(`  ERROR: ${e.message}`); }
  
  console.log('\n=== Done ===');
}

main().catch(console.error);
