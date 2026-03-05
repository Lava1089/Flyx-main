#!/usr/bin/env node
/**
 * Recheck ONLY the failed channels from previous scan
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Load previous results
const prevResults = JSON.parse(fs.readFileSync(path.join(__dirname, 'full-extraction-100pct-results.json')));

// Extract failed channels (excluding LOOKUP_FAIL which are genuinely inactive)
const FAILED_CHANNELS = prevResults.failedChannels
  .filter(f => f.error !== 'LOOKUP_FAIL') // Skip genuinely inactive
  .map(f => f.channel);

const LOOKUP_FAIL_CHANNELS = prevResults.failedChannels
  .filter(f => f.error === 'LOOKUP_FAIL')
  .map(f => f.channel);

console.log(`Rechecking ${FAILED_CHANNELS.length} failed channels (skipping ${LOOKUP_FAIL_CHANNELS.length} LOOKUP_FAIL)`);

const JWT_SOURCE_URL = 'https://hitsplay.fun/premiumtv/daddyhd.php';
const LOOKUP_ENDPOINT = 'https://chevy.dvalna.ru/server_lookup';
const TIMEOUT = 5000; // 5 second timeout
const CONCURRENCY = 10;
const DOMAINS = ['dvalna.ru', 'kiko2.ru', 'giokko.ru'];

const agent = new https.Agent({ keepAlive: true, maxSockets: 10 });
const stats = { total: 0, success: 0, unencrypted: 0, failed: 0, startTime: Date.now() };
const results = { success: [], unencrypted: [], failed: [], byError: {} };

function fetchUrl(url, options = {}) {
  return new Promise((resolve) => {
    let resolved = false;
    const done = (result) => {
      if (!resolved) { resolved = true; resolve(result); }
    };
    
    // Hard timeout - force resolve after TIMEOUT
    const hardTimeout = setTimeout(() => {
      done({ error: 'hard_timeout' });
    }, TIMEOUT + 2000);
    
    try {
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
        res.on('end', () => { clearTimeout(hardTimeout); done({ status: res.statusCode, data }); });
        res.on('error', () => { clearTimeout(hardTimeout); done({ error: 'res_error' }); });
      });
      req.on('error', (e) => { clearTimeout(hardTimeout); done({ error: e.message }); });
      req.on('timeout', () => { req.destroy(); clearTimeout(hardTimeout); done({ error: 'timeout' }); });
      req.end();
    } catch (e) {
      clearTimeout(hardTimeout);
      done({ error: 'exception' });
    }
  });
}

const delay = ms => new Promise(r => setTimeout(r, ms));

async function fetchJWT(channelId) {
  // Single attempt - no retries, fail fast
  const result = await fetchUrl(`${JWT_SOURCE_URL}?id=${channelId}`, {
    headers: { 'Referer': 'https://dlhd.link/' }
  });
  
  if (result.status === 200) {
    const jwtMatch = result.data.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    if (jwtMatch) return { jwt: jwtMatch[0] };
  }
  return { error: 'JWT_FAIL' };
}

async function lookupServer(channelId) {
  const result = await fetchUrl(`${LOOKUP_ENDPOINT}?channel_id=premium${channelId}`);
  if (result.status === 200) {
    try {
      const data = JSON.parse(result.data);
      if (data.server_key) return { server: data.server_key };
      return { inactive: true };
    } catch { return { error: 'LOOKUP_PARSE' }; }
  }
  return { error: 'LOOKUP_FAIL' };
}

async function fetchM3U8(channelId, server, jwt) {
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
      const keyMatch = result.data.match(/#EXT-X-KEY:METHOD=AES-128,URI="([^"]+)"/);
      return { m3u8Url, domain, keyUrl: keyMatch?.[1], isEncrypted: !!keyMatch };
    }
  }
  return { error: 'M3U8_FAIL' };
}

async function testChannel(channelId) {
  const lookup = await lookupServer(channelId);
  if (lookup.inactive || lookup.error) return { channelId, error: lookup.error || 'INACTIVE' };
  
  const jwt = await fetchJWT(channelId);
  if (jwt.error) return { channelId, error: jwt.error };
  
  const m3u8 = await fetchM3U8(channelId, lookup.server, jwt.jwt);
  if (m3u8.error) return { channelId, error: m3u8.error };
  
  return { channelId, server: lookup.server, ...m3u8, status: m3u8.isEncrypted ? 'SUCCESS' : 'UNENCRYPTED' };
}

async function main() {
  console.log('═'.repeat(60));
  console.log(`RECHECK ${FAILED_CHANNELS.length} FAILED CHANNELS`);
  console.log('═'.repeat(60));

  const queue = [...FAILED_CHANNELS];
  const running = new Set();

  const processNext = () => {
    while (queue.length > 0 && running.size < CONCURRENCY) {
      const ch = queue.shift();
      running.add(ch);
      testChannel(ch).then(r => {
        running.delete(ch);
        stats.total++;
        if (r.status === 'SUCCESS') { stats.success++; results.success.push(r); }
        else if (r.status === 'UNENCRYPTED') { stats.unencrypted++; results.unencrypted.push(r); }
        else { stats.failed++; results.failed.push(r); results.byError[r.error] = (results.byError[r.error]||0)+1; }
        const pct = Math.round(stats.total/FAILED_CHANNELS.length*100);
        process.stdout.write(`\r[${pct}%] ${stats.total}/${FAILED_CHANNELS.length} | ✅${stats.success+stats.unencrypted} ❌${stats.failed}`);
        processNext();
      });
    }
  };

  for (let i = 0; i < CONCURRENCY; i++) processNext();
  await new Promise(r => { const c = setInterval(() => { if (stats.total >= FAILED_CHANNELS.length) { clearInterval(c); r(); } }, 100); });

  console.log('\n\n' + '═'.repeat(60));
  console.log('RECHECK COMPLETE');
  console.log('═'.repeat(60));
  console.log(`\nRecovered: ${stats.success + stats.unencrypted}/${FAILED_CHANNELS.length}`);
  console.log(`Still failing: ${stats.failed}`);
  console.log('\nErrors:', results.byError);

  // Merge with previous results
  const totalEncrypted = prevResults.stats.encrypted + stats.success;
  const totalUnencrypted = prevResults.stats.unencrypted + stats.unencrypted;
  const totalSuccess = totalEncrypted + totalUnencrypted;
  const activeChannels = 850 - LOOKUP_FAIL_CHANNELS.length - prevResults.stats.inactive;
  
  console.log(`\n=== FINAL TOTALS ===`);
  console.log(`Active channels: ${activeChannels}`);
  console.log(`Total success: ${totalSuccess}/${activeChannels} (${(totalSuccess/activeChannels*100).toFixed(1)}%)`);
  console.log(`  Encrypted: ${totalEncrypted}`);
  console.log(`  Unencrypted: ${totalUnencrypted}`);
  console.log(`Remaining failures: ${stats.failed}`);

  fs.writeFileSync(path.join(__dirname, 'recheck-results.json'), JSON.stringify({
    timestamp: new Date().toISOString(),
    rechecked: FAILED_CHANNELS.length,
    recovered: stats.success + stats.unencrypted,
    stillFailing: stats.failed,
    byError: results.byError,
    recoveredChannels: [...results.success, ...results.unencrypted],
    failedChannels: results.failed,
    finalTotals: { active: activeChannels, success: totalSuccess, encrypted: totalEncrypted, unencrypted: totalUnencrypted, failed: stats.failed }
  }, null, 2));
}

main().catch(console.error);
