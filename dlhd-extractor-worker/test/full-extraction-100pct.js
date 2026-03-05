#!/usr/bin/env node
/**
 * DLHD Full Extraction - 100% Success Target
 * 
 * - Retries JWT failures up to 5 times with exponential backoff
 * - Handles unencrypted streams (no key = unencrypted)
 * - Investigates LOOKUP_FAIL channels
 * - Lower concurrency to avoid rate limiting
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Config
const JWT_SOURCE_URL = 'https://hitsplay.fun/premiumtv/daddyhd.php';
const LOOKUP_ENDPOINT = 'https://chevy.dvalna.ru/server_lookup';
const TOTAL_CHANNELS = 850;
const TIMEOUT = 8000;
const CONCURRENCY = 15; // Very low to avoid rate limiting
const MAX_JWT_RETRIES = 5;
const DOMAINS = ['dvalna.ru', 'kiko2.ru', 'giokko.ru'];

const agent = new https.Agent({ keepAlive: true, maxSockets: 30 });

// Stats
const stats = { total: 0, fullSuccess: 0, unencrypted: 0, inactive: 0, startTime: Date.now() };
const results = { 
  success: [], 
  unencrypted: [],
  inactive: [], // Channels that don't exist
  failed: [], 
  byServer: {}, 
  byError: {} 
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

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJWTWithRetry(channelId) {
  for (let attempt = 1; attempt <= MAX_JWT_RETRIES; attempt++) {
    const backoff = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
    if (attempt > 1) await delay(backoff);
    
    const result = await fetchUrl(`${JWT_SOURCE_URL}?id=${channelId}`, {
      headers: { 'Referer': 'https://dlhd.link/' }
    });
    
    if (result.status === 200) {
      const jwtMatch = result.data.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
      if (jwtMatch) {
        return { jwt: jwtMatch[0] };
      }
      // Check if page says channel doesn't exist
      if (result.data.includes('not found') || result.data.includes('invalid') || result.data.length < 100) {
        return { inactive: true };
      }
    }
    
    // If 429 or 503, wait longer
    if (result.status === 429 || result.status === 503) {
      await delay(5000);
    }
  }
  return { error: 'JWT_FAIL_AFTER_RETRIES' };
}

async function lookupServerWithRetry(channelId) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) await delay(1000 * attempt);
    
    const result = await fetchUrl(`${LOOKUP_ENDPOINT}?channel_id=premium${channelId}`, {
      headers: { 'Referer': 'https://epicplayplay.cfd/' }
    });
    
    if (result.status === 200) {
      try {
        const data = JSON.parse(result.data);
        if (data.server_key) {
          return { server: data.server_key };
        }
        // No server_key means channel doesn't exist
        return { inactive: true };
      } catch {
        continue;
      }
    }
  }
  return { error: 'LOOKUP_FAIL' };
}

async function fetchM3U8(channelId, server, jwt) {
  // Try all domains
  for (const domain of DOMAINS) {
    const m3u8Url = `https://${server}.${domain}/${server}/premium${channelId}/mono.css`;
    
    const result = await fetchUrl(m3u8Url, {
      headers: {
        'Referer': 'https://dlhd.link/',
        'Origin': 'https://dlhd.link',
        'Authorization': `Bearer ${jwt}`,
      }
    });
    
    if (result.status === 200 && result.data.includes('#EXTM3U')) {
      // Check for encryption key
      const keyMatch = result.data.match(/#EXT-X-KEY:METHOD=AES-128,URI="([^"]+)"/);
      const isEncrypted = !!keyMatch;
      
      return {
        m3u8Url,
        domain,
        keyUrl: keyMatch ? keyMatch[1] : null,
        isEncrypted,
        content: result.data.substring(0, 500),
      };
    }
  }
  return { error: 'M3U8_FAIL' };
}

async function testChannel(channelId) {
  const result = {
    channelId,
    jwt: null,
    server: null,
    domain: null,
    m3u8Url: null,
    keyUrl: null,
    isEncrypted: true,
    status: null,
    error: null,
  };

  // Step 1: Fetch JWT with retries
  const jwtResult = await fetchJWTWithRetry(channelId);
  if (jwtResult.inactive) {
    result.status = 'INACTIVE';
    return result;
  }
  if (jwtResult.error) {
    result.error = jwtResult.error;
    return result;
  }
  result.jwt = jwtResult.jwt;

  // Step 2: Lookup server with retries
  const lookupResult = await lookupServerWithRetry(channelId);
  if (lookupResult.inactive) {
    result.status = 'INACTIVE';
    return result;
  }
  if (lookupResult.error) {
    result.error = lookupResult.error;
    return result;
  }
  result.server = lookupResult.server;

  // Step 3: Fetch M3U8 from all domains
  const m3u8Result = await fetchM3U8(channelId, result.server, result.jwt);
  if (m3u8Result.error) {
    result.error = m3u8Result.error;
    return result;
  }
  
  result.m3u8Url = m3u8Result.m3u8Url;
  result.domain = m3u8Result.domain;
  result.keyUrl = m3u8Result.keyUrl;
  result.isEncrypted = m3u8Result.isEncrypted;
  result.status = m3u8Result.isEncrypted ? 'SUCCESS_ENCRYPTED' : 'SUCCESS_UNENCRYPTED';

  return result;
}

function printProgress() {
  const pct = Math.round((stats.total / TOTAL_CHANNELS) * 100);
  const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(0);
  const rate = (stats.total / Math.max(1, elapsed)).toFixed(1);
  const total_success = stats.fullSuccess + stats.unencrypted;
  const successRate = stats.total > 0 ? ((total_success / stats.total) * 100).toFixed(0) : 0;
  process.stdout.write(`\r[${pct}%] ${stats.total}/${TOTAL_CHANNELS} | ✅${total_success} (${successRate}%) 🔓${stats.unencrypted} ⏸${stats.inactive} | ${rate}/s`);
}

async function main() {
  console.log('═'.repeat(70));
  console.log('DLHD FULL EXTRACTION - 100% TARGET');
  console.log('═'.repeat(70));
  console.log(`Testing ${TOTAL_CHANNELS} channels with ${MAX_JWT_RETRIES} JWT retries`);
  console.log('Handling: encrypted, unencrypted, and inactive channels');
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

        if (result.status === 'SUCCESS_ENCRYPTED') {
          stats.fullSuccess++;
          results.success.push(result);
          if (!results.byServer[result.server]) {
            results.byServer[result.server] = { encrypted: 0, unencrypted: 0, channels: [] };
          }
          results.byServer[result.server].encrypted++;
          results.byServer[result.server].channels.push(channelId);
        } else if (result.status === 'SUCCESS_UNENCRYPTED') {
          stats.unencrypted++;
          results.unencrypted.push(result);
          if (!results.byServer[result.server]) {
            results.byServer[result.server] = { encrypted: 0, unencrypted: 0, channels: [] };
          }
          results.byServer[result.server].unencrypted++;
          results.byServer[result.server].channels.push(channelId);
        } else if (result.status === 'INACTIVE') {
          stats.inactive++;
          results.inactive.push(result.channelId);
        } else {
          results.failed.push(result);
          results.byError[result.error] = (results.byError[result.error] || 0) + 1;
        }

        printProgress();
        processNext();
      });
    }
  };

  for (let i = 0; i < CONCURRENCY; i++) processNext();

  await new Promise(resolve => {
    const check = setInterval(() => {
      if (stats.total >= TOTAL_CHANNELS) {
        clearInterval(check);
        resolve();
      }
    }, 100);
  });

  const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(1);
  const totalSuccess = stats.fullSuccess + stats.unencrypted;
  const activeChannels = TOTAL_CHANNELS - stats.inactive;

  console.log('\n\n' + '═'.repeat(70));
  console.log('SCAN COMPLETE');
  console.log('═'.repeat(70));

  console.log(`\nTotal Channels: ${TOTAL_CHANNELS}`);
  console.log(`Active Channels: ${activeChannels}`);
  console.log(`Inactive Channels: ${stats.inactive}`);
  console.log(`\nExtraction Success: ${totalSuccess}/${activeChannels} (${(totalSuccess/activeChannels*100).toFixed(1)}%)`);
  console.log(`  - Encrypted: ${stats.fullSuccess}`);
  console.log(`  - Unencrypted: ${stats.unencrypted}`);
  console.log(`Failed: ${results.failed.length}`);
  console.log(`Time: ${elapsed}s`);

  if (Object.keys(results.byError).length > 0) {
    console.log('\n=== REMAINING ERRORS ===');
    Object.entries(results.byError).sort((a,b) => b[1] - a[1]).forEach(([err, count]) => {
      console.log(`  ${err}: ${count}`);
    });
  }

  console.log('\n=== SUCCESS BY SERVER ===');
  Object.entries(results.byServer).sort((a,b) => (b[1].encrypted + b[1].unencrypted) - (a[1].encrypted + a[1].unencrypted)).forEach(([server, data]) => {
    console.log(`  ${server}: ${data.encrypted} encrypted, ${data.unencrypted} unencrypted`);
  });

  if (results.unencrypted.length > 0) {
    console.log('\n=== UNENCRYPTED CHANNELS ===');
    results.unencrypted.slice(0, 10).forEach(r => {
      console.log(`  Channel ${r.channelId}: ${r.m3u8Url}`);
    });
    if (results.unencrypted.length > 10) {
      console.log(`  ... and ${results.unencrypted.length - 10} more`);
    }
  }

  if (results.failed.length > 0) {
    console.log('\n=== FAILED CHANNELS (sample) ===');
    results.failed.slice(0, 20).forEach(r => {
      console.log(`  Channel ${r.channelId}: ${r.error}`);
    });
  }

  // Save results
  const outputFile = path.join(__dirname, 'full-extraction-100pct-results.json');
  fs.writeFileSync(outputFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    stats: {
      total: TOTAL_CHANNELS,
      active: activeChannels,
      inactive: stats.inactive,
      encrypted: stats.fullSuccess,
      unencrypted: stats.unencrypted,
      failed: results.failed.length,
      successRate: `${(totalSuccess/activeChannels*100).toFixed(1)}%`,
      elapsed,
    },
    byServer: results.byServer,
    byError: results.byError,
    inactiveChannels: results.inactive,
    unencryptedChannels: results.unencrypted.map(r => ({ channel: r.channelId, m3u8: r.m3u8Url })),
    failedChannels: results.failed.map(r => ({ channel: r.channelId, error: r.error })),
  }, null, 2));
  console.log(`\nResults saved to: ${outputFile}`);
}

main().catch(console.error);
