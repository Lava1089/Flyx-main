/**
 * Quick DLHD diagnostic test
 */

const testChannels = ['35', '44', '51'];

async function testChannel(id) {
  console.log(`\n=== Testing Channel ${id} ===`);
  
  // Test 1: hitsplay.fun JWT fetch
  const hitsplayUrl = `https://hitsplay.fun/premiumtv/daddyhd.php?id=${id}`;
  console.log('1. Testing hitsplay.fun...');
  
  try {
    const res = await fetch(hitsplayUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://dlhd.link/'
      }
    });
    const html = await res.text();
    const jwtMatch = html.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    
    if (jwtMatch) {
      const jwt = jwtMatch[0];
      const payload = JSON.parse(Buffer.from(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
      console.log('   JWT found! Channel key:', payload.sub, 'Expires:', new Date(payload.exp * 1000).toISOString());
      
      // Test 2: Server lookup
      const lookupUrl = `https://chevy.dvalna.ru/server_lookup?channel_id=${payload.sub}`;
      console.log('2. Testing server lookup for', payload.sub);
      
      try {
        const lookupRes = await fetch(lookupUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://hitsplay.fun/' }
        });
        const lookupText = await lookupRes.text();
        console.log('   Server lookup response:', lookupText.substring(0, 200));
        
        // Parse server key
        const serverMatch = lookupText.match(/"server_key"\s*:\s*"([^"]+)"/);
        if (serverMatch) {
          const serverKey = serverMatch[1];
          console.log('   Server key:', serverKey);
          
          // Test 3: M3U8 fetch
          const m3u8Url = `https://${serverKey}new.dvalna.ru/${serverKey}/${payload.sub}/mono.css`;
          console.log('3. Testing M3U8 fetch:', m3u8Url);
          
          try {
            const m3u8Res = await fetch(m3u8Url, {
              headers: {
                'User-Agent': 'Mozilla/5.0',
                'Origin': 'https://epaly.fun',
                'Referer': 'https://epaly.fun/'
              }
            });
            const m3u8Text = await m3u8Res.text();
            if (m3u8Text.includes('#EXTM3U')) {
              console.log('   M3U8 SUCCESS! Length:', m3u8Text.length);
              console.log('   Preview:', m3u8Text.substring(0, 300));
            } else {
              console.log('   M3U8 FAILED - not valid M3U8');
              console.log('   Response:', m3u8Text.substring(0, 300));
            }
          } catch (e) {
            console.log('   M3U8 fetch failed:', e.message);
          }
        }
      } catch (e) {
        console.log('   Server lookup failed:', e.message);
      }
    } else {
      console.log('   NO JWT found in hitsplay response');
      console.log('   Response preview:', html.substring(0, 500));
    }
  } catch (e) {
    console.log('   hitsplay.fun failed:', e.message);
  }
}

async function main() {
  console.log('DLHD Quick Diagnostic Test');
  console.log('==========================');
  
  for (const id of testChannels) {
    await testChannel(id);
  }
}

main().catch(console.error);
