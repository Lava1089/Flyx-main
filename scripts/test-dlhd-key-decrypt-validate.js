#!/usr/bin/env node
/**
 * DLHD Key Validation - Decrypt segment and check for 0x47 TS sync byte
 * 
 * The ONLY way to know if a key is real: decrypt a segment and check
 * if the first byte is 0x47 (MPEG-TS sync byte).
 * 
 * Tests keys from multiple sources:
 * 1. chevy.soyspace.cyou/key/... (CDN direct, no auth)
 * 2. go.ai-chatx.site/key/... (reCAPTCHA domain, no auth)
 * 3. Various header combinations
 */

const https = require('https');
const crypto = require('crypto');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function fetchBuf(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { 'User-Agent': UA, ...headers },
      timeout: 15000,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

function fetchText(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { 'User-Agent': UA, ...headers },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

/**
 * Decrypt AES-128-CBC segment and check for 0x47 sync byte
 */
function decryptAndValidate(keyBuf, ivBuf, segmentBuf) {
  try {
    const decipher = crypto.createDecipheriv('aes-128-cbc', keyBuf, ivBuf);
    decipher.setAutoPadding(false); // TS segments may not have PKCS7 padding
    const decrypted = Buffer.concat([decipher.update(segmentBuf), decipher.final()]);
    
    const firstByte = decrypted[0];
    const first4Hex = decrypted.slice(0, 4).toString('hex');
    const first16Hex = decrypted.slice(0, 16).toString('hex');
    
    // Check for 0x47 sync byte at position 0
    const hasSync = firstByte === 0x47;
    
    // Also check at 188-byte boundaries (TS packet size)
    let syncCount = 0;
    for (let i = 0; i < Math.min(decrypted.length, 1880); i += 188) {
      if (decrypted[i] === 0x47) syncCount++;
    }
    
    return {
      valid: hasSync,
      firstByte: '0x' + firstByte.toString(16).padStart(2, '0'),
      first4Hex,
      first16Hex,
      syncCount,
      decryptedSize: decrypted.length,
    };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

/**
 * Parse IV from M3U8 EXT-X-KEY line
 * IV format: 0x303030303030303030303030697ab81a
 */
function parseIV(ivStr) {
  // Remove 0x prefix
  const hex = ivStr.replace(/^0x/i, '');
  return Buffer.from(hex, 'hex');
}

async function main() {
  console.log('='.repeat(80));
  console.log('DLHD Key DECRYPT Validation');
  console.log('Decrypt segment + check 0x47 sync byte = ONLY real validation');
  console.log('='.repeat(80));

  // Step 1: Server lookup
  console.log('\n--- Step 1: Server Lookup ---');
  const lookupRes = await fetchText('https://chevy.vovlacosa.sbs/server_lookup?channel_id=premium44', {
    'Referer': 'https://adffdafdsafds.sbs/',
  });
  const serverKey = JSON.parse(lookupRes.body).server_key;
  console.log(`Server: ${serverKey}`);

  // Step 2: Fetch M3U8
  console.log('\n--- Step 2: Fetch M3U8 ---');
  const m3u8Url = `https://chevy.soyspace.cyou/proxy/${serverKey}/premium44/mono.css`;
  const m3u8Res = await fetchText(m3u8Url, {
    'Referer': 'https://adffdafdsafds.sbs/',
    'Origin': 'https://adffdafdsafds.sbs',
  });
  
  if (!m3u8Res.body.includes('#EXTM3U')) {
    console.log('❌ Invalid M3U8');
    return;
  }

  // Parse key URI, IV, and first segment URL
  const keyLine = m3u8Res.body.match(/#EXT-X-KEY:([^\n]+)/);
  if (!keyLine) {
    console.log('❌ No EXT-X-KEY found');
    return;
  }
  
  console.log(`Key line: ${keyLine[1]}`);
  
  const uriMatch = keyLine[1].match(/URI="([^"]+)"/);
  const ivMatch = keyLine[1].match(/IV=([^,\s]+)/);
  
  if (!uriMatch || !ivMatch) {
    console.log('❌ Could not parse URI or IV');
    return;
  }
  
  const keyPath = uriMatch[1]; // e.g., /key/premium44/5909696
  const ivStr = ivMatch[1];
  const ivBuf = parseIV(ivStr);
  
  console.log(`Key path: ${keyPath}`);
  console.log(`IV: ${ivStr}`);
  console.log(`IV hex: ${ivBuf.toString('hex')}`);

  // Get first segment URL
  const lines = m3u8Res.body.split('\n');
  let segmentUrl = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.startsWith('http')) {
      segmentUrl = trimmed;
      break;
    }
  }
  
  if (!segmentUrl) {
    console.log('❌ No segment URL found');
    return;
  }
  console.log(`Segment: ${segmentUrl.substring(0, 80)}...`);

  // Step 3: Fetch the segment (only first 16KB needed for validation)
  console.log('\n--- Step 3: Fetch Segment ---');
  const segRes = await fetchBuf(segmentUrl);
  console.log(`Segment size: ${segRes.body.length} bytes`);
  console.log(`Segment first 16 bytes: ${segRes.body.slice(0, 16).toString('hex')}`);

  // Step 4: Fetch keys from different sources and validate each
  console.log('\n--- Step 4: Fetch Keys & Decrypt-Validate ---');
  
  const keyTests = [
    {
      label: 'chevy.soyspace.cyou (CDN) - no headers',
      url: `https://chevy.soyspace.cyou${keyPath}`,
      headers: {},
    },
    {
      label: 'chevy.soyspace.cyou (CDN) - with Referer',
      url: `https://chevy.soyspace.cyou${keyPath}`,
      headers: { 'Referer': 'https://adffdafdsafds.sbs/', 'Origin': 'https://adffdafdsafds.sbs' },
    },
    {
      label: 'go.ai-chatx.site - no headers',
      url: `https://go.ai-chatx.site${keyPath}`,
      headers: {},
    },
    {
      label: 'go.ai-chatx.site - with Referer',
      url: `https://go.ai-chatx.site${keyPath}`,
      headers: { 'Referer': 'https://adffdafdsafds.sbs/', 'Origin': 'https://adffdafdsafds.sbs' },
    },
    {
      label: 'chevy.vovlacosa.sbs - no headers',
      url: `https://chevy.vovlacosa.sbs${keyPath}`,
      headers: {},
    },
  ];

  const results = [];
  
  for (const test of keyTests) {
    console.log(`\n  🔑 ${test.label}`);
    console.log(`     URL: ${test.url}`);
    
    try {
      const keyRes = await fetchBuf(test.url, test.headers);
      console.log(`     Status: ${keyRes.status}, Size: ${keyRes.body.length}`);
      
      if (keyRes.body.length !== 16) {
        console.log(`     ❌ Not 16 bytes — invalid key`);
        console.log(`     Body: ${keyRes.body.toString('utf8').substring(0, 100)}`);
        results.push({ label: test.label, valid: false, reason: 'not 16 bytes' });
        continue;
      }
      
      const keyHex = keyRes.body.toString('hex');
      console.log(`     Key hex: ${keyHex}`);
      
      // Decrypt and validate
      const validation = decryptAndValidate(keyRes.body, ivBuf, segRes.body);
      
      if (validation.error) {
        console.log(`     ❌ Decrypt error: ${validation.error}`);
        results.push({ label: test.label, valid: false, reason: validation.error });
        continue;
      }
      
      console.log(`     First byte after decrypt: ${validation.firstByte}`);
      console.log(`     First 4 bytes: ${validation.first4Hex}`);
      console.log(`     TS sync bytes found: ${validation.syncCount}/10`);
      
      if (validation.valid) {
        console.log(`     ✅ REAL KEY — decrypts to valid MPEG-TS (0x47 sync byte)`);
      } else {
        console.log(`     ❌ FAKE KEY — first byte ${validation.firstByte} ≠ 0x47`);
        console.log(`     First 16 decrypted: ${validation.first16Hex}`);
      }
      
      results.push({ label: test.label, valid: validation.valid, keyHex, syncCount: validation.syncCount });
    } catch (e) {
      console.log(`     ❌ Error: ${e.message}`);
      results.push({ label: test.label, valid: false, reason: e.message });
    }
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  for (const r of results) {
    const icon = r.valid ? '✅' : '❌';
    console.log(`  ${icon} ${r.label} — ${r.valid ? 'REAL' : 'FAKE'} ${r.keyHex ? `(${r.keyHex})` : `(${r.reason})`}`);
  }
  
  const anyReal = results.some(r => r.valid);
  console.log(`\n${anyReal ? '✅ At least one source returns REAL keys' : '❌ ALL sources return FAKE keys — reCAPTCHA whitelist IS required'}`);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
