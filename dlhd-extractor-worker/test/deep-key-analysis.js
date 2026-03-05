#!/usr/bin/env node
/**
 * Deep analysis of key transformation
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');

const API_URL = 'http://127.0.0.1:8787';
const API_KEY = 'test';

// The secret key from WASM
const SECRET_KEY = '444c44cc8888888844444444';
const SECRET_KEY_BYTES = Buffer.from(SECRET_KEY, 'hex');

function fetchLocal(url) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const req = http.request({
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: { 'X-API-Key': API_KEY },
      timeout: 60000,
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, data: Buffer.concat(chunks) }));
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.end();
  });
}

function tryDecrypt(segment, key, iv, name) {
  try {
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(segment.slice(0, 2048)), decipher.final()]);
    
    // Check for MPEG-TS sync bytes
    let syncCount = 0;
    for (let i = 0; i < Math.min(decrypted.length, 10 * 188); i += 188) {
      if (decrypted[i] === 0x47) syncCount++;
    }
    
    if (syncCount >= 5) {
      console.log(`   ✅ ${name}: ${syncCount}/10 sync bytes!`);
      return true;
    } else if (decrypted[0] === 0x47) {
      console.log(`   ⚠️  ${name}: First byte 0x47 but only ${syncCount} sync bytes`);
      return false;
    }
    return false;
  } catch (e) {
    return false;
  }
}

async function main() {
  console.log('═'.repeat(70));
  console.log('DEEP KEY ANALYSIS');
  console.log('═'.repeat(70));
  
  // Get data
  const streamRes = await fetchLocal(`${API_URL}/stream/31`);
  const streamData = JSON.parse(streamRes.data.toString());
  
  const m3u8Res = await fetchLocal(streamData.streamUrl + '&key=' + API_KEY);
  const m3u8Content = m3u8Res.data.toString();
  
  // Parse M3U8
  let keyUrl = null;
  let ivHex = null;
  let segmentUrl = null;
  
  for (const line of m3u8Content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.includes('#EXT-X-KEY')) {
      const uriMatch = trimmed.match(/URI="([^"]+)"/);
      if (uriMatch) keyUrl = uriMatch[1];
      const ivMatch = trimmed.match(/IV=0x([0-9a-fA-F]+)/i);
      if (ivMatch) ivHex = ivMatch[1];
    }
    if (!segmentUrl && trimmed.startsWith('http') && trimmed.includes('/live/ts')) {
      segmentUrl = trimmed;
    }
  }
  
  // Fetch key and segment
  const keyRes = await fetchLocal(keyUrl);
  const key = keyRes.data;
  const segRes = await fetchLocal(segmentUrl);
  const segment = segRes.data;
  const iv = Buffer.from(ivHex, 'hex');
  
  console.log(`\nKey: ${key.toString('hex')}`);
  console.log(`IV: ${ivHex}`);
  console.log(`Secret: ${SECRET_KEY}`);
  console.log(`Segment: ${segment.length} bytes`);
  
  console.log('\n1. KEY TRANSFORMATIONS:');
  
  // Try various key transformations
  const transformations = [];
  
  // Original key
  transformations.push({ name: 'Original key', key: key });
  
  // XOR with secret key (repeating)
  const xorSecret = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) {
    xorSecret[i] = key[i] ^ SECRET_KEY_BYTES[i % SECRET_KEY_BYTES.length];
  }
  transformations.push({ name: 'Key XOR Secret', key: xorSecret });
  
  // XOR with IV
  const xorIv = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) {
    xorIv[i] = key[i] ^ iv[i];
  }
  transformations.push({ name: 'Key XOR IV', key: xorIv });
  
  // Secret key as decryption key
  if (SECRET_KEY_BYTES.length >= 16) {
    transformations.push({ name: 'Secret key only', key: SECRET_KEY_BYTES.slice(0, 16) });
  }
  
  // MD5 of key
  const md5Key = crypto.createHash('md5').update(key).digest();
  transformations.push({ name: 'MD5(key)', key: md5Key });
  
  // MD5 of key + secret
  const md5KeySecret = crypto.createHash('md5').update(Buffer.concat([key, SECRET_KEY_BYTES])).digest();
  transformations.push({ name: 'MD5(key+secret)', key: md5KeySecret });
  
  // SHA256 of key (first 16 bytes)
  const sha256Key = crypto.createHash('sha256').update(key).digest().slice(0, 16);
  transformations.push({ name: 'SHA256(key)[0:16]', key: sha256Key });
  
  // Reverse key
  const reverseKey = Buffer.from([...key].reverse());
  transformations.push({ name: 'Reversed key', key: reverseKey });
  
  // Byte swap pairs
  const swapKey = Buffer.alloc(16);
  for (let i = 0; i < 16; i += 2) {
    swapKey[i] = key[i + 1];
    swapKey[i + 1] = key[i];
  }
  transformations.push({ name: 'Byte-swapped key', key: swapKey });
  
  // Try each transformation with different IVs
  const ivVariants = [
    { name: 'M3U8 IV', iv: iv },
    { name: 'Zero IV', iv: Buffer.alloc(16, 0) },
    { name: 'Key as IV', iv: key },
    { name: 'Secret as IV', iv: Buffer.concat([SECRET_KEY_BYTES, Buffer.alloc(16 - SECRET_KEY_BYTES.length, 0)]).slice(0, 16) },
  ];
  
  for (const t of transformations) {
    for (const v of ivVariants) {
      if (tryDecrypt(segment, t.key, v.iv, `${t.name} + ${v.name}`)) {
        console.log(`\n   FOUND WORKING COMBINATION!`);
        console.log(`   Key: ${t.key.toString('hex')}`);
        console.log(`   IV: ${v.iv.toString('hex')}`);
        return;
      }
    }
  }
  
  console.log('\n2. ANALYZING SEGMENT STRUCTURE:');
  
  // Check if segment has a custom header
  console.log(`   First 64 bytes: ${segment.slice(0, 64).toString('hex')}`);
  
  // Check for patterns
  const first16 = segment.slice(0, 16);
  const second16 = segment.slice(16, 32);
  
  // XOR first two blocks
  const xorBlocks = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) {
    xorBlocks[i] = first16[i] ^ second16[i];
  }
  console.log(`   First 16 XOR Second 16: ${xorBlocks.toString('hex')}`);
  
  // Check if first block might be IV
  console.log('\n3. TRYING FIRST BLOCK AS IV:');
  for (const t of transformations.slice(0, 5)) {
    if (tryDecrypt(segment.slice(16), t.key, first16, `${t.name} + First16AsIV`)) {
      console.log(`   FOUND!`);
      return;
    }
  }
  
  // Check if there's a pattern in the encrypted data
  console.log('\n4. CHECKING FOR REPEATING PATTERNS:');
  const blockSize = 16;
  const blocks = [];
  for (let i = 0; i < Math.min(segment.length, 1024); i += blockSize) {
    blocks.push(segment.slice(i, i + blockSize).toString('hex'));
  }
  
  // Find duplicate blocks (would indicate ECB mode)
  const uniqueBlocks = new Set(blocks);
  console.log(`   ${blocks.length} blocks, ${uniqueBlocks.size} unique`);
  if (uniqueBlocks.size < blocks.length) {
    console.log(`   ⚠️  Duplicate blocks found - might be ECB mode!`);
    
    // Try ECB
    try {
      const decipher = crypto.createDecipheriv('aes-128-ecb', key, null);
      decipher.setAutoPadding(false);
      const decrypted = Buffer.concat([decipher.update(segment.slice(0, 2048)), decipher.final()]);
      
      if (decrypted[0] === 0x47) {
        console.log(`   ✅ ECB MODE WORKS!`);
      }
    } catch (e) {}
  }
  
  console.log('\n5. CHECKING IV PATTERN:');
  // The IV looks like "000000000000" + 4 bytes
  // Maybe the 4 bytes are a counter or segment number?
  const ivPrefix = ivHex.substring(0, 24);
  const ivSuffix = ivHex.substring(24);
  console.log(`   IV prefix: ${ivPrefix} (${Buffer.from(ivPrefix, 'hex').toString()})`);
  console.log(`   IV suffix: ${ivSuffix} (decimal: ${parseInt(ivSuffix, 16)})`);
  
  // The suffix might be related to segment URL
  // Let's check if it's in the segment URL
  console.log(`   Segment URL contains suffix: ${segmentUrl.includes(ivSuffix)}`);
  
  console.log('\n   No working combination found.');
}

main().catch(console.error);
