/**
 * Test if key fetch works with minimal headers (no X-Key-Path, X-Fingerprint)
 */

const https = require('https');
const crypto = require('crypto');

const CHANNEL = 51;
const HMAC_SECRET = 'd6398a30dd88f3defad36e0a10226679a045f47df9428e9cb4d98e9a6bd364b4';

function computeNonce(resource, number, ts) {
  const base = crypto.createHmac('sha256', HMAC_SECRET).update(resource).digest('hex');
  let nonce = 0;
  const target = 0x1000;
  
  while (nonce < 100000) {
    const data = base + resource + number + ts + nonce;
    const hash = crypto.createHash('md5').update(data).digest('hex');
    if (parseInt(hash.substring(0, 4), 16) < target) break;
    nonce++;
  }
  
  return nonce;
}

function fetch(url, options = {}, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...options.headers
      }
    };
    
    const req = https.request(reqOptions, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) && res.headers.location && maxRedirects > 0) {
        const redirectUrl = res.headers.location.startsWith('http') 
          ? res.headers.location 
          : `https://${urlObj.hostname}${res.headers.location}`;
        return fetch(redirectUrl, options, maxRedirects - 1).then(resolve).catch(reject);
      }
      
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: Buffer.concat(chunks)
        });
      });
    });
    
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  console.log('='.repeat(70));
  console.log('MINIMAL KEY FETCH TEST');
  console.log('='.repeat(70));
  
  // Step 1: Fetch the player page to get the JWT
  console.log('\n--- Step 1: Fetch player page for JWT ---');
  const pageUrl = `https://hitsplay.fun/premiumtv/daddyhd.php?id=${CHANNEL}`;
  
  const pageRes = await fetch(pageUrl, {
    headers: {
      'Referer': 'https://dlhd.link/',
    }
  });
  
  const pageHtml = pageRes.data.toString();
  const jwtMatch = pageHtml.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  if (!jwtMatch) {
    console.error('❌ Could not find JWT in page');
    return;
  }
  
  const jwt = jwtMatch[0];
  console.log(`JWT: ${jwt.substring(0, 50)}...`);
  
  const payload = JSON.parse(Buffer.from(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  const channelKey = payload.sub;
  console.log(`Channel key: ${channelKey}`);
  
  // Step 2: Server lookup
  console.log('\n--- Step 2: Server lookup ---');
  const lookupRes = await fetch(`https://chevy.dvalna.ru/server_lookup?channel_id=${encodeURIComponent(channelKey)}`, {
    headers: { 'Referer': 'https://hitsplay.fun/' }
  });
  const lookupData = JSON.parse(lookupRes.data.toString());
  console.log(`Server key: ${lookupData.server_key}`);
  
  // Step 3: Fetch M3U8
  console.log('\n--- Step 3: Fetch M3U8 ---');
  const sk = lookupData.server_key;
  const m3u8Url = (sk === 'top1/cdn')
    ? `https://top1.dvalna.ru/top1/cdn/${channelKey}/mono.css`
    : `https://${sk}new.dvalna.ru/${sk}/${channelKey}/mono.css`;
  
  const m3u8Res = await fetch(m3u8Url, {
    headers: { 'Referer': 'https://hitsplay.fun/', 'Authorization': `Bearer ${jwt}` }
  });
  const m3u8Content = m3u8Res.data.toString();
  
  const keyMatch = m3u8Content.match(/#EXT-X-KEY:METHOD=AES-128,URI="([^"]+)"/);
  if (!keyMatch) {
    console.error('❌ Could not find key URL in M3U8');
    return;
  }
  
  const keyUrl = keyMatch[1];
  console.log(`Key URL: ${keyUrl}`);
  
  const keyIdMatch = keyUrl.match(/\/key\/([^/]+)\/(\d+)/);
  const resource = keyIdMatch[1];
  const number = keyIdMatch[2];
  
  // Step 4: Test key fetch with MINIMAL headers (no X-Key-Path, X-Fingerprint)
  console.log('\n--- Step 4: Test MINIMAL headers ---');
  const ts = Math.floor(Date.now() / 1000);
  const nonce = computeNonce(resource, number, ts);
  
  console.log(`Timestamp: ${ts}`);
  console.log(`Nonce: ${nonce}`);
  
  const minimalKeyRes = await fetch(keyUrl, {
    headers: {
      'Referer': 'https://hitsplay.fun/',
      'Origin': 'https://hitsplay.fun',
      'Authorization': `Bearer ${jwt}`,
      'X-Key-Timestamp': ts.toString(),
      'X-Key-Nonce': nonce.toString(),
      // NO X-Key-Path
      // NO X-Fingerprint
    }
  });
  
  console.log(`\nMinimal headers response:`);
  console.log(`  Status: ${minimalKeyRes.status}`);
  console.log(`  Length: ${minimalKeyRes.data.length}`);
  
  if (minimalKeyRes.data.length === 16) {
    console.log(`  ✅ Key (hex): ${minimalKeyRes.data.toString('hex')}`);
  } else {
    console.log(`  Response: ${minimalKeyRes.data.toString().substring(0, 200)}`);
  }
  
  // Step 5: Test with dlhd.link as origin (like current RPI does)
  console.log('\n--- Step 5: Test with dlhd.link origin ---');
  const ts2 = Math.floor(Date.now() / 1000);
  const nonce2 = computeNonce(resource, number, ts2);
  
  const dlhdKeyRes = await fetch(keyUrl, {
    headers: {
      'Referer': 'https://dlhd.link/',
      'Origin': 'https://dlhd.link',
      'Authorization': `Bearer ${jwt}`,
      'X-Key-Timestamp': ts2.toString(),
      'X-Key-Nonce': nonce2.toString(),
    }
  });
  
  console.log(`\ndlhd.link origin response:`);
  console.log(`  Status: ${dlhdKeyRes.status}`);
  console.log(`  Length: ${dlhdKeyRes.data.length}`);
  
  if (dlhdKeyRes.data.length === 16) {
    console.log(`  ✅ Key (hex): ${dlhdKeyRes.data.toString('hex')}`);
  } else {
    console.log(`  Response: ${dlhdKeyRes.data.toString().substring(0, 200)}`);
  }
  // Step 6: Test with ALL headers (including X-Key-Path, X-Fingerprint)
  console.log('\n--- Step 6: Test with ALL headers ---');
  const ts3 = Math.floor(Date.now() / 1000);
  const nonce3 = computeNonce(resource, number, ts3);
  
  // Generate fingerprint
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const scr = '1920x1080';
  const tz = 'America/New_York';
  const lg = 'en-US';
  const fingerprint = crypto.createHash('sha256').update(ua + scr + tz + lg).digest('hex').substring(0, 16);
  
  // Compute key path
  const keyPathData = resource + '|' + number + '|' + ts3 + '|' + fingerprint;
  const keyPath = crypto.createHmac('sha256', HMAC_SECRET).update(keyPathData).digest('hex').substring(0, 16);
  
  console.log(`Timestamp: ${ts3}`);
  console.log(`Nonce: ${nonce3}`);
  console.log(`Fingerprint: ${fingerprint}`);
  console.log(`Key Path: ${keyPath}`);
  
  const fullKeyRes = await fetch(keyUrl, {
    headers: {
      'Referer': 'https://hitsplay.fun/',
      'Origin': 'https://hitsplay.fun',
      'Authorization': `Bearer ${jwt}`,
      'X-Key-Timestamp': ts3.toString(),
      'X-Key-Nonce': nonce3.toString(),
      'X-Key-Path': keyPath,
      'X-Fingerprint': fingerprint,
    }
  });
  
  console.log(`\nFull headers response:`);
  console.log(`  Status: ${fullKeyRes.status}`);
  console.log(`  Length: ${fullKeyRes.data.length}`);
  
  if (fullKeyRes.data.length === 16) {
    console.log(`  ✅ Key (hex): ${fullKeyRes.data.toString('hex')}`);
    
    // Compare keys
    console.log('\n--- Key Comparison ---');
    console.log(`Minimal headers key: ${minimalKeyRes.data.toString('hex')}`);
    console.log(`Full headers key:    ${fullKeyRes.data.toString('hex')}`);
    console.log(`Keys match: ${minimalKeyRes.data.toString('hex') === fullKeyRes.data.toString('hex')}`);
  } else {
    console.log(`  Response: ${fullKeyRes.data.toString().substring(0, 200)}`);
  }
}

main().catch(console.error);
