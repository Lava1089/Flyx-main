#!/usr/bin/env node
/**
 * Test decrypting a segment manually to verify key/IV
 */

const http = require('http');
const crypto = require('crypto');

const API_URL = 'http://127.0.0.1:8787';
const API_KEY = 'test';

function fetch(url, headers = {}) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const req = http.request({
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: { 'X-API-Key': API_KEY, ...headers },
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const data = Buffer.concat(chunks);
        resolve({ status: res.statusCode, data, headers: res.headers });
      });
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.end();
  });
}

async function main() {
  console.log('═'.repeat(70));
  console.log('TEST SEGMENT DECRYPTION');
  console.log('═'.repeat(70));
  
  // Step 1: Get stream URL
  console.log('\n1. Getting stream URL...');
  const streamRes = await fetch(`${API_URL}/stream/31`);
  const streamData = JSON.parse(streamRes.data.toString());
  
  // Step 2: Fetch M3U8
  console.log('\n2. Fetching M3U8...');
  const m3u8Url = streamData.streamUrl + '&key=' + API_KEY;
  const m3u8Res = await fetch(m3u8Url);
  const m3u8Content = m3u8Res.data.toString();
  
  // Step 3: Extract key URL, IV, and first segment URL
  const lines = m3u8Content.split('\n');
  let keyUrl = null;
  let iv = null;
  let segmentUrl = null;
  let mediaSequence = 0;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    if (trimmed.includes('#EXT-X-MEDIA-SEQUENCE')) {
      const match = trimmed.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/);
      if (match) mediaSequence = parseInt(match[1]);
    }
    
    if (trimmed.includes('#EXT-X-KEY')) {
      const uriMatch = trimmed.match(/URI="([^"]+)"/);
      if (uriMatch) keyUrl = uriMatch[1];
      
      const ivMatch = trimmed.match(/IV=0x([0-9a-fA-F]+)/i);
      if (ivMatch) iv = ivMatch[1];
    }
    
    if (!segmentUrl && trimmed.startsWith('http') && trimmed.includes('/live/ts')) {
      segmentUrl = trimmed;
    }
  }
  
  console.log(`   Media Sequence: ${mediaSequence}`);
  console.log(`   Key URL: ${keyUrl ? 'found' : 'not found'}`);
  console.log(`   IV: ${iv || 'not found (will use media sequence)'}`);
  console.log(`   Segment URL: ${segmentUrl ? 'found' : 'not found'}`);
  
  // Step 4: Fetch key
  console.log('\n3. Fetching key...');
  const keyRes = await fetch(keyUrl);
  const key = keyRes.data;
  console.log(`   Key: ${key.toString('hex')}`);
  
  // Step 5: Fetch encrypted segment
  console.log('\n4. Fetching encrypted segment...');
  const segmentRes = await fetch(segmentUrl);
  const encryptedData = segmentRes.data;
  console.log(`   Encrypted size: ${encryptedData.length} bytes`);
  console.log(`   First 16 bytes (encrypted): ${encryptedData.slice(0, 16).toString('hex')}`);
  
  // Step 6: Decrypt segment
  console.log('\n5. Decrypting segment...');
  
  // If IV is not provided, use media sequence number
  let ivBuffer;
  if (iv) {
    ivBuffer = Buffer.from(iv, 'hex');
    console.log(`   Using IV from M3U8: ${ivBuffer.toString('hex')}`);
  } else {
    // Use media sequence as IV (big-endian 16-byte integer)
    ivBuffer = Buffer.alloc(16);
    ivBuffer.writeUInt32BE(mediaSequence, 12);
    console.log(`   Using media sequence as IV: ${ivBuffer.toString('hex')}`);
  }
  
  // Check if data is actually encrypted (should be multiple of 16)
  console.log(`   Data length: ${encryptedData.length}`);
  console.log(`   Is multiple of 16: ${encryptedData.length % 16 === 0}`);
  
  // Try different decryption approaches
  const approaches = [
    { name: 'Standard AES-128-CBC with M3U8 IV', iv: ivBuffer, padding: true },
    { name: 'AES-128-CBC with zero IV', iv: Buffer.alloc(16, 0), padding: true },
    { name: 'AES-128-CBC with media seq IV', iv: (() => { const b = Buffer.alloc(16, 0); b.writeUInt32BE(mediaSequence, 12); return b; })(), padding: true },
    { name: 'AES-128-CBC no padding', iv: ivBuffer, padding: false },
  ];
  
  for (const approach of approaches) {
    console.log(`\n   Trying: ${approach.name}`);
    console.log(`   IV: ${approach.iv.toString('hex')}`);
    
    try {
      const decipher = crypto.createDecipheriv('aes-128-cbc', key, approach.iv);
      decipher.setAutoPadding(approach.padding);
      
      const decrypted = Buffer.concat([
        decipher.update(encryptedData),
        decipher.final()
      ]);
      
      console.log(`   Decrypted size: ${decrypted.length} bytes`);
      console.log(`   First 16 bytes: ${decrypted.slice(0, 16).toString('hex')}`);
      
      if (decrypted[0] === 0x47) {
        console.log(`   ✅ SUCCESS! MPEG-TS sync byte found!`);
        
        // Verify more sync bytes
        let syncCount = 0;
        for (let i = 0; i < Math.min(decrypted.length, 10 * 188); i += 188) {
          if (decrypted[i] === 0x47) syncCount++;
        }
        console.log(`   Found ${syncCount}/10 sync bytes`);
        break;
      } else {
        console.log(`   ❌ First byte is 0x${decrypted[0].toString(16)}`);
      }
    } catch (err) {
      console.log(`   ❌ Error: ${err.message}`);
    }
  }
  
  // Check if data might not be encrypted at all
  console.log('\n6. Checking if data might be unencrypted or different format...');
  console.log(`   First 32 bytes raw: ${encryptedData.slice(0, 32).toString('hex')}`);
  
  // Check for common video signatures
  const signatures = {
    'MPEG-TS (0x47)': encryptedData[0] === 0x47,
    'ftyp (MP4)': encryptedData.slice(4, 8).toString() === 'ftyp',
    'FLV': encryptedData.slice(0, 3).toString() === 'FLV',
    'WebM': encryptedData.slice(0, 4).toString('hex') === '1a45dfa3',
  };
  
  for (const [name, match] of Object.entries(signatures)) {
    if (match) console.log(`   ✅ Matches ${name} signature`);
  }
}

main().catch(console.error);
