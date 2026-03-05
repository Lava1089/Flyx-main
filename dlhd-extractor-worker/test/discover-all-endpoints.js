#!/usr/bin/env node
/**
 * DLHD Complete Endpoint Discovery
 * 
 * Tests ALL possible lookup endpoints against sample channels
 * to find every working endpoint
 */

const https = require('https');

// All possible server prefixes
const POSSIBLE_PREFIXES = [
  'zeko', 'zekonew', 'zeko1', 'zeko2',
  'chevy', 'chevynew', 'chevy1', 'chevy2',
  'top1', 'top2', 'top3', 'top4', 'top5',
  'wind', 'windnew', 'wind1', 'wind2',
  'nfs', 'nfsnew', 'nfs1', 'nfs2',
  'ddy', 'ddy1', 'ddy2', 'ddy3', 'ddy4', 'ddy5', 'ddy6', 'ddy7', 'ddy8',
  'dokko', 'dokko1', 'dokko2', 'dokko3',
  'wiki', 'wikinew', 'wiki1', 'wiki2',
  'cdn', 'cdn1', 'cdn2', 'cdnnew',
  'stream', 'streamnew',
  'live', 'livenew',
  'play', 'playnew',
  'hls', 'hlsnew',
  'media', 'medianew',
  'video', 'videonew',
  'main', 'mainnew',
  'backup', 'backupnew',
  'edge', 'edgenew',
  'api', 'apinew',
];

// All possible domains
const POSSIBLE_DOMAINS = [
  'dvalna.ru',
  'kiko2.ru',
  'giokko.ru',
];

const TIMEOUT = 2000;
const agent = new https.Agent({ keepAlive: true, maxSockets: 200 });

// Sample channels across the range
const SAMPLE_CHANNELS = ['4', '40', '51', '65', '100', '200', '300', '400', '439', '500', '600', '700', '800'];

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

async function testEndpoint(prefix, domain, channel) {
  const url = `https://${prefix}.${domain}/server_lookup?channel_id=premium${channel}`;
  const result = await fetchUrl(url);
  
  if (result && result.status === 200) {
    try {
      const data = JSON.parse(result.data);
      if (data.server_key) {
        return { prefix, domain, serverKey: data.server_key, channel };
      }
    } catch {}
  }
  return null;
}

async function main() {
  console.log('═'.repeat(70));
  console.log('DLHD ENDPOINT DISCOVERY');
  console.log('═'.repeat(70));
  console.log(`Testing ${POSSIBLE_PREFIXES.length} prefixes x ${POSSIBLE_DOMAINS.length} domains`);
  console.log(`Sample channels: ${SAMPLE_CHANNELS.join(', ')}`);
  console.log('═'.repeat(70));
  console.log('');

  const workingEndpoints = new Map(); // endpoint -> Set of server_keys returned
  let tested = 0;
  const total = POSSIBLE_PREFIXES.length * POSSIBLE_DOMAINS.length;

  // Build all combinations
  const combinations = [];
  for (const domain of POSSIBLE_DOMAINS) {
    for (const prefix of POSSIBLE_PREFIXES) {
      combinations.push({ prefix, domain });
    }
  }

  // Test in batches
  const BATCH_SIZE = 50;
  for (let i = 0; i < combinations.length; i += BATCH_SIZE) {
    const batch = combinations.slice(i, i + BATCH_SIZE);
    
    const promises = batch.flatMap(({ prefix, domain }) => 
      SAMPLE_CHANNELS.map(channel => testEndpoint(prefix, domain, channel))
    );

    const results = await Promise.all(promises);
    
    for (const result of results) {
      if (result) {
        const endpoint = `${result.prefix}.${result.domain}`;
        if (!workingEndpoints.has(endpoint)) {
          workingEndpoints.set(endpoint, new Set());
          console.log(`✓ FOUND ENDPOINT: https://${endpoint}/server_lookup`);
        }
        workingEndpoints.get(endpoint).add(result.serverKey);
      }
    }

    tested += batch.length;
    process.stdout.write(`\rProgress: ${tested}/${total} (${Math.round(tested/total*100)}%)`);
  }

  console.log('\n\n' + '═'.repeat(70));
  console.log('DISCOVERY COMPLETE');
  console.log('═'.repeat(70));

  console.log(`\nFound ${workingEndpoints.size} working lookup endpoints`);

  console.log('\n=== WORKING ENDPOINTS ===');
  const sortedEndpoints = [...workingEndpoints.entries()].sort();
  sortedEndpoints.forEach(([endpoint, servers]) => {
    console.log(`  https://${endpoint}/server_lookup -> returns: ${[...servers].join(', ')}`);
  });

  console.log('\n=== CODE TO COPY ===');
  console.log('const LOOKUP_ENDPOINTS = [');
  sortedEndpoints.forEach(([endpoint]) => console.log(`  'https://${endpoint}/server_lookup',`));
  console.log('];');
}

main().catch(console.error);
