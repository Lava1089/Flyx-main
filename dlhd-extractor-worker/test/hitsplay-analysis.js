/**
 * HITSPLAY.FUN PLAYER ANALYSIS
 * ============================
 * 
 * This file documents the complete flow of how hitsplay.fun/premiumtv/daddyhd.php works.
 * 
 * ## KEY FINDINGS:
 * 
 * 1. **JWT Token** - Embedded in the page as base64:
 *    - Variable: _599c1b52 (obfuscated name)
 *    - Decoded: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJwcmVtaXVtNTEiLCJjb3VudHJ5IjoiVVMiLCJpYXQiOjE3Njk2NTE1NzMsImV4cCI6MTc2OTY2OTU3M30.tgO-Ocp_X6FZrxJcbnlbYT8cgDRxrnImQOLf_brgXZc
 *    - Payload: {"sub":"premium51","country":"US","iat":1769651573,"exp":1769669573}
 * 
 * 2. **HMAC Secret** - Used for key derivation:
 *    - Variable: _2d6017e3
 *    - Value: d6398a30dd88f3defad36e0a10226679a045f47df9428e9cb4d98e9a6bd364b4
 * 
 * 3. **Channel Key** - Format: premium{channel_id}
 *    - Variable: _db5cf805
 *    - Example: premium51
 * 
 * 4. **Server Lookup** - First API call:
 *    - URL: https://chevy.dvalna.ru/server_lookup?channel_id=premium51
 *    - Returns: { server_key: "top1/cdn" } or similar
 * 
 * 5. **M3U8 URL Construction**:
 *    - If server_key === 'top1/cdn':
 *      https://top1.dvalna.ru/top1/cdn/${CHANNEL_KEY}/mono.css
 *    - Otherwise:
 *      https://${sk}new.dvalna.ru/${sk}/${CHANNEL_KEY}/mono.css
 * 
 * 6. **Key Request Headers** (for /key/ URLs):
 *    - Authorization: Bearer {SESSION_TOKEN}
 *    - X-Key-Timestamp: {unix_timestamp}
 *    - X-Key-Nonce: {computed_nonce}
 *    - X-Key-Path: {computed_key_path}
 *    - X-Fingerprint: {browser_fingerprint}
 * 
 * 7. **Nonce Computation** (_af082d34 function):
 *    - base = HmacSHA256(resource, HMAC_SECRET)
 *    - Loop until MD5(base + resource + number + ts + nonce).substring(0,4) < 0x1000
 *    - This is a Proof-of-Work mechanism!
 * 
 * 8. **Key Path Computation** (_3b4bc021 function):
 *    - data = resource + '|' + number + '|' + ts + '|' + fingerprint
 *    - return HmacSHA256(data, HMAC_SECRET).substring(0, 16)
 * 
 * 9. **Fingerprint Generation**:
 *    - SHA256(userAgent + screenSize + timezone + language).substring(0, 16)
 * 
 * 10. **Cookie Set**:
 *     - eplayer_session={SESSION_TOKEN}; domain=.dvalna.ru; path=/; SameSite=None; Secure
 */

const crypto = require('crypto');

// Constants from the page
const HMAC_SECRET = 'd6398a30dd88f3defad36e0a10226679a045f47df9428e9cb4d98e9a6bd364b4';

/**
 * Compute the PoW nonce (same as _af082d34)
 */
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

/**
 * Compute the key path (same as _3b4bc021)
 */
function computeKeyPath(resource, number, ts, fingerprint) {
  const data = resource + '|' + number + '|' + ts + '|' + fingerprint;
  return crypto.createHmac('sha256', HMAC_SECRET).update(data).digest('hex').substring(0, 16);
}

/**
 * Generate fingerprint (same as _73787ac1)
 */
function generateFingerprint(userAgent, screenSize, timezone, language) {
  const data = userAgent + screenSize + timezone + language;
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
}

// Test the functions
async function test() {
  console.log('='.repeat(70));
  console.log('HITSPLAY.FUN KEY DERIVATION TEST');
  console.log('='.repeat(70));
  
  const resource = 'premium51';
  const number = '5898'; // Example key ID from M3U8
  const ts = Math.floor(Date.now() / 1000);
  const fingerprint = generateFingerprint(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    '1920x1080',
    'America/New_York',
    'en-US'
  );
  
  console.log('\nInputs:');
  console.log(`  Resource: ${resource}`);
  console.log(`  Number: ${number}`);
  console.log(`  Timestamp: ${ts}`);
  console.log(`  Fingerprint: ${fingerprint}`);
  
  console.log('\nComputed values:');
  const nonce = computeNonce(resource, number, ts);
  console.log(`  Nonce: ${nonce}`);
  
  const keyPath = computeKeyPath(resource, number, ts, fingerprint);
  console.log(`  Key Path: ${keyPath}`);
  
  console.log('\nRequired headers for key request:');
  console.log(`  Authorization: Bearer <JWT_TOKEN>`);
  console.log(`  X-Key-Timestamp: ${ts}`);
  console.log(`  X-Key-Nonce: ${nonce}`);
  console.log(`  X-Key-Path: ${keyPath}`);
  console.log(`  X-Fingerprint: ${fingerprint}`);
  
  // Now let's test fetching the actual key
  console.log('\n' + '='.repeat(70));
  console.log('TESTING ACTUAL KEY FETCH');
  console.log('='.repeat(70));
  
  // First, we need to get a fresh JWT from the page
  const https = require('https');
  
  // Fetch the player page to get the JWT
  const pageUrl = 'https://hitsplay.fun/premiumtv/daddyhd.php?id=51';
  console.log(`\nFetching page: ${pageUrl}`);
  
  const pageData = await new Promise((resolve, reject) => {
    https.get(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://dlhd.link/',
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
  
  // Extract JWT from page
  const jwtMatch = pageData.match(/atob\("([^"]+)"\).*?eyJ/);
  const base64Matches = pageData.match(/atob\("([A-Za-z0-9+/=]+)"\)/g);
  
  console.log('\nBase64 encoded values found:');
  if (base64Matches) {
    base64Matches.forEach((match, i) => {
      const b64 = match.match(/atob\("([^"]+)"\)/)[1];
      try {
        const decoded = Buffer.from(b64, 'base64').toString('utf8');
        console.log(`  ${i + 1}: ${decoded.substring(0, 80)}${decoded.length > 80 ? '...' : ''}`);
      } catch (e) {}
    });
  }
  
  // Look for the JWT token specifically
  const jwtTokenMatch = pageData.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  if (jwtTokenMatch) {
    console.log(`\nJWT Token found: ${jwtTokenMatch[0].substring(0, 50)}...`);
    try {
      const payload = JSON.parse(Buffer.from(jwtTokenMatch[0].split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
      console.log(`  Payload: ${JSON.stringify(payload)}`);
    } catch (e) {}
  }
  
  // Look for HMAC secret
  const hmacMatch = pageData.match(/[a-f0-9]{64}/g);
  if (hmacMatch) {
    console.log(`\nPotential HMAC secrets found: ${hmacMatch.length}`);
    hmacMatch.slice(0, 3).forEach((h, i) => {
      console.log(`  ${i + 1}: ${h}`);
    });
  }
}

test().catch(console.error);
