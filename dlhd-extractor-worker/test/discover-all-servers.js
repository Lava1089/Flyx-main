#!/usr/bin/env node
/**
 * DLHD Complete Server Discovery
 * 
 * Scans ALL 850 channels to discover every unique server key
 * Uses chevy.dvalna.ru as the lookup endpoint (known to work)
 */

const https = require('https');

const LOOKUP_URL = 'https://chevy.dvalna.ru/server_lookup';
const TOTAL_CHANNELS = 850;
const TIMEOUT = 2000;
const CONCURRENCY = 100;

const agent = new https.Agent({ keepAlive: true, maxSockets: 150 });

// Results
const discoveredServers = new Map(); // server_key -> [channels]
const channelToServer = new Map(); // channel -> server_key
const failedChannels = [];
let completed = 0;

function fetchUrl(url) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      agent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://epicplayplay.cfd/',
      },
      timeout: TIMEOUT,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

async function lookupChannel(channelId) {
  const url = `${LOOKUP_URL}?channel_id=premium${channelId}`;
  const result = await fetchUrl(url);
  
  if (result && result.status === 200) {
    try {
      const data = JSON.parse(result.data);
      if (data.server_key) {
        return data.server_key;
      }
    } catch {}
  }
  return null;
}

function printProgress() {
  const pct = Math.round((completed / TOTAL_CHANNELS) * 100);
  const servers = discoveredServers.size;
  process.stdout.write(`\rProgress: ${completed}/${TOTAL_CHANNELS} (${pct}%) | Unique servers: ${servers}`);
}

async function main() {
  console.log('═'.repeat(70));
  console.log('DLHD COMPLETE SERVER DISCOVERY');
  console.log('═'.repeat(70));
  console.log(`Scanning channels 1-${TOTAL_CHANNELS} to find ALL unique server keys`);
  console.log('═'.repeat(70));
  console.log('');

  const startTime = Date.now();
  const queue = Array.from({ length: TOTAL_CHANNELS }, (_, i) => i + 1);
  const running = new Set();

  const processNext = () => {
    while (queue.length > 0 && running.size < CONCURRENCY) {
      const channelId = queue.shift();
      running.add(channelId);

      lookupChannel(channelId).then(serverKey => {
        running.delete(channelId);
        completed++;

        if (serverKey) {
          channelToServer.set(channelId, serverKey);
          if (!discoveredServers.has(serverKey)) {
            discoveredServers.set(serverKey, []);
            console.log(`\n✓ NEW SERVER: ${serverKey} (channel ${channelId})`);
          }
          discoveredServers.get(serverKey).push(channelId);
        } else {
          failedChannels.push(channelId);
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
      if (completed >= TOTAL_CHANNELS) {
        clearInterval(check);
        resolve();
      }
    }, 100);
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n\n' + '═'.repeat(70));
  console.log('DISCOVERY COMPLETE');
  console.log('═'.repeat(70));

  console.log(`\nScanned ${TOTAL_CHANNELS} channels in ${elapsed}s`);
  console.log(`Found ${discoveredServers.size} unique server keys`);
  console.log(`Failed lookups: ${failedChannels.length}`);

  console.log('\n=== ALL DISCOVERED SERVER KEYS ===');
  const sortedServers = [...discoveredServers.entries()].sort((a, b) => b[1].length - a[1].length);
  sortedServers.forEach(([server, channels]) => {
    console.log(`  ${server}: ${channels.length} channels (${channels.slice(0, 5).join(', ')}${channels.length > 5 ? '...' : ''})`);
  });

  console.log('\n=== CODE TO COPY ===');
  console.log('const DLHD_SERVERS = [');
  sortedServers.forEach(([server]) => console.log(`  '${server}',`));
  console.log('];');

  // Save results
  const fs = require('fs');
  const results = {
    timestamp: new Date().toISOString(),
    totalChannels: TOTAL_CHANNELS,
    uniqueServers: discoveredServers.size,
    servers: Object.fromEntries(sortedServers),
    failedChannels,
  };
  fs.writeFileSync(__dirname + '/server-discovery-results.json', JSON.stringify(results, null, 2));
  console.log('\nResults saved to server-discovery-results.json');
}

main().catch(console.error);
