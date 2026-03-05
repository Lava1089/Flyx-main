#!/usr/bin/env node
/**
 * Try different IV approaches to decrypt segment
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

function tryDecrypt(data, key, iv, name) {
  try {
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    
    // Check for MPEG-TS sync byte
    if (decrypted[0] === 0x47) {
      // Verify more sync bytes
      let syncCount = 0;
      for (let i = 0; i < Math.min(decrypted.length, 20 * 188); i += 188) {
        if (decrypted[i] === 0x47) syncCount++;
      }
      console.log(`   ✅ ${name}: First byte 0x47, ${syncCount}/20 sync bytes`);
      return true;
    } else {
      console.log(`   ❌ ${name}: First byte 0x${decrypted[0].toString(16)}`);
      return false;
    }
  } catch (e) {
    console.log(`   ❌ ${name}: ${e.message}`);
    return false;
  }
}

async function main() {
  console.log('═'.repeat(70));
  console.log('BRUTE FORCE IV');
  console.log('═'.repeat(70));
  
  // Get stream data
  const streamRes = await fetchLocal(`${API_URL}/stream/31`);
  const streamData = JSON.parse(streamRes.data.toString());
  
  const m3u8Res = await fetchLocal(streamData.streamUrl + '&key=' + API_KEY);
  const m3u8Content = m3u8Res.data.toString();
  
  // Parse M3U8
  const lines = m3u8Content.split('\n');
  let mediaSequence = 0;
  let keyUrl = null;
  let ivFromM3u8 = null;
  let segmentUrl = null;
  let segmentIndex = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (line.includes('#EXT-X-MEDIA-SEQUENCE')) {
      const match = line.match(/:(\d+)/);
      if (match) mediaSequence = parseInt(match[1]);
    }
    
    if (line.includes('#EXT-X-KEY')) {
      const uriMatch = line.match(/URI="([^"]+)"/);
      if (uriMatch) keyUrl = uriMatch[1];
      
      const ivMatch = line.match(/IV=0x([0-9a-fA-F]+)/i);
      if (ivMatch) ivFromM3u8 = ivMatch[1];
    }
    
    if (!segmentUrl && line.startsWith('http') && line.includes('/live/ts')) {
      segmentUrl = line;
    }
  }
  
  console.log(`\nMedia Sequence: ${mediaSequence}`);
  console.log(`IV from M3U8: ${ivFromM3u8}`);
  console.log(`IV as ASCII: ${Buffer.from(ivFromM3u8, 'hex').toString()}`);
  
  // Fetch key and segment
  const keyRes = await fetchLocal(keyUrl);
  const key = keyRes.data;
  console.log(`Key: ${key.toString('hex')}`);
  
  const segRes = await fetchLocal(segmentUrl);
  const segment = segRes.data;
  console.log(`Segment size: ${segment.length}`);
  
  console.log('\nTrying different IVs:');
  
  // 1. IV from M3U8 as-is
  tryDecrypt(segment, key, Buffer.from(ivFromM3u8, 'hex'), 'M3U8 IV as-is');
  
  // 2. Zero IV
  tryDecrypt(segment, key, Buffer.alloc(16, 0), 'Zero IV');
  
  // 3. Media sequence as IV
  const seqIv = Buffer.alloc(16, 0);
  seqIv.writeUInt32BE(mediaSequence, 12);
  tryDecrypt(segment, key, seqIv, `Media seq (${mediaSequence})`);
  
  // 4. First segment index (mediaSequence + 0)
  const seg0Iv = Buffer.alloc(16, 0);
  seg0Iv.writeUInt32BE(mediaSequence, 12);
  tryDecrypt(segment, key, seg0Iv, `Segment 0 (${mediaSequence})`);
  
  // 5. Try IV as the last 4 bytes of the M3U8 IV (looks like it might be a counter)
  const lastBytes = ivFromM3u8.slice(-8);
  console.log(`   Last 4 bytes of IV: ${lastBytes}`);
  const counterIv = Buffer.alloc(16, 0);
  counterIv.write(lastBytes, 12, 'hex');
  tryDecrypt(segment, key, counterIv, 'Last 4 bytes as counter');
  
  // 6. Try the IV interpreted differently - maybe it's hex-encoded ASCII?
  const ivAscii = Buffer.from(ivFromM3u8, 'hex').toString();
  console.log(`   IV as ASCII: "${ivAscii}"`);
  
  // 7. Try with key as IV (some weird implementations do this)
  tryDecrypt(segment, key, key, 'Key as IV');
  
  // 8. Try first 16 bytes of segment as IV (for CTR mode emulation)
  tryDecrypt(segment.slice(16), key, segment.slice(0, 16), 'First 16 bytes as IV');
  
  // 9. Maybe they XOR the IV with something?
  const xorIv = Buffer.from(ivFromM3u8, 'hex');
  for (let i = 0; i < 16; i++) xorIv[i] ^= key[i];
  tryDecrypt(segment, key, xorIv, 'IV XOR key');
  
  // 10. Try segment number from URL
  // The URL has a hex-encoded path, let's see if there's a segment number in it
  console.log('\n   Checking segment URL for embedded sequence...');
  
  // 11. Maybe the IV is per-segment and increments?
  // The IV ends with "697a9737" - let's try nearby values
  const baseIv = Buffer.from(ivFromM3u8, 'hex');
  for (let offset = -5; offset <= 5; offset++) {
    const testIv = Buffer.from(baseIv);
    const lastVal = testIv.readUInt32BE(12);
    testIv.writeUInt32BE(lastVal + offset, 12);
    if (tryDecrypt(segment, key, testIv, `IV offset ${offset}`)) break;
  }
}

main().catch(console.error);
