// Final integration test: simulate /play endpoint flow
// 1. Try moveonjoy first (if available)
// 2. Fall back to dvalna.ru (will fail due to rate limit)
// 3. Fall back to moveonjoy again (if dvalna fails)
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

const MOVEONJOY = {
  '51': 'https://fl1.moveonjoy.com/AL_BIRMINGHAM_ABC/index.m3u8',
  '44': 'https://fl2.moveonjoy.com/ESPN/index.m3u8',
  '321': 'https://fl61.moveonjoy.com/HBO/index.m3u8',
  '98': 'https://fl31.moveonjoy.com/NBA_TV/index.m3u8',
};

async function simulatePlay(channelId) {
  const start = Date.now();
  console.log(`\n=== /play/${channelId} simulation ===`);
  
  // Step 1: Try moveonjoy first
  const movUrl = MOVEONJOY[channelId];
  if (movUrl) {
    console.log(`  [1] Trying moveonjoy...`);
    try {
      const master = await httpsReq(movUrl, {}, 5000);
      if (master.status === 200) {
        const text = master.data.toString('utf8');
        if (text.includes('#EXTM3U')) {
          // Get media playlist
          const mediaPath = text.split('\n').find(l => l.trim() && !l.startsWith('#'))?.trim();
          const baseUrl = movUrl.substring(0, movUrl.lastIndexOf('/') + 1);
          const mediaUrl = baseUrl + mediaPath;
          const media = await httpsReq(mediaUrl, {}, 5000);
          if (media.status === 200 && media.data.toString('utf8').includes('#EXTM3U')) {
            console.log(`  ✅ MOVEONJOY SUCCESS in ${Date.now() - start}ms`);
            console.log(`  Would serve: ${media.data.length}b media playlist (unencrypted)`);
            return 'moveonjoy';
          }
        }
      }
      console.log(`  Moveonjoy failed (${master.status}), trying dvalna.ru...`);
    } catch (e) {
      console.log(`  Moveonjoy error: ${e.message}, trying dvalna.ru...`);
    }
  } else {
    console.log(`  [1] No moveonjoy mapping for ch${channelId}`);
  }
  
  // Step 2: Try dvalna.ru (will likely fail due to rate limit)
  console.log(`  [2] Trying dvalna.ru...`);
  try {
    const authResult = await httpsReq('https://codepcplay.fun/premiumtv/daddyhd.php?id=' + channelId, { 'Referer': 'https://dlhd.link/' }, 5000);
    const html = authResult.data.toString('utf8');
    const initMatch = html.match(/EPlayerAuth\.init\s*\(\s*\{([^}]+)\}\s*\)/);
    if (initMatch) {
      const authToken = initMatch[1].match(/authToken\s*:\s*["']([^"']+)["']/)[1];
      const m3u8Url = `https://zekonew.dvalna.ru/zeko/premium${channelId}/mono.css`;
      const m3u8 = await httpsReq(m3u8Url, {
        'Referer': 'https://hitsplay.fun/', 'Origin': 'https://hitsplay.fun',
        'Authorization': `Bearer ${authToken}`,
      }, 5000);
      if (m3u8.status === 200 && m3u8.data.toString('utf8').includes('#EXTM3U')) {
        console.log(`  ✅ DVALNA.RU SUCCESS in ${Date.now() - start}ms (but keys may be rate-limited)`);
        return 'dvalna';
      }
      console.log(`  dvalna.ru M3U8: ${m3u8.status}`);
    }
  } catch (e) {
    console.log(`  dvalna.ru error: ${e.message}`);
  }
  
  console.log(`  ❌ ALL BACKENDS FAILED in ${Date.now() - start}ms`);
  return null;
}

async function main() {
  console.log('=== /play Endpoint Simulation ===');
  console.log('Time:', new Date().toISOString());
  
  // Test channels with moveonjoy
  for (const ch of ['51', '321', '98']) {
    await simulatePlay(ch);
  }
  
  // Test channel WITHOUT moveonjoy (dvalna-only)
  await simulatePlay('35'); // Sky Sports Football - no moveonjoy
  
  console.log('\n=== Done ===');
}

main().catch(console.error);
