#!/usr/bin/env node
/**
 * DLHD Full E2E Test - March 2026
 * 
 * Simulates EXACTLY what the browser does:
 * 1. Hit /play/:channelId on the CF worker (like HLS.js does)
 * 2. Parse the returned M3U8
 * 3. Verify key URIs point to dlhd.vynx.workers.dev/key (NOT rpi-proxy)
 * 4. Fetch a key through the /key endpoint (like HLS.js does — no API key)
 * 5. Verify we get a valid 16-byte AES key
 * 6. Fetch a segment to verify it's reachable
 */

const https = require('https');
const http = require('http');

const WORKER_BASE = 'https://dlhd.vynx.workers.dev';
const API_KEY = 'vynx';
const TEST_CHANNEL = '44'; // ESPN-ish, usually online

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: options.timeout || 15000,
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ 
          status: res.statusCode, 
          headers: res.headers, 
          body: buf.toString('utf8'),
          buffer: buf,
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

let passed = 0, failed = 0;
function ok(msg) { passed++; console.log(`  ✅ ${msg}`); }
function fail(msg, reason) { failed++; console.log(`  ❌ ${msg}: ${reason}`); }
function info(msg) { console.log(`  ℹ️  ${msg}`); }

async function main() {
  console.log('=== DLHD Full E2E Test ===\n');
  console.log(`Worker: ${WORKER_BASE}`);
  console.log(`Channel: ${TEST_CHANNEL}\n`);

  // ============================================================
  // STEP 1: Hit /play endpoint (like the frontend does)
  // ============================================================
  console.log('STEP 1: Fetch M3U8 from /play endpoint');
  let m3u8 = null;
  let keyUrls = [];
  let segmentUrls = [];
  
  try {
    const playUrl = `${WORKER_BASE}/play/${TEST_CHANNEL}?key=${API_KEY}`;
    info(`GET ${playUrl}`);
    const res = await fetch(playUrl);
    
    info(`Status: ${res.status}`);
    info(`Content-Type: ${res.headers['content-type']}`);
    info(`X-DLHD-Server: ${res.headers['x-dlhd-server'] || 'not set'}`);
    
    if (res.status !== 200) {
      fail('M3U8 fetch', `Status ${res.status}: ${res.body.substring(0, 200)}`);
    } else if (!res.body.includes('#EXTM3U')) {
      fail('M3U8 fetch', `Not a valid M3U8: ${res.body.substring(0, 200)}`);
    } else {
      m3u8 = res.body;
      ok(`Got valid M3U8 (${m3u8.length} bytes)`);
      
      // Show first 15 lines
      const lines = m3u8.split('\n').slice(0, 15);
      console.log('\n  --- M3U8 preview ---');
      lines.forEach(l => console.log(`  ${l}`));
      console.log('  --- end preview ---\n');
    }
  } catch (e) {
    fail('M3U8 fetch', e.message);
  }
  
  if (!m3u8) {
    console.log('\n⛔ Cannot continue without M3U8. Aborting.');
    process.exit(1);
  }

  // ============================================================
  // STEP 2: Parse M3U8 — check key URIs and segments
  // ============================================================
  console.log('STEP 2: Parse M3U8 content');
  
  const m3u8Lines = m3u8.split('\n');
  for (const line of m3u8Lines) {
    const trimmed = line.trim();
    
    // Extract key URIs
    if (trimmed.startsWith('#EXT-X-KEY')) {
      const uriMatch = trimmed.match(/URI="([^"]+)"/);
      if (uriMatch) keyUrls.push(uriMatch[1]);
    }
    
    // Extract segment URLs (non-comment, non-empty lines)
    if (trimmed && !trimmed.startsWith('#')) {
      segmentUrls.push(trimmed);
    }
  }
  
  info(`Found ${keyUrls.length} key URI(s), ${segmentUrls.length} segment(s)`);
  
  if (keyUrls.length === 0) {
    fail('Key URI extraction', 'No EXT-X-KEY URIs found in M3U8');
  } else {
    // Check that ALL key URIs point to the worker, NOT to rpi-proxy
    let allGood = true;
    for (const keyUrl of keyUrls) {
      if (keyUrl.includes('rpi-proxy')) {
        fail('Key URI leak', `Key URL exposes RPI: ${keyUrl}`);
        allGood = false;
      } else if (keyUrl.includes('dlhd.vynx.workers.dev/key')) {
        // Good — routed through worker
      } else if (keyUrl.includes('chevy.soyspace.cyou') || keyUrl.includes('go.ai-chatx.site')) {
        fail('Key URI not rewritten', `Key URL still points to upstream: ${keyUrl}`);
        allGood = false;
      } else {
        fail('Key URI unknown', `Unexpected key URL: ${keyUrl}`);
        allGood = false;
      }
    }
    if (allGood) {
      ok(`All ${keyUrls.length} key URI(s) correctly point to worker /key endpoint`);
      info(`Example: ${keyUrls[0].substring(0, 100)}...`);
    }
  }
  
  if (segmentUrls.length === 0) {
    fail('Segment extraction', 'No segment URLs found');
  } else {
    // Check segments are absolute URLs to public CDNs
    const firstSeg = segmentUrls[0];
    if (firstSeg.startsWith('http')) {
      ok(`Segments are absolute URLs`);
      info(`Example: ${firstSeg.substring(0, 100)}`);
    } else {
      fail('Segment URLs', `Relative segment URL: ${firstSeg}`);
    }
  }

  // ============================================================
  // STEP 3: Fetch a key through /key endpoint (NO API key — like HLS.js)
  // ============================================================
  console.log('\nSTEP 3: Fetch decryption key via /key endpoint (no auth)');
  
  if (keyUrls.length === 0) {
    console.log('  ⛔ No key URLs to test. Skipping.');
  } else {
    const testKeyUrl = keyUrls[0];
    info(`GET ${testKeyUrl.substring(0, 120)}...`);
    
    try {
      // HLS.js sends NO API key, NO custom headers — just a plain GET
      const res = await fetch(testKeyUrl, { timeout: 20000 });
      
      info(`Status: ${res.status}`);
      info(`Content-Type: ${res.headers['content-type']}`);
      info(`Body size: ${res.buffer.length} bytes`);
      info(`CORS: ${res.headers['access-control-allow-origin'] || 'not set'}`);
      
      if (res.status === 401) {
        fail('Key fetch', '401 Unauthorized — /key route still requires auth!');
      } else if (res.status === 502) {
        // Check if it's a known error
        let errMsg = '';
        try { errMsg = JSON.parse(res.body).error || res.body; } catch { errMsg = res.body.substring(0, 200); }
        fail('Key fetch', `502 from RPI proxy: ${errMsg}`);
      } else if (res.status === 504) {
        fail('Key fetch', '504 Gateway Timeout — RPI proxy unreachable');
      } else if (res.status !== 200) {
        fail('Key fetch', `Unexpected status ${res.status}: ${res.body.substring(0, 200)}`);
      } else if (res.buffer.length !== 16) {
        // Check if it's JSON error
        try {
          const json = JSON.parse(res.body);
          fail('Key fetch', `Got JSON instead of binary key: ${JSON.stringify(json)}`);
        } catch {
          fail('Key fetch', `Expected 16 bytes, got ${res.buffer.length}`);
        }
      } else {
        // Got 16 bytes — check if it's a known fake key
        const hex = res.buffer.toString('hex');
        const fakeKeys = ['45db13cfa0ed393fdb7da4dfe9b5ac81', '455806f8bc592fdacb6ed5e071a517b1'];
        if (fakeKeys.includes(hex)) {
          fail('Key fetch', `Got FAKE key: ${hex}`);
        } else {
          ok(`Valid 16-byte AES key: ${hex}`);
        }
      }
    } catch (e) {
      fail('Key fetch', e.message);
    }
  }

  // ============================================================
  // STEP 4: Fetch a segment to verify CDN reachability
  // ============================================================
  console.log('\nSTEP 4: Fetch a segment from CDN');
  
  if (segmentUrls.length === 0) {
    console.log('  ⛔ No segment URLs to test. Skipping.');
  } else {
    const testSegUrl = segmentUrls[0];
    info(`GET ${testSegUrl.substring(0, 120)}...`);
    
    try {
      const res = await fetch(testSegUrl, { timeout: 10000 });
      info(`Status: ${res.status}`);
      info(`Content-Type: ${res.headers['content-type']}`);
      info(`Body size: ${res.buffer.length} bytes`);
      
      if (res.status === 200 && res.buffer.length > 100) {
        ok(`Segment fetched (${res.buffer.length} bytes)`);
      } else {
        fail('Segment fetch', `Status ${res.status}, ${res.buffer.length} bytes`);
      }
    } catch (e) {
      fail('Segment fetch', e.message);
    }
  }

  // ============================================================
  // STEP 5: Test CORS preflight on /key (HLS.js may send OPTIONS)
  // ============================================================
  console.log('\nSTEP 5: CORS preflight on /key');
  
  try {
    const corsUrl = `${WORKER_BASE}/key?url=test`;
    const res = await fetch(corsUrl, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://tv.vynx.cc',
        'Access-Control-Request-Method': 'GET',
      },
    });
    info(`OPTIONS status: ${res.status}`);
    info(`ACAO: ${res.headers['access-control-allow-origin'] || 'not set'}`);
    info(`ACAM: ${res.headers['access-control-allow-methods'] || 'not set'}`);
    
    if (res.status >= 200 && res.status < 300) {
      ok('CORS preflight passes');
    } else {
      fail('CORS preflight', `Status ${res.status}`);
    }
  } catch (e) {
    fail('CORS preflight', e.message);
  }

  // ============================================================
  // Summary
  // ============================================================
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed === 0) {
    console.log('🎉 Full E2E pipeline working!');
  } else {
    console.log('⚠️  Issues found — see failures above');
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
