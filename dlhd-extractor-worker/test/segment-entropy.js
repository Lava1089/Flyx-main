#!/usr/bin/env node
/**
 * Deep analysis of segment data structure
 */

const https = require('https');
const crypto = require('crypto');

function fetchHttps(url, headers = {}) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
        'Origin': 'https://hitsplay.fun',
        'Referer': 'https://hitsplay.fun/',
        ...headers,
      },
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, data: Buffer.concat(chunks), headers: res.headers }));
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.end();
  });
}

function calculateEntropy(data) {
  const freq = new Array(256).fill(0);
  for (const byte of data) {
    freq[byte]++;
  }
  
  let entropy = 0;
  const len = data.length;
  for (const count of freq) {
    if (count > 0) {
      const p = count / len;
      entropy -= p * Math.log2(p);
    }
  }
  return entropy;
}

async function main() {
  console.log('═'.repeat(70));
  console.log('SEGMENT ENTROPY AND STRUCTURE ANALYSIS');
  console.log('═'.repeat(70));
  
  // Get M3U8
  console.log('\n1. Fetching M3U8...');
  const lookupRes = await fetchHttps('https://chevy.dvalna.ru/server_lookup?channel_id=premium31');
  const lookupData = JSON.parse(lookupRes.data.toString());
  const sk = lookupData.server_key;
  const m3u8Url = `https://${sk}new.dvalna.ru/${sk}/premium31/mono.css`;
  
  const m3u8Res = await fetchHttps(m3u8Url);
  const m3u8Content = m3u8Res.data.toString();
  
  // Parse M3U8
  let keyUrl = null;
  let ivHex = null;
  let segmentUrls = [];
  
  for (const line of m3u8Content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.includes('#EXT-X-KEY')) {
      const uriMatch = trimmed.match(/URI="([^"]+)"/);
      if (uriMatch) keyUrl = uriMatch[1];
      const ivMatch = trimmed.match(/IV=0x([0-9a-fA-F]+)/i);
      if (ivMatch) ivHex = ivMatch[1];
    }
    if (trimmed.startsWith('http') && !trimmed.startsWith('#')) {
      segmentUrls.push(trimmed);
    }
  }
  
  // Fetch key
  const keyRes = await fetchHttps(keyUrl);
  const key = keyRes.data;
  console.log(`   Key: ${key.toString('hex')}`);
  console.log(`   IV: ${ivHex}`);
  
  // Fetch first segment
  console.log('\n2. Fetching segment...');
  let segment;
  const segRes = await fetchHttps(segmentUrls[0]);
  
  if (segRes.status === 302) {
    const redirectUrl = segRes.headers.location;
    const segRes2 = await fetchHttps(redirectUrl);
    segment = segRes2.data;
  } else {
    segment = segRes.data;
  }
  
  console.log(`   Size: ${segment.length} bytes`);
  
  // Entropy analysis
  console.log('\n3. Entropy Analysis:');
  const fullEntropy = calculateEntropy(segment);
  console.log(`   Full segment entropy: ${fullEntropy.toFixed(4)} bits/byte`);
  
  // Check entropy of different sections
  const sections = [
    { name: 'First 1KB', data: segment.slice(0, 1024) },
    { name: 'First 16 bytes', data: segment.slice(0, 16) },
    { name: 'Bytes 16-32', data: segment.slice(16, 32) },
    { name: 'Bytes 32-48', data: segment.slice(32, 48) },
    { name: 'First 188 bytes', data: segment.slice(0, 188) },
    { name: 'Second 188 bytes', data: segment.slice(188, 376) },
    { name: 'Last 1KB', data: segment.slice(-1024) },
  ];
  
  for (const section of sections) {
    const entropy = calculateEntropy(section.data);
    console.log(`   ${section.name}: ${entropy.toFixed(4)} bits/byte`);
  }
  
  // Check for patterns
  console.log('\n4. Pattern Analysis:');
  
  // Check if first 16 bytes repeat
  const first16 = segment.slice(0, 16).toString('hex');
  let repeatCount = 0;
  for (let i = 0; i < Math.min(segment.length, 10000); i += 16) {
    if (segment.slice(i, i + 16).toString('hex') === first16) {
      repeatCount++;
    }
  }
  console.log(`   First 16 bytes repeat count: ${repeatCount}`);
  
  // Check for MPEG-TS patterns in raw data
  console.log('\n5. Looking for 0x47 sync bytes in raw data:');
  let syncPositions = [];
  for (let i = 0; i < Math.min(segment.length, 2000); i++) {
    if (segment[i] === 0x47) {
      syncPositions.push(i);
    }
  }
  console.log(`   Found ${syncPositions.length} 0x47 bytes in first 2KB`);
  if (syncPositions.length > 0) {
    console.log(`   Positions: ${syncPositions.slice(0, 20).join(', ')}...`);
    
    // Check spacing
    if (syncPositions.length > 1) {
      const spacings = [];
      for (let i = 1; i < Math.min(syncPositions.length, 10); i++) {
        spacings.push(syncPositions[i] - syncPositions[i-1]);
      }
      console.log(`   Spacings: ${spacings.join(', ')}`);
    }
  }
  
  // Try to find the encryption block boundary
  console.log('\n6. Block boundary analysis:');
  const iv = Buffer.from(ivHex, 'hex');
  
  // Try decrypting at different offsets
  for (let offset = 0; offset <= 512; offset += 16) {
    try {
      const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
      decipher.setAutoPadding(false);
      const chunk = segment.slice(offset, offset + 1024);
      if (chunk.length < 1024) continue;
      
      const decrypted = Buffer.concat([decipher.update(chunk), decipher.final()]);
      
      // Check for MPEG-TS sync
      let syncCount = 0;
      for (let i = 0; i < decrypted.length; i += 188) {
        if (decrypted[i] === 0x47) syncCount++;
      }
      
      if (syncCount > 0 || decrypted[0] === 0x47) {
        console.log(`   Offset ${offset}: First byte 0x${decrypted[0].toString(16)}, sync count: ${syncCount}`);
      }
    } catch (e) {
      // Silent fail
    }
  }
  
  // Check if segment is XORed instead of AES encrypted
  console.log('\n7. XOR analysis:');
  
  // XOR first 188 bytes with key (repeated)
  const xorWithKey = Buffer.alloc(188);
  for (let i = 0; i < 188; i++) {
    xorWithKey[i] = segment[i] ^ key[i % 16];
  }
  console.log(`   XOR with key - first byte: 0x${xorWithKey[0].toString(16)}`);
  
  // Check for 0x47 at 188-byte intervals
  let xorSyncCount = 0;
  for (let i = 0; i < 188 * 10; i += 188) {
    const xorByte = segment[i] ^ key[i % 16];
    if (xorByte === 0x47) xorSyncCount++;
  }
  console.log(`   XOR sync bytes: ${xorSyncCount}/10`);
  
  // XOR with IV
  const xorWithIv = Buffer.alloc(188);
  for (let i = 0; i < 188; i++) {
    xorWithIv[i] = segment[i] ^ iv[i % 16];
  }
  console.log(`   XOR with IV - first byte: 0x${xorWithIv[0].toString(16)}`);
  
  // Check byte distribution
  console.log('\n8. Byte distribution:');
  const freq = new Array(256).fill(0);
  for (const byte of segment.slice(0, 10000)) {
    freq[byte]++;
  }
  
  const sorted = freq.map((count, byte) => ({ byte, count }))
    .filter(x => x.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  
  console.log('   Top 10 bytes:');
  for (const { byte, count } of sorted) {
    console.log(`   0x${byte.toString(16).padStart(2, '0')}: ${count} (${(count/100).toFixed(1)}%)`);
  }
}

main().catch(console.error);
