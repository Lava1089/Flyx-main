#!/usr/bin/env node
/**
 * DLHD Full Extraction Scan
 * 
 * Tests complete extraction flow for ALL 850 channels in parallel:
 * 1. Fetch JWT from hitsplay.fun
 * 2. Lookup server from chevy.dvalna.ru
 * 3. Fetch M3U8 playlist
 * 4. Extract key URL from M3U8
 * 
 * Runs with high parallelism for speed
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Config
const JWT_SOURCE_URL = 'https://hitsplay.fun/premiumtv/daddyhd.php';
const LOOKUP_ENDPOINT = 'https://chevy.dvalna.ru/server_lookup';
const TOTAL_CHANNELS = 850;
const TIMEOUT = 3000;
const CONCURRENCY = 150; // High parallelism

const agent = new https.Agent({ keepAlive: true, maxSockets: 200 });

// Stats
const stats = {
  total: 0,
  jwtSuccess: 0,
  jwtFail: 0,
  lookupSuccess: 0,
  lookupFail: 0,
  m3u8Success: 0,
  m3u8Fail: 0,
  keyFound: 0,
  keyNotFound: 0,
  fullSuccess: 0,
  startTime: Date.now(),
};

// Results
const results = {
  success: [],
  failed: [],
  byServer: {},
  byError: {},
};

function fetchUrl(url, options = {}) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      agent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...options.headers,
      },
      timeout: TIMEOUT,
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
  const result = {
    channelId,
    jwt: null,
    server: null,
    m3u8Url: null,
    keyUrl: null,
    error: null,
  };

  // Step 1: Fetch JWT
  const jwtResult = await fetchUrl(`${JWT_SOURCE_URL}?id=${channelId}`, {
    headers: { 'Referer': 'https://dlhd.link/' }
  });
  
  if (jwtResult.error || jwtResult.status !== 200) {
    result.error = 'JWT_FAIL';
    return result;
  }
  
  const jwtMatch = jwtResult.data.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  if (!jwtMatch) {
    result.error = 'JWT_NOT_FOUND';
    return result;
  }
  result.jwt = jwtMatch[0];

  // Step 2: Lookup server
  const lookupResult = await fetchUrl(`${LOOKUP_ENDPOINT}?channel_id=premium${channelId}`, {
    headers: { 'Referer': 'https://epicplayplay.cfd/' }
  });
  
  if (lookupResult.error || lookupResult.status !== 200) {
    result.error = 'LOOKUP_FAIL';
    return result;
  }
  
  try {
    const lookupData = JSON.parse(lookupResult.data);
    if (!lookupData.server_key) {
      result.error = 'NO_SERVER';
      return result;
    }
    result.server = lookupData.server_key;
  } catch {
    result.error = 'LOOKUP_PARSE_FAIL';
    return result;
  }

  // Step 3: Fetch M3U8 - try dvalna.ru first
  const m3u8Url = `https://${result.server}.dvalna.ru/${result.server}/premium${channelId}/mono.css`;
  result.m3u8Url = m3u8Url;
  
  const m3u8Result = await fetchUrl(m3u8Url, {
    headers: {
      'Referer': 'https://dlhd.link/',
      'Origin': 'https://dlhd.link',
      'Authorization': `Bearer ${result.jwt}`,
    }
  });
  
  if (m3u8Result.error || m3u8Result.status !== 200) {
    result.error = 'M3U8_FAIL';
    return result;
  }
  
  if (!m3u8Result.data.includes('#EXTM3U')) {
    result.error = 'M3U8_INVALID';
    return result;
  }

  // Step 4: Extract key URL
  const keyMatch = m3u8Result.data.match(/#EXT-X-KEY:METHOD=AES-128,URI="([^"]+)"/);
  if (keyMatch) {
    result.keyUrl = keyMatch[1];
  } else {
    result.error = 'KEY_NOT_FOUND';
    return result;
  }

  return result;
}

function printProgress() {
  const pct = Math.round((stats.total / TOTAL_CHANNELS) * 100);
  const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(0);
  const rate = (stats.total / Math.max(1, elapsed)).toFixed(1);
  process.stdout.write(`\r[${pct}%] ${stats.total}/${TOTAL_CHANNELS} | ✅${stats.fullSuccess} ❌${stats.total - stats.fullSuccess} | ${rate}/s | ${elapsed}s`);
}

async function main() {
  console.log('═'.repeat(70));
  console.log('DLHD FULL EXTRACTION SCAN');
  console.log('═'.repeat(70));
  console.log(`Testing ${TOTAL_CHANNELS} channels with ${CONCURRENCY} parallel requests`);
  console.log('Validating: JWT → Server Lookup → M3U8 → Key URL');
  console.log('═'.repeat(70));
  console.log('');

  const queue = Array.from({ length: TOTAL_CHANNELS }, (_, i) => i + 1);
  const running = new Set();

  const processNext = () => {
    while (queue.length > 0 && running.size < CONCURRENCY) {
      const channelId = queue.shift();
      running.add(channelId);

      testChannel(channelId).then(result => {
        running.delete(channelId);
        stats.total++;

        if (!result.error) {
          stats.fullSuccess++;
          results.success.push(result);
          
          // Track by server
          if (!results.byServer[result.server]) {
            results.byServer[result.server] = { success: 0, channels: [] };
          }
          results.byServer[result.server].success++;
          results.byServer[result.server].channels.push(channelId);
        } else {
          results.failed.push(result);
          results.byError[result.error] = (results.byError[result.error] || 0) + 1;
        }

        printProgress();
        processNext();
      });
    }
  };

  // Start
  for (let i = 0; i < CONCURRENCY; i++) processNext();

  // Wait for completion
  await new Promise(resolve => {
    const check = setInterval(() => {
      if (stats.total >= TOTAL_CHANNELS) {
        clearInterval(check);
        resolve();
      }
    }, 100);
  });

  const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(1);

  console.log('\n\n' + '═'.repeat(70));
  console.log('SCAN COMPLETE');
  console.log('═'.repeat(70));

  console.log(`\nTotal: ${stats.total} channels in ${elapsed}s (${(stats.total/elapsed).toFixed(1)}/s)`);
  console.log(`Full Success: ${stats.fullSuccess} (${(stats.fullSuccess/stats.total*100).toFixed(1)}%)`);
  console.log(`Failed: ${stats.total - stats.fullSuccess}`);

  console.log('\n=== ERRORS BY TYPE ===');
  Object.entries(results.byError).sort((a,b) => b[1] - a[1]).forEach(([err, count]) => {
    console.log(`  ${err}: ${count}`);
  });

  console.log('\n=== SUCCESS BY SERVER ===');
  Object.entries(results.byServer).sort((a,b) => b[1].success - a[1].success).forEach(([server, data]) => {
    console.log(`  ${server}: ${data.success} channels`);
  });

  // Sample successful extractions
  console.log('\n=== SAMPLE SUCCESSFUL EXTRACTIONS ===');
  results.success.slice(0, 5).forEach(r => {
    console.log(`  Channel ${r.channelId}:`);
    console.log(`    Server: ${r.server}`);
    console.log(`    M3U8: ${r.m3u8Url}`);
    console.log(`    Key: ${r.keyUrl}`);
  });

  // Save results
  const outputFile = path.join(__dirname, 'full-extraction-results.json');
  fs.writeFileSync(outputFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    stats: {
      total: stats.total,
      success: stats.fullSuccess,
      failed: stats.total - stats.fullSuccess,
      elapsed: elapsed,
    },
    byServer: results.byServer,
    byError: results.byError,
    failedChannels: results.failed.map(r => ({ channel: r.channelId, error: r.error })),
  }, null, 2));
  console.log(`\nResults saved to: ${outputFile}`);
}

main().catch(console.error);
