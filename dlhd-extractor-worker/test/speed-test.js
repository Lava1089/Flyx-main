#!/usr/bin/env node
/**
 * Speed test - verify extraction completes in under 5 seconds
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
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.end();
  });
}

async function testSpeed(channelId) {
  const start = Date.now();
  
  // Step 1: Get stream URL
  const streamRes = await fetch(`${API_URL}/stream/${channelId}`);
  const streamTime = Date.now() - start;
  
  if (streamRes.error || streamRes.status !== 200) {
    return { channelId, success: false, error: streamRes.error || `HTTP ${streamRes.status}`, streamTime };
  }
  
  let streamData;
  try {
    streamData = JSON.parse(streamRes.data);
  } catch {
    return { channelId, success: false, error: 'Invalid JSON', streamTime };
  }
  
  if (!streamData.success) {
    return { channelId, success: false, error: streamData.error, streamTime };
  }

  // Step 2: Fetch M3U8
  const m3u8Start = Date.now();
  const m3u8Url = streamData.streamUrl + '&key=' + API_KEY;
  const m3u8Res = await fetch(m3u8Url);
  const m3u8Time = Date.now() - m3u8Start;
  const totalTime = Date.now() - start;
  
  if (m3u8Res.error || m3u8Res.status !== 200) {
    return { channelId, success: false, error: `M3U8: ${m3u8Res.error || m3u8Res.status}`, streamTime, m3u8Time, totalTime };
  }
  
  const hasM3U8 = m3u8Res.data.includes('#EXTM3U');
  const hasProxy = m3u8Res.data.includes('127.0.0.1') || m3u8Res.data.includes('/live/');
  
  return {
    channelId,
    success: hasM3U8 && hasProxy,
    streamTime,
    m3u8Time,
    totalTime,
    hasM3U8,
    hasProxy,
    error: !hasM3U8 ? 'Invalid M3U8' : (!hasProxy ? 'URLs not proxied' : null),
  };
}

async function main() {
  console.log('═'.repeat(60));
  console.log('DLHD SPEED TEST - Target: < 5 seconds');
  console.log('═'.repeat(60));
  
  // Test channels from different servers
  const testChannels = [31, 51, 65, 100, 200, 300, 400, 500];
  
  let passed = 0;
  let failed = 0;
  
  for (const ch of testChannels) {
    const result = await testSpeed(ch);
    
    const status = result.success && result.totalTime < 5000 ? '✅' : '❌';
    const timeStatus = result.totalTime < 5000 ? '🚀' : '🐢';
    
    console.log(`\n${status} Channel ${ch}:`);
    console.log(`   Stream API: ${result.streamTime}ms`);
    if (result.m3u8Time) console.log(`   M3U8 Fetch: ${result.m3u8Time}ms`);
    console.log(`   Total: ${result.totalTime}ms ${timeStatus}`);
    
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
    
    if (result.success && result.totalTime < 5000) {
      passed++;
    } else {
      failed++;
    }
  }
  
  console.log('\n' + '═'.repeat(60));
  console.log(`Results: ${passed}/${testChannels.length} passed (< 5 seconds)`);
  console.log('═'.repeat(60));
}

main().catch(console.error);
