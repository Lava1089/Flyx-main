#!/usr/bin/env node
/**
 * Deep analysis of the encryption scheme
 */

const http = require('http');
const crypto = require('crypto');

const API_URL = 'http://127.0.0.1:8787';
const API_KEY = 'test';

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

async function main() {
  console.log('═'.repeat(70));
  console.log('DEEP ENCRYPTION ANALYSIS');
  console.log('═'.repeat(70));
  
  // Get stream data
  const streamRes = await fetchLocal(`${API_URL}/stream/31`);
  const streamData = JSON.parse(streamRes.data.toString());
  
  const m3u8Res = await fetchLocal(streamData.streamUrl + '&key=' + API_KEY);
  const m3u8Content = m3u8Res.data.toString();
  
  // Parse M3U8
  const lines = m3u8Content.split('\n');
  let keyUrl = null;
  let ivFromM3u8 = null;
  let segmentUrls = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    if (trimmed.includes('#EXT-X-KEY')) {
      const uriMatch = trimmed.match(/URI="([^"]+)"/);
      if (uriMatch) keyUrl = uriMatch[1];
      
      const ivMatch = trimmed.match(/IV=0x([0-9a-fA-F]+)/i);
      if (ivMatch) ivFromM3u8 = ivMatch[1];
      
      console.log('\nKEY TAG:', trimmed.substring(0, 200));
    }
    
    if (trimmed.startsWith('http') && trimmed.includes('/live/ts')) {
      segmentUrls.push(trimmed);
    }
  }
  
  // Fetch key
  const keyRes = await fetchLocal(keyUrl);
  const key = keyRes.data;
  
  console.log('\n1. KEY ANALYSIS:');
  console.log(`   Raw bytes: ${key.toString('hex')}`);
  console.log(`   As ASCII: "${key.toString('ascii').replace(/[^\x20-\x7e]/g, '.')}"`);
  console.log(`   Length: ${key.length} bytes`);
  
  // Check if key might be base64
  const keyStr = key.toString();
  if (/^[A-Za-z0-9+/=]+$/.test(keyStr)) {
    console.log('   Key looks like base64, trying to decode...');
    try {
      const decoded = Buffer.from(keyStr, 'base64');
      console.log(`   Decoded: ${decoded.toString('hex')}`);
    } catch (e) {}
  }
  
  console.log('\n2. IV ANALYSIS:');
  console.log(`   Raw hex: ${ivFromM3u8}`);
  const ivBuffer = Buffer.from(ivFromM3u8, 'hex');
  console.log(`   As ASCII: "${ivBuffer.toString('ascii').replace(/[^\x20-\x7e]/g, '.')}"`);
  console.log(`   Length: ${ivBuffer.length} bytes`);
  
  // The IV looks like "000000000000" + something
  // Let's analyze the pattern
  const ivPrefix = ivFromM3u8.substring(0, 24); // First 12 bytes
  const ivSuffix = ivFromM3u8.substring(24);    // Last 4 bytes
  console.log(`   Prefix (12 bytes): ${ivPrefix} = "${Buffer.from(ivPrefix, 'hex').toString()}"`);
  console.log(`   Suffix (4 bytes): ${ivSuffix} = 0x${ivSuffix} = ${parseInt(ivSuffix, 16)}`);
  
  // Fetch multiple segments to compare
  console.log('\n3. SEGMENT ANALYSIS:');
  
  for (let i = 0; i < Math.min(3, segmentUrls.length); i++) {
    const segRes = await fetchLocal(segmentUrls[i]);
    const seg = segRes.data;
    
    console.log(`\n   Segment ${i}:`);
    console.log(`   Size: ${seg.length} bytes`);
    console.log(`   First 32 bytes: ${seg.slice(0, 32).toString('hex')}`);
    console.log(`   Last 32 bytes: ${seg.slice(-32).toString('hex')}`);
    
    // Check entropy (encrypted data should have high entropy)
    const byteFreq = new Array(256).fill(0);
    for (const b of seg) byteFreq[b]++;
    let entropy = 0;
    for (const freq of byteFreq) {
      if (freq > 0) {
        const p = freq / seg.length;
        entropy -= p * Math.log2(p);
      }
    }
    console.log(`   Entropy: ${entropy.toFixed(4)} bits/byte (max 8.0, encrypted ~7.9+)`);
    
    // Check if first bytes are consistent across segments (might indicate header)
    if (i === 0) {
      console.log(`   First byte pattern: 0x${seg[0].toString(16)}`);
    }
  }
  
  // Try to find patterns
  console.log('\n4. PATTERN ANALYSIS:');
  
  // Maybe the encryption is XOR-based?
  const seg0 = (await fetchLocal(segmentUrls[0])).data;
  
  // XOR first 16 bytes with key
  const xorResult = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) {
    xorResult[i] = seg0[i] ^ key[i];
  }
  console.log(`   First 16 bytes XOR key: ${xorResult.toString('hex')}`);
  
  // XOR with IV
  const xorIvResult = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) {
    xorIvResult[i] = seg0[i] ^ ivBuffer[i];
  }
  console.log(`   First 16 bytes XOR IV: ${xorIvResult.toString('hex')}`);
  
  // Check if maybe it's SAMPLE-AES (only encrypts certain bytes)
  console.log('\n5. SAMPLE-AES CHECK:');
  // In SAMPLE-AES, only the first 16 bytes of each 188-byte packet are encrypted
  // after the 4-byte header
  let possibleSampleAes = true;
  for (let i = 0; i < Math.min(seg0.length, 10 * 188); i += 188) {
    // Check if byte at position i (should be 0x47 sync byte) is encrypted
    if (seg0[i] !== 0x47) {
      // Might be encrypted
    }
  }
  console.log(`   Sync bytes at 188-byte intervals: ${[0, 188, 376, 564, 752].map(i => '0x' + seg0[i]?.toString(16)).join(', ')}`);
  
  // Maybe they're using a different cipher?
  console.log('\n6. TRYING DIFFERENT CIPHERS:');
  
  const ciphers = ['aes-128-ctr', 'aes-128-ecb', 'aes-128-cfb', 'aes-128-ofb'];
  
  for (const cipher of ciphers) {
    try {
      let decipher;
      if (cipher === 'aes-128-ecb') {
        decipher = crypto.createDecipheriv(cipher, key, null);
      } else {
        decipher = crypto.createDecipheriv(cipher, key, ivBuffer);
      }
      decipher.setAutoPadding(false);
      
      const decrypted = Buffer.concat([decipher.update(seg0.slice(0, 1024)), decipher.final()]);
      
      if (decrypted[0] === 0x47) {
        console.log(`   ✅ ${cipher}: First byte is 0x47!`);
      } else {
        console.log(`   ❌ ${cipher}: First byte is 0x${decrypted[0].toString(16)}`);
      }
    } catch (e) {
      console.log(`   ❌ ${cipher}: ${e.message}`);
    }
  }
}

main().catch(console.error);
