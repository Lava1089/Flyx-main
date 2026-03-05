/**
 * Test FULL decryption flow - M3U8 -> Key -> Segment -> Decrypt
 * 
 * This tests whether we can actually play the stream, not just get the playlist.
 * 
 * From hitsplay.fun player, the key fetch requires:
 * - Authorization: Bearer {SESSION_TOKEN}
 * - X-Key-Timestamp: {timestamp}
 * - X-Key-Nonce: {proof-of-work nonce}
 * - X-Key-Path: {HMAC signature}
 * - X-Fingerprint: {browser fingerprint}
 */

const crypto = require('crypto');

// HMAC secret from hitsplay.fun
const HMAC_SECRET = 'd6398a30dd88f3defad36e0a10226679a045f47df9428e9cb4d98e9a6bd364b4';

// Server mappings
const SERVER_MAP = {
  51: 'zeko',
  1: 'nfs',
  100: 'ddy6'
};

function base64UrlEncode(data) {
  if (Buffer.isBuffer(data)) {
    return data.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  return Buffer.from(data).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function hmacSha256(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function generateJWT(channelId) {
  const now = Math.floor(Date.now() / 1000);
  const channelKey = `premium${channelId}`;
  
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: channelKey,
    country: 'US',
    iat: now,
    exp: now + (5 * 60 * 60),
  };
  
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signature = base64UrlEncode(hmacSha256(HMAC_SECRET, `${headerB64}.${payloadB64}`));
  
  return `${headerB64}.${payloadB64}.${signature}`;
}

// Generate fingerprint like hitsplay does
function generateFingerprint() {
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
  const scr = '1920x1080';
  const tz = 'America/New_York';
  const lg = 'en-US';
  return crypto.createHash('sha256').update(ua + scr + tz + lg).digest('hex').substring(0, 16);
}

// Proof-of-work nonce calculation (from hitsplay _d5ecf0ce function)
function calculateNonce(resource, number, ts) {
  const base = crypto.createHmac('sha256', HMAC_SECRET).update(resource).digest('hex');
  let nonce = 0;
  const target = 0x1000;
  
  while (nonce < 100000) {
    const hash = crypto.createHash('md5').update(base + resource + number + ts + nonce).digest('hex');
    if (parseInt(hash.substring(0, 4), 16) < target) break;
    nonce++;
  }
  return nonce;
}

// Key path calculation (from hitsplay _3aca4f87 function)
function calculateKeyPath(resource, number, ts, fingerprint) {
  const data = resource + '|' + number + '|' + ts + '|' + fingerprint;
  return crypto.createHmac('sha256', HMAC_SECRET).update(data).digest('hex').substring(0, 16);
}

async function testFullDecrypt(channelId) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing FULL decrypt flow for channel ${channelId}`);
  console.log('='.repeat(60));
  
  const server = SERVER_MAP[channelId];
  if (!server) {
    console.log(`No server mapping for channel ${channelId}`);
    return;
  }
  
  const channelKey = `premium${channelId}`;
  const token = generateJWT(channelId);
  const fingerprint = generateFingerprint();
  
  console.log(`\nServer: ${server}`);
  console.log(`Channel Key: ${channelKey}`);
  console.log(`Fingerprint: ${fingerprint}`);
  console.log(`Token (first 50): ${token.substring(0, 50)}...`);
  
  // Step 1: Fetch M3U8
  console.log('\n--- Step 1: Fetch M3U8 ---');
  const m3u8Url = `https://${server}new.dvalna.ru/${server}/${channelKey}/mono.css`;
  console.log(`URL: ${m3u8Url}`);
  
  let m3u8Response;
  try {
    m3u8Response = await fetch(m3u8Url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
        'Referer': 'https://hitsplay.fun/',
        'Origin': 'https://hitsplay.fun',
        'Authorization': `Bearer ${token}`,
      }
    });
    
    console.log(`M3U8 Status: ${m3u8Response.status}`);
    
    if (!m3u8Response.ok) {
      console.log(`❌ M3U8 fetch failed: ${await m3u8Response.text()}`);
      return;
    }
  } catch (e) {
    console.log(`❌ M3U8 fetch error: ${e.message}`);
    return;
  }
  
  const m3u8Text = await m3u8Response.text();
  console.log(`M3U8 length: ${m3u8Text.length}`);
  
  // Parse key URL from M3U8
  const keyMatch = m3u8Text.match(/#EXT-X-KEY:METHOD=AES-128,URI="([^"]+)"/);
  if (!keyMatch) {
    console.log('❌ No encryption key found in M3U8');
    console.log('M3U8 content:', m3u8Text.substring(0, 500));
    return;
  }
  
  const keyUrl = keyMatch[1];
  console.log(`\n✓ Found key URL: ${keyUrl}`);
  
  // Parse IV
  const ivMatch = m3u8Text.match(/IV=0x([0-9a-fA-F]+)/);
  const iv = ivMatch ? ivMatch[1] : null;
  console.log(`IV: ${iv || 'not specified'}`);
  
  // Parse segment URL - they use chevy.dvalna.ru with hex paths
  const lines = m3u8Text.split('\n');
  let segmentUrl = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.startsWith('https://')) {
      segmentUrl = trimmed;
      break;
    }
  }
  
  if (!segmentUrl) {
    console.log('❌ No segment URL found');
    console.log('M3U8 content:\n', m3u8Text);
    return;
  }
  console.log(`First segment: ${segmentUrl}`);
  
  // Step 2: Fetch encryption key
  console.log('\n--- Step 2: Fetch Encryption Key ---');
  
  // Extract resource and number from key URL
  // Format: https://chevy.dvalna.ru/key/premium51/5898812
  const keyPathMatch = keyUrl.match(/\/key\/([^\/]+)\/(\d+)/);
  if (!keyPathMatch) {
    console.log('❌ Could not parse key URL');
    return;
  }
  
  const resource = keyPathMatch[1];
  const number = keyPathMatch[2];
  const ts = Math.floor(Date.now() / 1000);
  
  console.log(`Resource: ${resource}`);
  console.log(`Number: ${number}`);
  console.log(`Timestamp: ${ts}`);
  
  // Calculate PoW nonce and key path
  const nonce = calculateNonce(resource, number, ts);
  const keyPath = calculateKeyPath(resource, number, ts, fingerprint);
  
  console.log(`Nonce (PoW): ${nonce}`);
  console.log(`Key Path: ${keyPath}`);
  
  // Fetch the key with all required headers
  let keyResponse;
  try {
    keyResponse = await fetch(keyUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
        'Referer': 'https://hitsplay.fun/',
        'Origin': 'https://hitsplay.fun',
        'Authorization': `Bearer ${token}`,
        'X-Key-Timestamp': ts.toString(),
        'X-Key-Nonce': nonce.toString(),
        'X-Key-Path': keyPath,
        'X-Fingerprint': fingerprint,
      }
    });
    
    console.log(`Key Status: ${keyResponse.status}`);
    console.log(`Key Headers:`, Object.fromEntries(keyResponse.headers.entries()));
    
    if (!keyResponse.ok) {
      const errorText = await keyResponse.text();
      console.log(`❌ Key fetch failed: ${errorText}`);
      return;
    }
  } catch (e) {
    console.log(`❌ Key fetch error: ${e.message}`);
    return;
  }
  
  const keyBuffer = await keyResponse.arrayBuffer();
  const keyBytes = new Uint8Array(keyBuffer);
  console.log(`Key length: ${keyBytes.length} bytes`);
  console.log(`Key (hex): ${Buffer.from(keyBytes).toString('hex')}`);
  
  if (keyBytes.length !== 16) {
    console.log(`❌ Invalid key length (expected 16 bytes for AES-128)`);
    return;
  }
  
  console.log('✓ Got valid 16-byte AES key!');
  
  // Step 3: Fetch a segment
  console.log('\n--- Step 3: Fetch Segment ---');
  
  let segmentResponse;
  try {
    segmentResponse = await fetch(segmentUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
        'Referer': 'https://hitsplay.fun/',
        'Origin': 'https://hitsplay.fun',
      }
    });
    
    console.log(`Segment Status: ${segmentResponse.status}`);
    
    if (!segmentResponse.ok) {
      console.log(`❌ Segment fetch failed`);
      return;
    }
  } catch (e) {
    console.log(`❌ Segment fetch error: ${e.message}`);
    return;
  }
  
  const segmentBuffer = await segmentResponse.arrayBuffer();
  const segmentBytes = new Uint8Array(segmentBuffer);
  console.log(`Segment size: ${segmentBytes.length} bytes`);
  
  // Step 4: Decrypt segment
  console.log('\n--- Step 4: Decrypt Segment ---');
  
  // Prepare IV (16 bytes)
  let ivBytes;
  if (iv) {
    // Pad IV to 16 bytes if needed
    const ivHex = iv.padStart(32, '0');
    ivBytes = Buffer.from(ivHex, 'hex');
  } else {
    // Use segment sequence number as IV (default HLS behavior)
    ivBytes = Buffer.alloc(16, 0);
  }
  
  console.log(`IV (hex): ${ivBytes.toString('hex')}`);
  
  try {
    const decipher = crypto.createDecipheriv('aes-128-cbc', Buffer.from(keyBytes), ivBytes);
    decipher.setAutoPadding(true);
    
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(segmentBytes)),
      decipher.final()
    ]);
    
    console.log(`Decrypted size: ${decrypted.length} bytes`);
    
    // Check for MPEG-TS sync byte (0x47)
    const syncBytes = [];
    for (let i = 0; i < Math.min(decrypted.length, 1000); i++) {
      if (decrypted[i] === 0x47) {
        syncBytes.push(i);
        if (syncBytes.length >= 5) break;
      }
    }
    
    console.log(`MPEG-TS sync bytes (0x47) found at positions: ${syncBytes.join(', ')}`);
    
    // Check if sync bytes are 188 bytes apart (MPEG-TS packet size)
    if (syncBytes.length >= 2) {
      const spacing = syncBytes[1] - syncBytes[0];
      if (spacing === 188) {
        console.log('✅ VALID MPEG-TS! Sync bytes are 188 bytes apart!');
        console.log('\n🎉 FULL DECRYPTION SUCCESSFUL! Stream is playable!');
      } else {
        console.log(`⚠️ Sync byte spacing: ${spacing} (expected 188)`);
      }
    }
    
    // Show first bytes
    console.log(`First 32 bytes (hex): ${decrypted.slice(0, 32).toString('hex')}`);
    
  } catch (e) {
    console.log(`❌ Decryption failed: ${e.message}`);
  }
}

// Test channels
(async () => {
  await testFullDecrypt(51);
  console.log('\n⏳ Waiting 2 seconds to avoid rate limiting...\n');
  await new Promise(r => setTimeout(r, 2000));
  await testFullDecrypt(1);
  console.log('\n⏳ Waiting 2 seconds to avoid rate limiting...\n');
  await new Promise(r => setTimeout(r, 2000));
  await testFullDecrypt(100);
})();
