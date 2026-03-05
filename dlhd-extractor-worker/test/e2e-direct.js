/**
 * E2E Test - Direct CDN Access (No Browser Needed!)
 * 
 * Tests the direct CDN backends that DON'T require scraping dlhd.link:
 * 1. moveonjoy.com - Direct M3U8, no auth
 * 2. cdn-live.tv - Simple token auth
 * 3. dvalna.ru - JWT + PoW (requires more setup)
 */

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Direct M3U8 URLs from moveonjoy.com - NO AUTH NEEDED!
const MOVEONJOY_CHANNELS = {
  '44': { url: 'https://fl2.moveonjoy.com/ESPN/index.m3u8', name: 'ESPN' },
  '45': { url: 'https://fl2.moveonjoy.com/ESPN_2/index.m3u8', name: 'ESPN 2' },
  '51': { url: 'https://fl1.moveonjoy.com/AL_BIRMINGHAM_ABC/index.m3u8', name: 'ABC' },
  '52': { url: 'https://fl1.moveonjoy.com/FL_West_Palm_Beach_CBS/index.m3u8', name: 'CBS' },
  '53': { url: 'https://fl61.moveonjoy.com/FL_Tampa_NBC/index.m3u8', name: 'NBC' },
  '54': { url: 'https://fl61.moveonjoy.com/FL_Tampa_FOX/index.m3u8', name: 'FOX' },
  '98': { url: 'https://fl31.moveonjoy.com/NBA_TV/index.m3u8', name: 'NBA TV' },
  '146': { url: 'https://fl7.moveonjoy.com/WWE/index.m3u8', name: 'WWE Network' },
  '321': { url: 'https://fl61.moveonjoy.com/HBO/index.m3u8', name: 'HBO' },
};

async function testMoveonjoy() {
  console.log('=== Testing moveonjoy.com (Direct M3U8 - No Auth) ===\n');
  
  for (const [channelId, channel] of Object.entries(MOVEONJOY_CHANNELS)) {
    const start = Date.now();
    try {
      const res = await fetch(channel.url, {
        headers: { 'User-Agent': USER_AGENT },
      });
      
      const elapsed = Date.now() - start;
      
      if (res.ok) {
        const text = await res.text();
        if (text.includes('#EXTM3U')) {
          console.log(`✅ [${channelId}] ${channel.name}: ${elapsed}ms`);
          console.log(`   URL: ${channel.url}`);
          console.log(`   First line: ${text.split('\n')[0]}`);
        } else {
          console.log(`❌ [${channelId}] ${channel.name}: Invalid M3U8 (${elapsed}ms)`);
        }
      } else {
        console.log(`❌ [${channelId}] ${channel.name}: HTTP ${res.status} (${elapsed}ms)`);
      }
    } catch (e) {
      console.log(`❌ [${channelId}] ${channel.name}: ${e.message}`);
    }
    console.log('');
  }
}

async function testCdnLive() {
  console.log('\n=== Testing cdn-live.tv (Token Auth) ===\n');
  
  // First, fetch the player page to get the token
  const channelName = 'sky sports main event';
  const countryCode = 'gb';
  
  try {
    // Step 1: Get the player page from ddyplayer.cfd
    const playerUrl = `https://ddyplayer.cfd/embed/${encodeURIComponent(channelName)}/${countryCode}`;
    console.log(`Fetching player page: ${playerUrl}`);
    
    const playerRes = await fetch(playerUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://dlhd.link/',
      },
    });
    
    if (!playerRes.ok) {
      console.log(`❌ Player page failed: HTTP ${playerRes.status}`);
      return;
    }
    
    const playerHtml = await playerRes.text();
    
    // Extract the M3U8 URL from the player page
    const m3u8Match = playerHtml.match(/source:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/);
    if (m3u8Match) {
      console.log(`✅ Found M3U8 URL: ${m3u8Match[1]}`);
      
      // Try to fetch the M3U8
      const m3u8Res = await fetch(m3u8Match[1], {
        headers: {
          'User-Agent': USER_AGENT,
          'Referer': playerUrl,
        },
      });
      
      if (m3u8Res.ok) {
        const m3u8Text = await m3u8Res.text();
        console.log(`✅ M3U8 fetched successfully (${m3u8Text.length} bytes)`);
        console.log(`   First 200 chars: ${m3u8Text.substring(0, 200)}`);
      } else {
        console.log(`❌ M3U8 fetch failed: HTTP ${m3u8Res.status}`);
      }
    } else {
      console.log('❌ No M3U8 URL found in player page');
      // Try to find any URLs
      const urls = playerHtml.match(/https?:\/\/[^\s"'<>]+/g) || [];
      console.log(`   Found ${urls.length} URLs in page`);
      urls.slice(0, 5).forEach(u => console.log(`   - ${u}`));
    }
  } catch (e) {
    console.log(`❌ Error: ${e.message}`);
  }
}

async function main() {
  console.log('DLHD Direct CDN Access Test\n');
  console.log('This test bypasses dlhd.link entirely and accesses CDN backends directly.\n');
  console.log('='.repeat(60) + '\n');
  
  await testMoveonjoy();
  await testCdnLive();
  
  console.log('\n' + '='.repeat(60));
  console.log('\nSUMMARY:');
  console.log('- moveonjoy.com: Direct M3U8 URLs, no auth needed');
  console.log('- cdn-live.tv: Requires token from ddyplayer.cfd');
  console.log('- dvalna.ru: Requires JWT + PoW (most complex)');
  console.log('\nThe worker should use these backends directly instead of scraping dlhd.link!');
}

main().catch(console.error);
