#!/usr/bin/env node
/**
 * Test fetching actual segments through the proxy
 */

const http = require('http');

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
  console.log('TEST SEGMENT FETCHING');
  console.log('═'.repeat(70));
  
  // Step 1: Get stream URL
  console.log('\n1. Getting stream URL...');
  const streamRes = await fetch(`${API_URL}/stream/31`);
  
  if (streamRes.error || streamRes.status !== 200) {
    console.log(`   ❌ Failed: ${streamRes.error || streamRes.status}`);
    return;
  }
  
  const streamData = JSON.parse(streamRes.data.toString());
  console.log(`   ✅ Got stream URL`);
  
  // Step 2: Fetch M3U8
  console.log('\n2. Fetching M3U8...');
  const m3u8Url = streamData.streamUrl + '&key=' + API_KEY;
  const m3u8Res = await fetch(m3u8Url);
  
  if (m3u8Res.error || m3u8Res.status !== 200) {
    console.log(`   ❌ Failed: ${m3u8Res.error || m3u8Res.status}`);
    return;
  }
  
  const m3u8Content = m3u8Res.data.toString();
  console.log(`   ✅ Got M3U8 (${m3u8Content.length} bytes)`);
  
  // Step 3: Extract key URL and first segment URL
  const lines = m3u8Content.split('\n');
  let keyUrl = null;
  let segmentUrls = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Extract key URL
    if (trimmed.includes('#EXT-X-KEY')) {
      const uriMatch = trimmed.match(/URI="([^"]+)"/);
      if (uriMatch) {
        keyUrl = uriMatch[1];
      }
    }
    
    // Extract segment URLs
    if (trimmed.startsWith('http') && trimmed.includes('/live/ts')) {
      segmentUrls.push(trimmed);
    }
  }
  
  console.log(`   Found key URL: ${keyUrl ? 'yes' : 'no'}`);
  console.log(`   Found ${segmentUrls.length} segment URLs`);
  
  // Step 4: Test key fetch
  if (keyUrl) {
    console.log('\n3. Testing key fetch...');
    const keyRes = await fetch(keyUrl);
    
    if (keyRes.error) {
      console.log(`   ❌ Key fetch error: ${keyRes.error}`);
    } else {
      console.log(`   Status: ${keyRes.status}`);
      console.log(`   Content-Type: ${keyRes.headers['content-type']}`);
      console.log(`   Content-Length: ${keyRes.data.length} bytes`);
      
      if (keyRes.status === 200 && keyRes.data.length === 16) {
        console.log(`   ✅ Key looks valid (16 bytes AES-128 key)`);
        console.log(`   Key hex: ${keyRes.data.toString('hex')}`);
      } else if (keyRes.status === 200) {
        console.log(`   ⚠️  Key returned but unexpected size`);
        console.log(`   First 32 bytes: ${keyRes.data.slice(0, 32).toString('hex')}`);
      } else {
        console.log(`   ❌ Key fetch failed with status ${keyRes.status}`);
        console.log(`   Response: ${keyRes.data.toString().substring(0, 200)}`);
      }
    }
  }
  
  // Step 5: Test first segment fetch
  if (segmentUrls.length > 0) {
    console.log('\n4. Testing first segment fetch...');
    const segmentUrl = segmentUrls[0];
    console.log(`   URL: ${segmentUrl.substring(0, 80)}...`);
    
    const startTime = Date.now();
    const segmentRes = await fetch(segmentUrl);
    const elapsed = Date.now() - startTime;
    
    if (segmentRes.error) {
      console.log(`   ❌ Segment fetch error: ${segmentRes.error}`);
    } else {
      console.log(`   Status: ${segmentRes.status}`);
      console.log(`   Content-Type: ${segmentRes.headers['content-type']}`);
      console.log(`   Content-Length: ${segmentRes.data.length} bytes`);
      console.log(`   Time: ${elapsed}ms`);
      
      if (segmentRes.status === 200 && segmentRes.data.length > 0) {
        // Check for MPEG-TS sync byte (0x47)
        const syncByte = segmentRes.data[0];
        if (syncByte === 0x47) {
          console.log(`   ✅ Valid MPEG-TS segment (starts with sync byte 0x47)`);
        } else {
          console.log(`   ⚠️  First byte is 0x${syncByte.toString(16)}, expected 0x47 for MPEG-TS`);
          console.log(`   First 16 bytes: ${segmentRes.data.slice(0, 16).toString('hex')}`);
        }
      } else {
        console.log(`   ❌ Segment fetch failed`);
        console.log(`   Response: ${segmentRes.data.toString().substring(0, 200)}`);
      }
    }
  }
  
  // Step 6: Test second segment to check continuity
  if (segmentUrls.length > 1) {
    console.log('\n5. Testing second segment fetch...');
    const segmentUrl = segmentUrls[1];
    
    const startTime = Date.now();
    const segmentRes = await fetch(segmentUrl);
    const elapsed = Date.now() - startTime;
    
    if (segmentRes.error) {
      console.log(`   ❌ Segment fetch error: ${segmentRes.error}`);
    } else {
      console.log(`   Status: ${segmentRes.status}`);
      console.log(`   Content-Length: ${segmentRes.data.length} bytes`);
      console.log(`   Time: ${elapsed}ms`);
      
      if (segmentRes.status === 200 && segmentRes.data.length > 0) {
        const syncByte = segmentRes.data[0];
        if (syncByte === 0x47) {
          console.log(`   ✅ Valid MPEG-TS segment`);
        } else {
          console.log(`   ⚠️  First byte is 0x${syncByte.toString(16)}`);
        }
      }
    }
  }
}

main().catch(console.error);
