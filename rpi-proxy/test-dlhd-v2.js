#!/usr/bin/env node
/**
 * Test DLHD v2 Authentication
 * 
 * Tests the new HMAC-SHA256 signed key requests with DYNAMIC secret extraction
 * 
 * Usage: node test-dlhd-v2.js [channel]
 */

const {
  fetchAuthDataV2,
  fetchDLHDKeyV2,
  generateFingerprint,
  generateKeySignature,
  extractHmacSecret,
} = require('./dlhd-auth-v2');

const https = require('https');

async function testFingerprint() {
  console.log('\n=== Testing Fingerprint Generation ===');
  const fp = generateFingerprint();
  console.log(`Fingerprint: ${fp}`);
  console.log(`Length: ${fp.length} (expected: 16)`);
  return fp.length === 16;
}

async function testSignature() {
  console.log('\n=== Testing Signature Generation ===');
  const resource = 'premium51';
  const keyNumber = '5886102';
  const timestamp = 1767579265;
  const sequence = 1;
  const fingerprint = generateFingerprint();
  // Use a test secret
  const testSecret = 'e1d9873bf29b175b2c2b68188a4d03d6246bbe33c315175fc9e29bc766fd939e';
  
  const sig = generateKeySignature(resource, keyNumber, timestamp, sequence, fingerprint, testSecret);
  console.log(`Signature: ${sig}`);
  console.log(`Length: ${sig.length} (expected: 64)`);
  console.log(`Test Secret: ${testSecret.substring(0, 20)}...`);
  return sig.length === 64;
}

async function testAuthFetch(channel = '51') {
  console.log(`\n=== Testing Auth Data Fetch (Channel ${channel}) ===`);
  const authData = await fetchAuthDataV2(channel);
  
  if (!authData) {
    console.log('❌ Failed to fetch auth data');
    return false;
  }
  
  console.log(`Format: ${authData.format}`);
  console.log(`Token: ${authData.token.substring(0, 50)}...`);
  console.log(`Channel Key: ${authData.channelKey}`);
  console.log(`Country: ${authData.country}`);
  console.log(`Timestamp: ${authData.timestamp}`);
  console.log(`HMAC Secret: ${authData.hmacSecret ? authData.hmacSecret.substring(0, 20) + '...' : 'NOT FOUND'}`);
  
  // Verify it's a JWT
  const isJwt = authData.token.split('.').length === 3;
  console.log(`Is JWT: ${isJwt}`);
  
  if (isJwt) {
    try {
      const payload = JSON.parse(Buffer.from(authData.token.split('.')[1], 'base64').toString());
      console.log(`JWT Payload:`, payload);
    } catch (e) {
      console.log(`JWT decode error: ${e.message}`);
    }
  }
  
  // Critical: Check if HMAC secret was extracted
  const hasHmacSecret = !!authData.hmacSecret && authData.hmacSecret.length === 64;
  console.log(`Has valid HMAC secret: ${hasHmacSecret}`);
  
  return !!authData.token && hasHmacSecret;
}

async function testServerLookup(channel = '51') {
  console.log(`\n=== Testing Server Lookup (Channel ${channel}) ===`);
  
  return new Promise((resolve) => {
    const channelKey = `premium${channel}`;
    const url = `https://chevy.giokko.ru/server_lookup?channel_id=${channelKey}`;
    
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://epaly.fun/',
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`Status: ${res.statusCode}`);
        console.log(`Response: ${data}`);
        
        try {
          const json = JSON.parse(data);
          console.log(`Server Key: ${json.server_key}`);
          resolve(!!json.server_key);
        } catch (e) {
          console.log(`Parse error: ${e.message}`);
          resolve(false);
        }
      });
    }).on('error', (e) => {
      console.log(`Error: ${e.message}`);
      resolve(false);
    });
  });
}

async function testHmacSecretExtraction() {
  console.log('\n=== Testing HMAC Secret Extraction ===');
  
  // Test with the saved player page
  const fs = require('fs');
  const path = require('path');
  
  try {
    const playerHtml = fs.readFileSync(path.join(__dirname, '..', 'dlhd-player-response.html'), 'utf8');
    const secret = extractHmacSecret(playerHtml);
    
    if (secret) {
      console.log(`Extracted secret: ${secret}`);
      console.log(`Length: ${secret.length} (expected: 64)`);
      console.log(`Is valid hex: ${/^[a-f0-9]{64}$/i.test(secret)}`);
      return secret.length === 64;
    } else {
      console.log('❌ Could not extract HMAC secret from saved page');
      return false;
    }
  } catch (e) {
    console.log(`Error reading saved page: ${e.message}`);
    console.log('Skipping local file test, will test with live fetch...');
    return true; // Don't fail if file doesn't exist
  }
}

async function testKeyFetch(channel = '51') {
  console.log(`\n=== Testing Key Fetch (Channel ${channel}) ===`);
  
  // First get server key
  const serverKey = await new Promise((resolve) => {
    const channelKey = `premium${channel}`;
    https.get(`https://chevy.giokko.ru/server_lookup?channel_id=${channelKey}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://epaly.fun/',
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.server_key || 'zeko');
        } catch {
          resolve('zeko');
        }
      });
    }).on('error', () => resolve('zeko'));
  });
  
  console.log(`Using server: ${serverKey}`);
  
  // Construct a test key URL (using a fake key number)
  const keyUrl = `https://chevy.kiko2.ru/key/premium${channel}/1234567`;
  console.log(`Key URL: ${keyUrl}`);
  
  const result = await fetchDLHDKeyV2(keyUrl);
  
  console.log(`Success: ${result.success}`);
  if (result.success) {
    console.log(`Key (hex): ${result.data.toString('hex')}`);
  } else {
    console.log(`Error: ${result.error}`);
    if (result.code) console.log(`Code: ${result.code}`);
    if (result.response) console.log(`Response: ${result.response.substring(0, 200)}`);
  }
  
  return result.success;
}

async function main() {
  const channel = process.argv[2] || '51';
  
  console.log('========================================');
  console.log('DLHD v2 Authentication Test');
  console.log('(with DYNAMIC HMAC secret extraction)');
  console.log('========================================');
  console.log(`Testing channel: ${channel}`);
  
  const results = {
    fingerprint: await testFingerprint(),
    signature: await testSignature(),
    hmacExtraction: await testHmacSecretExtraction(),
    authFetch: await testAuthFetch(channel),
    serverLookup: await testServerLookup(channel),
    keyFetch: await testKeyFetch(channel),
  };
  
  console.log('\n========================================');
  console.log('Results Summary');
  console.log('========================================');
  for (const [test, passed] of Object.entries(results)) {
    console.log(`${passed ? '✅' : '❌'} ${test}`);
  }
  
  const allPassed = Object.values(results).every(v => v);
  console.log(`\nOverall: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  
  process.exit(allPassed ? 0 : 1);
}

main().catch(console.error);
