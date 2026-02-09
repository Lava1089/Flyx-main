/**
 * Test DLHD key fetch with PoW
 */
const crypto = require('crypto');

const WASM_SECRET = '444c44cc8888888844444444';
const POW_THRESHOLD = 0x0100;

function computePoWNonce(resource, keyNumber, timestamp) {
  for (let nonce = 0; nonce < 1000000; nonce++) {
    const data = `${WASM_SECRET}${resource}${keyNumber}${timestamp}${nonce}`;
    const hash = crypto.createHash('sha256').update(data).digest();
    const prefix = (hash[0] << 8) | hash[1];
    if (prefix < POW_THRESHOLD) {
      return nonce;
    }
  }
  return 0;
}

async function testKeyFetch() {
  console.log('DLHD Key Fetch Test');
  console.log('===================\n');
  
  // Step 1: Get JWT
  const channelId = '35';
  console.log(`1. Fetching JWT for channel ${channelId}...`);
  
  const hitsplayRes = await fetch(`https://hitsplay.fun/premiumtv/daddyhd.php?id=${channelId}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://dlhd.link/'
    }
  });
  const html = await hitsplayRes.text();
  const jwtMatch = html.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  
  if (!jwtMatch) {
    console.log('   FAILED: No JWT found');
    return;
  }
  
  const jwt = jwtMatch[0];
  const payload = JSON.parse(Buffer.from(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  console.log('   JWT found:', payload.sub);
  
  // Step 2: Get M3U8 to find key URL
  console.log('\n2. Fetching M3U8...');
  const m3u8Url = 'https://zekonew.dvalna.ru/zeko/premium35/mono.css';
  const m3u8Res = await fetch(m3u8Url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Origin': 'https://epaly.fun',
      'Referer': 'https://epaly.fun/'
    }
  });
  const m3u8 = await m3u8Res.text();
  
  const keyMatch = m3u8.match(/URI="([^"]+)"/);
  if (!keyMatch) {
    console.log('   FAILED: No key URL in M3U8');
    return;
  }
  
  const keyUrl = keyMatch[1];
  console.log('   Key URL:', keyUrl);
  
  // Extract key params
  const keyParams = keyUrl.match(/\/key\/([^/]+)\/(\d+)/);
  if (!keyParams) {
    console.log('   FAILED: Could not parse key URL');
    return;
  }
  
  const resource = keyParams[1];
  const keyNumber = keyParams[2];
  console.log('   Resource:', resource, 'Key Number:', keyNumber);
  
  // Step 3: Compute PoW
  console.log('\n3. Computing PoW nonce...');
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = computePoWNonce(resource, keyNumber, timestamp);
  console.log('   Timestamp:', timestamp);
  console.log('   Nonce:', nonce);
  
  // Verify nonce
  const verifyData = `${WASM_SECRET}${resource}${keyNumber}${timestamp}${nonce}`;
  const verifyHash = crypto.createHash('sha256').update(verifyData).digest();
  const verifyPrefix = (verifyHash[0] << 8) | verifyHash[1];
  console.log('   Verify prefix:', verifyPrefix.toString(16), '< 0x100?', verifyPrefix < 0x100);
  
  // Step 4: Fetch key
  console.log('\n4. Fetching key...');
  const normalizedKeyUrl = `https://chevy.dvalna.ru/key/${resource}/${keyNumber}`;
  
  try {
    const keyRes = await fetch(normalizedKeyUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': 'https://epaly.fun',
        'Referer': 'https://epaly.fun/',
        'Authorization': `Bearer ${jwt}`,
        'X-Key-Timestamp': timestamp.toString(),
        'X-Key-Nonce': nonce.toString()
      }
    });
    
    console.log('   Status:', keyRes.status);
    console.log('   Headers:', Object.fromEntries(keyRes.headers.entries()));
    
    const keyData = await keyRes.arrayBuffer();
    console.log('   Response size:', keyData.byteLength);
    
    if (keyData.byteLength === 16) {
      console.log('   KEY SUCCESS:', Buffer.from(keyData).toString('hex'));
    } else {
      const text = new TextDecoder().decode(keyData);
      console.log('   Response:', text.substring(0, 200));
    }
  } catch (e) {
    console.log('   FAILED:', e.message);
  }
}

testKeyFetch().catch(console.error);
