// Full DLHD key pipeline test: auth -> M3U8 -> PoW -> key fetch
const crypto = require('crypto');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// MD5 helper
function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

// HMAC-SHA256 helper
function hmacSha256(data, key) {
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}

// SHA-256 helper
function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

// Generate fingerprint (matches browser logic)
function generateFingerprint() {
  const data = UA + '1920x1080' + 'America/New_York' + 'en-US';
  return sha256(data).substring(0, 16);
}

// Compute PoW nonce (V5 EPlayerAuth - MD5 based)
function computePowNonce(channelKey, keyNumber, timestamp, channelSalt) {
  const hmacPrefix = hmacSha256(channelKey, channelSalt);
  const threshold = 0x1000;
  
  for (let nonce = 0; nonce < 100000; nonce++) {
    const data = hmacPrefix + channelKey + keyNumber + timestamp + nonce;
    const hash = md5(data);
    const first4 = parseInt(hash.substring(0, 4), 16);
    if (first4 < threshold) {
      return { nonce, hash: hash.substring(0, 8) };
    }
  }
  return { nonce: 99999, hash: 'none' };
}

// Compute key path
function computeKeyPath(resource, keyNumber, timestamp, fingerprint, channelSalt) {
  const data = `${resource}|${keyNumber}|${timestamp}|${fingerprint}`;
  return hmacSha256(data, channelSalt).substring(0, 16);
}

