#!/usr/bin/env node
/**
 * Test the DLHD play endpoint (what the frontend actually uses)
 * Tests: dlhd.vynx.workers.dev/play/{channelId}
 */
const https = require('https');

function fetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(u, { method: 'GET', headers: opts.headers || {}, timeout: 30000 }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, buf, text: buf.toString(), hex: buf.toString('hex') });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

const WORKER = 'https://dlhd.vynx.workers.dev';
const API_KEY = 'vynx';
const CHANNELS = [51, 44, 35, 576]; // ESPN, Fox Sports, Sky Sports

async function testChannel(ch) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Channel ${ch}`);
  console.log('='.repeat(60));

  // Step 1: Fetch M3U8 playlist
  const playUrl = `${WORKER}/play/${ch}?key=${API_KEY}`;
  console.log(`[1] GET ${playUrl}`);
  const m = await fetch(playUrl);
  console.log(`    Status: ${m.status}`);
  console.log(`    Server: ${m.headers['x-dlhd-server'] || 'unknown'}`);

  if (!m.text.includes('#EXTM3U')) {
    console.log(`    ❌ NOT M3U8: ${m.text.substring(0, 300)}`);
    return false;
  }
  console.log(`    ✅ Valid M3U8 (${m.text.length} bytes)`);

  // Step 2: Extract and test key URL
  const keyMatch = m.text.match(/URI="([^"]+)"/);
  if (!keyMatch) {
    console.log(`    ❌ No key URI in M3U8`);
    return false;
  }

  let keyUrl = keyMatch[1];
  console.log(`\n[2] Key URL: ${keyUrl.substring(0, 120)}...`);
  const k = await fetch(keyUrl);
  console.log(`    Status: ${k.status}`);
  console.log(`    Size: ${k.buf.length} bytes`);
  console.log(`    Fetched-By: ${k.headers['x-fetched-by'] || 'unknown'}`);

  if (k.buf.length === 16) {
    const hex = k.hex;
    if (hex.startsWith('455806f8') || hex.startsWith('45c6497')) {
      console.log(`    ❌ FAKE KEY: ${hex}`);
      return false;
    }
    if (hex.startsWith('6572726f72')) {
      console.log(`    ❌ ERROR-AS-KEY: ${hex}`);
      return false;
    }
    console.log(`    ✅ REAL KEY: ${hex}`);
  } else {
    console.log(`    ❌ Invalid key size. Body: ${k.text.substring(0, 200)}`);
    return false;
  }

  // Step 3: Test first segment
  const segLines = m.text.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  if (segLines.length === 0) {
    console.log(`    ❌ No segments in M3U8`);
    return false;
  }

  const segUrl = segLines[0].trim();
  console.log(`\n[3] Segment: ${segUrl.substring(0, 120)}...`);
  const s = await fetch(segUrl);
  console.log(`    Status: ${s.status}`);
  console.log(`    Size: ${s.buf.length} bytes`);

  if (s.buf.length > 1000) {
    console.log(`    ✅ Segment OK (${s.buf.length} bytes)`);
    return true;
  } else {
    console.log(`    ❌ Segment too small: ${s.text.substring(0, 200)}`);
    return false;
  }
}

async function main() {
  console.log('Testing DLHD Play Endpoint');
  console.log(`Worker: ${WORKER}`);
  console.log(`Time: ${new Date().toISOString()}`);

  let passed = 0;
  let failed = 0;

  for (const ch of CHANNELS) {
    try {
      const ok = await testChannel(ch);
      if (ok) passed++;
      else failed++;
    } catch (e) {
      console.log(`    ❌ ERROR: ${e.message}`);
      failed++;
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${CHANNELS.length}`);
  console.log('='.repeat(60));
}

main().catch(console.error);
