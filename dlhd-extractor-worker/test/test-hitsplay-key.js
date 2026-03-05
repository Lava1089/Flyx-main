/**
 * Test fetching the actual decryption key from hitsplay.fun/dvalna.ru
 * Using the correct headers discovered from deobfuscation
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

function computeKeyPath(resource, number, ts, fingerprint) {
  const data = resource + '|' + number + '|' + ts + '|' + fingerprint;
  return crypto.createHmac('sha256', HMAC_SECRET).update(data).digest('hex').substring(0, 16);
}

function generateFingerprint() {
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const scr = '1920x1080';
  const tz = 'America/New_York';
  const lg = 'en-US';
  return crypto.createHash('sha256').update(ua + scr + tz + lg).digest('hex').substring(0, 16);
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
      // Handle redirects
      if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) && res.headers.location && maxRedirects > 0) {
        const redirectUrl = res.headers.location.startsWith('http') 
          ? res.headers.location 
          : `https://${urlObj.hostname}${res.headers.location}`;
        console.log(`  Following redirect to: ${redirectUrl.substring(0, 80)}...`);
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
  console.log('HITSPLAY KEY FETCH TEST');
  console.log('='.repeat(70));
  
  // Step 1: Fetch the player page to get the JWT
  console.log('\n--- Step 1: Fetch player page for JWT ---');
  const pageUrl = `https://hitsplay.fun/premiumtv/daddyhd.php?id=${CHANNEL}`;
  
  const pageRes = await fetch(pageUrl, {
    headers: {
      'Referer': 'https://dlhd.link/',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    }
  });
  
  console.log(`Page status: ${pageRes.status}`);
  const pageHtml = pageRes.data.toString();
  
  // Extract JWT
  const jwtMatch = pageHtml.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  if (!jwtMatch) {
    console.error('❌ Could not find JWT in page');
    return;
  }
  
  const jwt = jwtMatch[0];
  console.log(`JWT: ${jwt.substring(0, 50)}...`);
  
  // Decode JWT payload
  const payload = JSON.parse(Buffer.from(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  console.log(`JWT Payload: ${JSON.stringify(payload)}`);
  
  const channelKey = payload.sub; // e.g., "premium51"
  
  // Step 2: Server lookup
  console.log('\n--- Step 2: Server lookup ---');
  const lookupUrl = `https://chevy.dvalna.ru/server_lookup?channel_id=${encodeURIComponent(channelKey)}`;
  console.log(`Lookup URL: ${lookupUrl}`);
  
  const lookupRes = await fetch(lookupUrl, {
    headers: {
      'Referer': 'https://hitsplay.fun/',
      'Origin': 'https://hitsplay.fun',
    }
  });
  
  console.log(`Lookup status: ${lookupRes.status}`);
  const lookupData = JSON.parse(lookupRes.data.toString());
  console.log(`Server key: ${lookupData.server_key}`);
  
  // Step 3: Construct M3U8 URL
  console.log('\n--- Step 3: Construct M3U8 URL ---');
  const sk = lookupData.server_key;
  const m3u8Url = (sk === 'top1/cdn')
    ? `https://top1.dvalna.ru/top1/cdn/${channelKey}/mono.css`
    : `https://${sk}new.dvalna.ru/${sk}/${channelKey}/mono.css`;
  
  console.log(`M3U8 URL: ${m3u8Url}`);
  
  // Step 4: Fetch M3U8
  console.log('\n--- Step 4: Fetch M3U8 ---');
  const m3u8Res = await fetch(m3u8Url, {
    headers: {
      'Referer': 'https://hitsplay.fun/',
      'Origin': 'https://hitsplay.fun',
      'Authorization': `Bearer ${jwt}`,
    }
  });
  
  console.log(`M3U8 status: ${m3u8Res.status}`);
  const m3u8Content = m3u8Res.data.toString();
  console.log(`M3U8 length: ${m3u8Content.length}`);
  
  // Parse key URL from M3U8
  const keyMatch = m3u8Content.match(/#EXT-X-KEY:METHOD=AES-128,URI="([^"]+)"/);
  if (!keyMatch) {
    console.error('❌ Could not find key URL in M3U8');
    console.log('M3U8 content (first 500 chars):');
    console.log(m3u8Content.substring(0, 500));
    return;
  }
  
  const keyUrl = keyMatch[1];
  console.log(`Key URL: ${keyUrl}`);
  
  // Extract key ID from URL
  const keyIdMatch = keyUrl.match(/\/key\/([^/]+)\/(\d+)/);
  if (!keyIdMatch) {
    console.error('❌ Could not parse key URL');
    return;
  }
  
  const resource = keyIdMatch[1];
  const number = keyIdMatch[2];
  console.log(`Resource: ${resource}, Number: ${number}`);
  
  // Step 5: Compute headers for key request
  console.log('\n--- Step 5: Compute key request headers ---');
  const ts = Math.floor(Date.now() / 1000);
  const fingerprint = generateFingerprint();
  const nonce = computeNonce(resource, number, ts);
  const keyPath = computeKeyPath(resource, number, ts, fingerprint);
  
  console.log(`Timestamp: ${ts}`);
  console.log(`Fingerprint: ${fingerprint}`);
  console.log(`Nonce: ${nonce}`);
  console.log(`Key Path: ${keyPath}`);
  
  // Step 6: Fetch the key
  console.log('\n--- Step 6: Fetch decryption key ---');
  const keyRes = await fetch(keyUrl, {
    headers: {
      'Referer': 'https://hitsplay.fun/',
      'Origin': 'https://hitsplay.fun',
      'Authorization': `Bearer ${jwt}`,
      'X-Key-Timestamp': ts.toString(),
      'X-Key-Nonce': nonce.toString(),
      'X-Key-Path': keyPath,
      'X-Fingerprint': fingerprint,
    }
  });
  
  console.log(`Key status: ${keyRes.status}`);
  console.log(`Key content-type: ${keyRes.headers['content-type']}`);
  console.log(`Key length: ${keyRes.data.length}`);
  
  if (keyRes.data.length === 16) {
    console.log(`✅ Key (hex): ${keyRes.data.toString('hex')}`);
  } else {
    console.log(`Key response: ${keyRes.data.toString().substring(0, 200)}`);
  }
  
  // Step 7: Try to decrypt a segment
  if (keyRes.data.length === 16) {
    console.log('\n--- Step 7: Test segment decryption ---');
    
    // Get first segment URL - look for lines that are segment URLs (not starting with #)
    const lines = m3u8Content.split('\n');
    let segmentMatch = null;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && (trimmed.startsWith('http') || /^[a-f0-9]/.test(trimmed))) {
        segmentMatch = [trimmed, trimmed];
        break;
      }
    }
    
    console.log('Looking for segment in M3U8...');
    console.log('M3U8 content:');
    console.log(m3u8Content);
    
    if (segmentMatch) {
      let segmentUrl = segmentMatch[1];
      if (!segmentUrl.startsWith('http')) {
        // Relative URL - construct full URL
        const baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);
        segmentUrl = baseUrl + segmentUrl;
      }
      
      console.log(`Segment URL: ${segmentUrl.substring(0, 80)}...`);
      
      const segRes = await fetch(segmentUrl, {
        headers: {
          'Referer': 'https://hitsplay.fun/',
          'Origin': 'https://hitsplay.fun',
        }
      });
      
      console.log(`Segment status: ${segRes.status}`);
      console.log(`Segment length: ${segRes.data.length}`);
      
      // Try to decrypt
      const key = keyRes.data;
      
      // Parse IV from M3U8 - look for IV= in the KEY line
      const ivMatch = m3u8Content.match(/IV=0x([a-fA-F0-9]+)/);
      let iv;
      if (ivMatch) {
        iv = Buffer.from(ivMatch[1], 'hex');
        console.log(`Using IV from M3U8: ${iv.toString('hex')}`);
      } else {
        iv = Buffer.alloc(16, 0); // Default IV for first segment
        console.log('Using default IV (all zeros)');
      }
      
      try {
        const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
        const decrypted = Buffer.concat([decipher.update(segRes.data), decipher.final()]);
        
        // Check for TS sync byte
        if (decrypted[0] === 0x47) {
          console.log('✅ Decryption successful! First byte is TS sync byte (0x47)');
        } else {
          console.log(`❌ Decryption may have failed. First bytes: ${decrypted.slice(0, 8).toString('hex')}`);
        }
      } catch (e) {
        console.log(`❌ Decryption error: ${e.message}`);
      }
    }
  }
}

main().catch(console.error);
