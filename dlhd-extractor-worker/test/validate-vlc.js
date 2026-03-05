#!/usr/bin/env node
/**
 * Validate channels work via the API for VLC playback
 */

const http = require('http');

const API_URL = 'http://127.0.0.1:8787';
const API_KEY = 'test';

// Sample channels from successful extraction
const TEST_CHANNELS = [1, 31, 50, 100, 200, 300, 400, 500, 600, 700];

function fetch(url, headers = {}) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const req = http.request({
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: { 'X-API-Key': API_KEY, ...headers },
      timeout: 60000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.end();
  });
}

async function testChannel(channelId) {
  console.log(`\nTesting channel ${channelId}...`);
  
  // Step 1: Get stream URL
  const streamRes = await fetch(`${API_URL}/stream/${channelId}`);
  if (streamRes.error || streamRes.status !== 200) {
    console.log(`  ❌ Stream API failed: ${streamRes.error || streamRes.status}`);
    return false;
  }
  
  let streamData;
  try {
    streamData = JSON.parse(streamRes.data);
  } catch {
    console.log(`  ❌ Invalid JSON response`);
    return false;
  }
  
  if (!streamData.success || !streamData.streamUrl) {
    console.log(`  ❌ No stream URL: ${streamData.error || 'unknown'}`);
    return false;
  }
  
  console.log(`  ✅ Got stream URL`);
  
  // Step 2: Fetch the proxied M3U8 (add key param for VLC compatibility)
  const m3u8Url = streamData.streamUrl + '&key=' + API_KEY;
  const m3u8Res = await fetch(m3u8Url);
  
  if (m3u8Res.error || m3u8Res.status !== 200) {
    console.log(`  ❌ M3U8 fetch failed: ${m3u8Res.error || m3u8Res.status}`);
    return false;
  }
  
  if (!m3u8Res.data.includes('#EXTM3U')) {
    console.log(`  ❌ Invalid M3U8 content`);
    return false;
  }
  
  console.log(`  ✅ M3U8 valid`);
  
  // Check for encryption key
  const hasKey = m3u8Res.data.includes('#EXT-X-KEY');
  const hasSegments = m3u8Res.data.includes('#EXTINF');
  
  console.log(`  📊 Encrypted: ${hasKey}, Segments: ${hasSegments}`);
  console.log(`  🎬 VLC URL: ${m3u8Url}`);
  
  return true;
}

async function main() {
  console.log('═'.repeat(60));
  console.log('DLHD API VLC Validation');
  console.log('═'.repeat(60));
  
  let success = 0;
  let failed = 0;
  
  for (const ch of TEST_CHANNELS) {
    const ok = await testChannel(ch);
    if (ok) success++;
    else failed++;
  }
  
  console.log('\n' + '═'.repeat(60));
  console.log(`Results: ${success}/${TEST_CHANNELS.length} passed`);
  console.log('═'.repeat(60));
  
  if (success > 0) {
    console.log('\n📺 To test in VLC:');
    console.log(`   1. Open VLC > Media > Open Network Stream`);
    console.log(`   2. Paste: ${API_URL}/stream/31 (get streamUrl from response)`);
    console.log(`   3. Add &key=${API_KEY} to the streamUrl`);
  }
}

main().catch(console.error);
