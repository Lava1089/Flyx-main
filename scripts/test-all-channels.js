#!/usr/bin/env node
/**
 * E2E test: Hit /play for a wide range of DLHD channels via CF Worker
 * Reports which channels return valid M3U8 vs errors
 */

const https = require('https');

const CF = 'https://dlhd.vynx.workers.dev';
const API_KEY = 'vynx';

// Test channels 1-350 (covers most DLHD channels)
const TEST_CHANNELS = [];
for (let i = 1; i <= 350; i++) TEST_CHANNELS.push(i);

const CONCURRENCY = 10; // parallel requests
const TIMEOUT = 15000;

function fetch(url) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const p = new URL(url);
    const req = https.get({
      hostname: p.hostname,
      path: p.pathname + p.search,
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: TIMEOUT,
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ ms: Date.now() - t0, status: res.statusCode, buf, text: buf.toString(), headers: res.headers });
      });
    });
    req.on('error', e => resolve({ ms: Date.now() - t0, status: 0, buf: Buffer.alloc(0), text: e.message, headers: {} }));
    req.on('timeout', () => { req.destroy(); resolve({ ms: Date.now() - t0, status: 0, buf: Buffer.alloc(0), text: 'timeout', headers: {} }); });
  });
}

async function testChannel(ch) {
  const r = await fetch(`${CF}/play/${ch}?key=${API_KEY}`);
  const isM3U8 = r.text.includes('#EXTM3U') || r.text.includes('#EXT-X-');
  const hasKey = r.text.includes('#EXT-X-KEY');
  const hasSegments = r.text.split('\n').some(l => l.trim().startsWith('http') && !l.includes('workers.dev'));
  
  let error = null;
  if (!isM3U8) {
    try { error = JSON.parse(r.text); } catch { error = r.text.substring(0, 150); }
  }

  // Check server header
  const server = r.headers['x-dlhd-server'] || 'unknown';

  return { ch, status: r.status, ms: r.ms, isM3U8, hasKey, hasSegments, server, error };
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  DLHD Full Channel E2E Test                            ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`Testing channels 1-${TEST_CHANNELS[TEST_CHANNELS.length-1]} via ${CF}`);
  console.log(`Concurrency: ${CONCURRENCY}\n`);

  const results = [];
  const working = [];
  const broken = [];
  const offline = []; // 404/not found = channel doesn't exist on DLHD

  // Process in batches
  for (let i = 0; i < TEST_CHANNELS.length; i += CONCURRENCY) {
    const batch = TEST_CHANNELS.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(testChannel));
    
    for (const r of batchResults) {
      results.push(r);
      
      if (r.isM3U8) {
        working.push(r);
        process.stdout.write(`✅`);
      } else if (r.status === 404 || (r.error && typeof r.error === 'object' && r.error.code === 'STREAM_UNAVAILABLE')) {
        offline.push(r);
        process.stdout.write(`⬜`);
      } else {
        broken.push(r);
        process.stdout.write(`❌`);
      }
    }
  }

  console.log('\n');

  // Summary
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  WORKING:  ${working.length} channels`);
  console.log(`  BROKEN:   ${broken.length} channels`);
  console.log(`  OFFLINE:  ${offline.length} channels (not available on DLHD)`);
  console.log(`  TOTAL:    ${results.length} tested`);
  console.log('═══════════════════════════════════════════════════════════');

  if (working.length > 0) {
    // Show avg latency
    const avgMs = Math.round(working.reduce((s, r) => s + r.ms, 0) / working.length);
    console.log(`\n  Avg latency (working): ${avgMs}ms`);
    
    // Show server distribution
    const serverCounts = {};
    for (const r of working) {
      serverCounts[r.server] = (serverCounts[r.server] || 0) + 1;
    }
    console.log(`  Server distribution:`);
    for (const [s, c] of Object.entries(serverCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${s}: ${c} channels`);
    }
  }

  if (broken.length > 0) {
    console.log(`\n  BROKEN CHANNELS:`);
    // Group by error type
    const errorGroups = {};
    for (const r of broken) {
      const errKey = typeof r.error === 'object' ? (r.error.code || r.error.error || JSON.stringify(r.error).substring(0, 80)) : String(r.error).substring(0, 80);
      if (!errorGroups[errKey]) errorGroups[errKey] = [];
      errorGroups[errKey].push(r.ch);
    }
    for (const [err, chs] of Object.entries(errorGroups)) {
      console.log(`\n    Error: ${err}`);
      console.log(`    Channels (${chs.length}): ${chs.join(', ')}`);
    }
  }

  // List first 20 working channels for reference
  if (working.length > 0) {
    console.log(`\n  Sample working channels: ${working.slice(0, 20).map(r => r.ch).join(', ')}...`);
  }

  console.log('\n  Done.');
}

main().catch(console.error);
