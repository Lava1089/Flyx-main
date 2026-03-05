#!/usr/bin/env node
/**
 * Full DLHD Channel Scan - ULTRA FAST VERSION
 * 
 * - 100 channels tested IN PARALLEL
 * - Multiple server lookup endpoints tried in parallel
 * - Very short timeouts (2s)
 * - Skip M3U8 verification for speed - just trust lookup
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Config
const JWT_SOURCE_URL = 'https://hitsplay.fun/premiumtv/daddyhd.php';
const LOOKUP_ENDPOINT = 'https://chevy.dvalna.ru/server_lookup'; // Only working endpoint
const FETCH_TIMEOUT = 2000;
const CONCURRENCY = 100;
const TOTAL_CHANNELS = 850; // All 24/7 channels
const RESULTS_FILE = path.join(__dirname, 'scan-results.json');

// All 6 servers discovered by scanning 850 channels (Jan 2026)
const DLHD_SERVERS = ['ddy6', 'zeko', 'wind', 'dokko1', 'nfs', 'wiki'];
const DLHD_DOMAINS = ['dvalna.ru', 'kiko2.ru', 'giokko.ru'];

// Keep-alive agent for connection reuse
const agent = new https.Agent({ keepAlive: true, maxSockets: 200 });

// Stats
const stats = { total: 0, passed: 0, failed: 0, noAuth: 0, noServer: 0, startTime: Date.now() };
const results = { passed: [], failed: [], servers: {}, discoveredServers: new Set() };

// Fast fetch
function fetchUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
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
      timeout: FETCH_TIMEOUT,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// Fetch JWT
async function fetchAuthData(channelId) {
  try {
    const result = await fetchUrl(`${JWT_SOURCE_URL}?id=${channelId}`, {
      headers: { 'Referer': 'https://dlhd.link/' }
    });
    if (result.status !== 200) return null;
    const jwtMatch = result.data.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    return jwtMatch ? { token: jwtMatch[0] } : null;
  } catch {
    return null;
  }
}

// Server lookup - single fast endpoint
async function lookupServer(channelId) {
  const channelKey = `premium${channelId}`;
  
  try {
    const result = await fetchUrl(`${LOOKUP_ENDPOINT}?channel_id=${channelKey}`, {
      headers: { 'Referer': 'https://epicplayplay.cfd/' }
    });
    if (result.status === 200) {
      const data = JSON.parse(result.data);
      if (data.server_key) {
        results.discoveredServers.add(data.server_key);
        return data.server_key;
      }
    }
  } catch {}
  return null;
}

// Test M3U8 - try all domains in parallel, first success wins
async function testM3U8(channelId, server, authData) {
  const domains = ['dvalna.ru', 'kiko2.ru', 'giokko.ru'];
  
  const domainPromises = domains.map(async (domain) => {
    const m3u8Url = `https://${server}.${domain}/${server}/premium${channelId}/mono.css`;
    try {
      const result = await fetchUrl(m3u8Url, {
        headers: {
          'Referer': 'https://dlhd.link/',
          'Origin': 'https://dlhd.link',
          'Authorization': `Bearer ${authData.token}`,
        }
      });
      if (result.status === 200 && result.data.includes('#EXTM3U')) {
        const keyMatch = result.data.match(/#EXT-X-KEY:METHOD=AES-128,URI="([^"]+)"/);
        return { success: true, server, domain, m3u8Url, keyUrl: keyMatch?.[1] };
      }
    } catch {}
    return null;
  });
  
  const results_arr = await Promise.all(domainPromises);
  return results_arr.find(r => r !== null && r.success) || { success: false };
}

// Test single channel
async function testChannel(channelId) {
  const start = Date.now();
  
  // Get JWT
  const authData = await fetchAuthData(channelId);
  if (!authData) return { channelId, success: false, error: 'NO_AUTH', duration: Date.now() - start };
  
  // Lookup server
  const server = await lookupServer(channelId);
  if (!server) return { channelId, success: false, error: 'NO_SERVER', duration: Date.now() - start };
  
  // Test M3U8
  const m3u8Result = await testM3U8(channelId, server, authData);
  if (!m3u8Result.success) return { channelId, success: false, error: 'NO_M3U8', server, duration: Date.now() - start };
  
  return {
    channelId,
    success: true,
    server: `${m3u8Result.server}.${m3u8Result.domain}`,
    m3u8Url: m3u8Result.m3u8Url,
    keyUrl: m3u8Result.keyUrl,
    duration: Date.now() - start,
  };
}

// Progress
function printProgress() {
  const pct = Math.round((stats.total / TOTAL_CHANNELS) * 100);
  const bar = '█'.repeat(Math.floor(pct / 2)) + '░'.repeat(50 - Math.floor(pct / 2));
  const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(0);
  const rate = (stats.total / Math.max(1, elapsed)).toFixed(1);
  process.stdout.write(`\r[${bar}] ${pct}% | ${stats.total}/${TOTAL_CHANNELS} | ✅${stats.passed} ❌${stats.failed} | ${rate}/s | ${elapsed}s`);
}

// Main
async function main() {
  console.log('═'.repeat(70));
  console.log('DLHD Full Channel Scan - FAST MODE');
  console.log('═'.repeat(70));
  console.log(`Channels: 1-${TOTAL_CHANNELS} | Concurrency: ${CONCURRENCY} | Timeout: ${FETCH_TIMEOUT}ms`);
  console.log('═'.repeat(70));
  console.log('');
  
  const allChannels = Array.from({ length: TOTAL_CHANNELS }, (_, i) => String(i + 1));
  
  // Process ALL channels with controlled concurrency
  const queue = [...allChannels];
  const running = new Set();
  
  const processNext = async () => {
    while (queue.length > 0 && running.size < CONCURRENCY) {
      const channelId = queue.shift();
      running.add(channelId);
      
      testChannel(channelId).then(result => {
        running.delete(channelId);
        stats.total++;
        
        if (result.success) {
          stats.passed++;
          results.passed.push(result);
          results.servers[result.server] = (results.servers[result.server] || 0) + 1;
        } else {
          stats.failed++;
          results.failed.push(result);
          if (result.error === 'NO_AUTH') stats.noAuth++;
          if (result.error === 'NO_SERVER') stats.noServer++;
        }
        
        printProgress();
        processNext();
      });
    }
  };
  
  // Start initial batch
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
  
  // Results
  console.log('\n\n' + '═'.repeat(70));
  console.log('SCAN COMPLETE');
  console.log('═'.repeat(70));
  
  const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(1);
  console.log(`\nTotal: ${stats.total} in ${elapsed}s (${(stats.total/elapsed).toFixed(1)}/s)`);
  console.log(`Passed: ${stats.passed} (${(stats.passed/stats.total*100).toFixed(1)}%)`);
  console.log(`Failed: ${stats.failed}`);
  console.log(`  - No Auth: ${stats.noAuth}`);
  console.log(`  - No Server: ${stats.noServer}`);
  
  console.log('\nDiscovered Servers:', [...results.discoveredServers].join(', '));
  
  console.log('\nServer Distribution (top 15):');
  Object.entries(results.servers).sort((a,b) => b[1]-a[1]).slice(0,15).forEach(([s,c]) => console.log(`  ${s}: ${c}`));
  
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
  console.log(`\nResults: ${RESULTS_FILE}`);
}

main().catch(console.error);