async function main() {
  const channelId = process.argv[2] || '44';
  console.log('=== DLHD Full Key Pipeline Test ===');
  console.log('Channel:', channelId);
  console.log('Time:', new Date().toISOString());
  console.log();

  // Step 1: Fetch auth from epaly.fun
  console.log('--- Step 1: Fetch Auth ---');
  const authUrl = `https://epaly.fun/premiumtv/daddyhd.php?id=${channelId}`;
  const start1 = Date.now();
  
  let authToken, channelSalt, channelKey;
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10000);
    const res = await fetch(authUrl, {
      headers: { 'User-Agent': UA, 'Referer': 'https://dlhd.link/' },
      signal: controller.signal,
    });
    const html = await res.text();
    const initMatch = html.match(/EPlayerAuth\.init\s*\(\s*\{([^}]+)\}\s*\)/);
    if (!initMatch) {
      console.log('FAILED: No EPlayerAuth found');
      return;
    }
    const s = initMatch[1];
    authToken = s.match(/authToken\s*:\s*["']([^"']+)["']/)?.[1];
    channelSalt = s.match(/channelSalt\s*:\s*["']([^"']+)["']/)?.[1];
    channelKey = s.match(/channelKey\s*:\s*["']([^"']+)["']/)?.[1] || `premium${channelId}`;
    
    console.log(`  authToken: ${authToken?.substring(0, 50)}...`);
    console.log(`  channelSalt: ${channelSalt?.substring(0, 30)}...`);
    console.log(`  channelKey: ${channelKey}`);
    console.log(`  Time: ${Date.now() - start1}ms`);
  } catch (e) {
    console.log(`FAILED: ${e.message}`);
    return;
  }

  if (!authToken || !channelSalt) {
    console.log('FAILED: Missing auth data');
    return;
  }

  // Step 2: Server lookup
  console.log('\n--- Step 2: Server Lookup ---');
  const start2 = Date.now();
  let serverKey;
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`https://chevy.dvalna.ru/server_lookup?channel_id=${channelKey}`, {
      headers: { 'User-Agent': UA, 'Referer': 'https://epaly.fun/' },
      signal: controller.signal,
    });
    const data = await res.json();
    serverKey = data.server_key;
    console.log(`  Server: ${serverKey} (${Date.now() - start2}ms)`);
  } catch (e) {
    console.log(`  Lookup failed, using fallback: ${e.message}`);
    serverKey = 'zeko';
  }

  // Step 3: Fetch M3U8
  console.log('\n--- Step 3: Fetch M3U8 ---');
  const m3u8Url = `https://${serverKey}new.dvalna.ru/${serverKey}/${channelKey}/mono.css`;
  console.log(`  URL: ${m3u8Url}`);
  const start3 = Date.now();
  
  let m3u8Text, keyUrl;
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 8000);
    const res = await fetch(m3u8Url, {
      headers: {
        'User-Agent': UA,
        'Referer': 'https://epaly.fun/',
        'Origin': 'https://epaly.fun',
      },
      signal: controller.signal,
    });
    m3u8Text = await res.text();
    const isValid = m3u8Text.includes('#EXTM3U');
    console.log(`  Status: ${res.status} Valid: ${isValid} (${Date.now() - start3}ms)`);
    
    if (!isValid) {
      console.log(`  Body: ${m3u8Text.substring(0, 200)}`);
      return;
    }
    
    // Extract key URL
    const keyMatch = m3u8Text.match(/URI="([^"]+)"/);
    if (keyMatch) {
      keyUrl = keyMatch[1];
      console.log(`  Key URL: ${keyUrl}`);
    } else {
      console.log('  No key URL found (unencrypted?)');
    }
  } catch (e) {
    console.log(`  FAILED: ${e.message}`);
    return;
  }

  if (!keyUrl) {
    console.log('\nNo key URL to test - stream may be unencrypted');
    return;
  }

  // Step 4: Parse key URL and compute PoW
  console.log('\n--- Step 4: Compute PoW ---');
  const keyParams = keyUrl.match(/\/key\/([^/]+)\/(\d+)/);
  if (!keyParams) {
    console.log('  FAILED: Cannot parse key URL');
    return;
  }
  
  const resource = keyParams[1];
  const keyNumber = keyParams[2];
  const timestamp = Math.floor(Date.now() / 1000);
  const fingerprint = generateFingerprint();
  
  console.log(`  Resource: ${resource}`);
  console.log(`  Key Number: ${keyNumber}`);
  console.log(`  Timestamp: ${timestamp}`);
  console.log(`  Fingerprint: ${fingerprint}`);
  
  const start4 = Date.now();
  const { nonce, hash } = computePowNonce(resource, keyNumber, timestamp, channelSalt);
  const keyPath = computeKeyPath(resource, keyNumber, timestamp, fingerprint, channelSalt);
  console.log(`  Nonce: ${nonce} (hash: ${hash}) (${Date.now() - start4}ms)`);
  console.log(`  Key Path: ${keyPath}`);

  // Step 5: Fetch key with full auth
  console.log('\n--- Step 5: Fetch Key ---');
  
  // Normalize key URL to chevy.dvalna.ru
  const normalizedKeyUrl = `https://chevy.dvalna.ru/key/${resource}/${keyNumber}`;
  console.log(`  URL: ${normalizedKeyUrl}`);
  
  const keyHeaders = {
    'User-Agent': UA,
    'Accept': '*/*',
    'Origin': 'https://epaly.fun',
    'Referer': 'https://epaly.fun/',
    'Authorization': `Bearer ${authToken}`,
    'X-Key-Timestamp': timestamp.toString(),
    'X-Key-Nonce': nonce.toString(),
    'X-Key-Path': keyPath,
    'X-Fingerprint': fingerprint,
  };
  
  console.log('  Headers:', JSON.stringify(keyHeaders, null, 2));
  
  const start5 = Date.now();
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10000);
    const res = await fetch(normalizedKeyUrl, {
      headers: keyHeaders,
      signal: controller.signal,
    });
    const elapsed5 = Date.now() - start5;
    console.log(`  Status: ${res.status} (${elapsed5}ms)`);
    
    const buf = await res.arrayBuffer();
    console.log(`  Body size: ${buf.byteLength} bytes`);
    
    if (buf.byteLength === 16) {
      const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
      const isFake = hex.startsWith('455806f8') || hex.startsWith('45c6497');
      const isError = hex.startsWith('6572726f72');
      console.log(`  Key: ${hex}`);
      if (isFake) console.log('  ⚠️ FAKE KEY');
      else if (isError) console.log('  🚫 ERROR/RATE LIMITED');
      else console.log('  ✅ REAL KEY!');
    } else {
      const text = new TextDecoder().decode(buf);
      console.log(`  Body: ${text.substring(0, 300)}`);
      
      // Check if it's a hex-encoded error
      if (buf.byteLength > 0 && buf.byteLength < 100) {
        const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
        console.log(`  Hex: ${hex}`);
      }
    }
  } catch (e) {
    console.log(`  FAILED: ${e.message}`);
  }

  // Also try without X-Key-Path and X-Fingerprint (simpler auth)
  console.log('\n--- Step 5b: Fetch Key (minimal headers) ---');
  const minimalHeaders = {
    'User-Agent': UA,
    'Accept': '*/*',
    'Origin': 'https://epaly.fun',
    'Referer': 'https://epaly.fun/',
    'Authorization': `Bearer ${authToken}`,
    'X-Key-Timestamp': timestamp.toString(),
    'X-Key-Nonce': nonce.toString(),
  };
  
  const start5b = Date.now();
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10000);
    const res = await fetch(normalizedKeyUrl, {
      headers: minimalHeaders,
      signal: controller.signal,
    });
    const elapsed5b = Date.now() - start5b;
    console.log(`  Status: ${res.status} (${elapsed5b}ms)`);
    
    const buf = await res.arrayBuffer();
    console.log(`  Body size: ${buf.byteLength} bytes`);
    
    if (buf.byteLength === 16) {
      const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
      const isFake = hex.startsWith('455806f8') || hex.startsWith('45c6497');
      console.log(`  Key: ${hex} ${isFake ? '⚠️ FAKE' : '✅ REAL'}`);
    } else {
      const text = new TextDecoder().decode(buf);
      console.log(`  Body: ${text.substring(0, 300)}`);
    }
  } catch (e) {
    console.log(`  FAILED: ${e.message}`);
  }

  console.log('\n=== Done ===');
}

main().catch(console.error);
