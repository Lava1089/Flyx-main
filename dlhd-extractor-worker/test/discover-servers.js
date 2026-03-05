#!/usr/bin/env node
/**
 * DLHD Server Discovery Script
 * 
 * Brute-force discovers ALL working server_lookup endpoints
 * by testing every possible server/domain combination.
 */

const https = require('https');

// ALL possible servers we've seen or might exist
const POSSIBLE_SERVERS = [
  'zeko', 'zekonew', 'zeko1', 'zeko2', 'zeko3',
  'chevy', 'chevy1', 'chevy2', 'chevynew',
  'top1', 'top2', 'top3', 'top4', 'top5',
  'wind', 'wind1', 'wind2', 'windnew',
  'nfs', 'nfs1', 'nfs2',
  'ddy', 'ddy1', 'ddy2', 'ddy3', 'ddy4', 'ddy5', 'ddy6', 'ddy7', 'ddy8',
  'dokko', 'dokko1', 'dokko2', 'dokko3',
  'cdn', 'cdn1', 'cdn2',
  'stream', 'stream1', 'stream2',
  'live', 'live1', 'live2',
  'play', 'play1', 'play2',
  'hls', 'hls1', 'hls2',
  'media', 'media1', 'media2',
  'video', 'video1', 'video2',
  'tv', 'tv1', 'tv2',
  'sports', 'sports1', 'sports2',
  'premium', 'premium1', 'premium2',
  'main', 'main1', 'main2',
  'backup', 'backup1', 'backup2',
  'edge', 'edge1', 'edge2',
  'node', 'node1', 'node2',
  'server', 'server1', 'server2',
  'api', 'api1', 'api2',
];

// ALL possible domains
const POSSIBLE_DOMAINS = [
  'dvalna.ru',
  'kiko2.ru', 
  'giokko.ru',
  'kiko.ru',
  'kiko3.ru',
  'giokko2.ru',
  'dvalna2.ru',
];

const TIMEOUT = 1500; // Faster timeout
const agent = new https.Agent({ keepAlive: true, maxSockets: 200 });

// Test just one channel for speed
const TEST_CHANNEL = '51';

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

async function testLookupEndpoint(server, domain, channel) {
  const url = `https://${server}.${domain}/server_lookup?channel_id=premium${channel}`;
  const result = await fetchUrl(url);
  
  if (result && result.status === 200) {
    try {
      const data = JSON.parse(result.data);
      if (data.server_key) {
        return { server, domain, serverKey: data.server_key };
      }
    } catch {}
  }
  return null;
}

async function main() {
  console.log('═'.repeat(70));
  console.log('DLHD SERVER DISCOVERY - BRUTE FORCE');
  console.log('═'.repeat(70));
  console.log(`Testing ${POSSIBLE_SERVERS.length} servers x ${POSSIBLE_DOMAINS.length} domains = ${POSSIBLE_SERVERS.length * POSSIBLE_DOMAINS.length} combinations`);
  console.log('═'.repeat(70));
  console.log('');

  const workingEndpoints = new Set();
  const discoveredServers = new Set();
  let tested = 0;
  const total = POSSIBLE_SERVERS.length * POSSIBLE_DOMAINS.length;

  // Test all combinations in parallel batches
  const allCombinations = [];
  for (const domain of POSSIBLE_DOMAINS) {
    for (const server of POSSIBLE_SERVERS) {
      allCombinations.push({ server, domain });
    }
  }

  // Process in batches of 100 for speed
  const BATCH_SIZE = 100;
  for (let i = 0; i < allCombinations.length; i += BATCH_SIZE) {
    const batch = allCombinations.slice(i, i + BATCH_SIZE);
    
    const promises = batch.map(async ({ server, domain }) => {
      const result = await testLookupEndpoint(server, domain, TEST_CHANNEL);
      return result;
    });

    const results = await Promise.all(promises);
    
    for (const result of results) {
      if (result) {
        const endpoint = `${result.server}.${result.domain}`;
        if (!workingEndpoints.has(endpoint)) {
          workingEndpoints.add(endpoint);
          discoveredServers.add(result.serverKey);
          console.log(`✓ FOUND: https://${endpoint}/server_lookup -> ${result.serverKey}`);
        }
      }
    }

    tested += batch.length;
    process.stdout.write(`\rProgress: ${tested}/${total} (${Math.round(tested/total*100)}%)`);
  }

  console.log('\n\n' + '═'.repeat(70));
  console.log('DISCOVERY COMPLETE');
  console.log('═'.repeat(70));

  console.log('\n=== WORKING LOOKUP ENDPOINTS ===');
  const sortedEndpoints = [...workingEndpoints].sort();
  sortedEndpoints.forEach(e => console.log(`  https://${e}/server_lookup`));

  console.log('\n=== DISCOVERED SERVER KEYS ===');
  const sortedServers = [...discoveredServers].sort();
  sortedServers.forEach(s => console.log(`  ${s}`));

  console.log('\n=== CODE TO COPY ===');
  console.log('const LOOKUP_ENDPOINTS = [');
  sortedEndpoints.forEach(e => console.log(`  'https://${e}/server_lookup',`));
  console.log('];');

  console.log('\nconst DLHD_SERVERS = [');
  sortedServers.forEach(s => console.log(`  '${s}',`));
  console.log('];');
}

main().catch(console.error);
