#!/usr/bin/env node
/**
 * DLHD FAST CRACK - Get ALL channels in under 5 seconds!
 * 
 * THE KEY INSIGHT:
 * - We already have channel mappings (channelKey + serverKey) in data/dlhd-channels.json
 * - M3U8 URLs can be constructed directly: https://{server}new.dvalna.ru/{server}/{channelKey}/mono.css
 * - JWTs are valid for 5 HOURS - we can pre-fetch and cache them
 * - PoW computation is FAST (~1-10ms with WASM)
 * 
 * STRATEGY:
 * 1. Load pre-computed channel mappings
 * 2. Batch-fetch JWTs from hitsplay.fun (they accept channel IDs directly)
 * 3. Cache everything in memory/KV
 * 4. Serve channels INSTANTLY using cached data
 * 
 * This script tests the fast path and measures performance.
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ============================================================================
// CONFIGURATION
// ============================================================================
const WASM_SECRET_KEY = '444c44cc8888888844444444';
const POW_THRESHOLD = 0x0100; // 256

// Server URL patterns for dvalna.ru
const SERVER_URL_PATTERNS = {
  'wiki': 'https://wikinew.dvalna.ru/wiki/{channelKey}/mono.css',
  'hzt': 'https://hztnew.dvalna.ru/hzt/{channelKey}/mono.css',
  'x4': 'https://x4new.dvalna.ru/x4/{channelKey}/mono.css',
  'dokko1': 'https://dokko1new.dvalna.ru/dokko1/{channelKey}/mono.css',
  'top1': 'https://top1new.dvalna.ru/top1/{channelKey}/mono.css',
  'top2': 'https://top2new.dvalna.ru/top2/{channelKey}/mono.css',
  'nfs': 'https://nfsnew.dvalna.ru/nfs/{channelKey}/mono.css',
  'max2': 'https://max2new.dvalna.ru/max2/{channelKey}/mono.css',
  'azo': 'https://azonew.dvalna.ru/azo/{channelKey}/mono.css',
  'zeko': 'https://zekonew.dvalna.ru/zeko/{channelKey}/mono.css',
  'chevy': 'https://chevynew.dvalna.ru/chevy/{channelKey}/mono.css',
};

// ============================================================================
// UTILITIES
// ============================================================================
function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https');
    const lib = isHttps ? https : http;
    const urlObj = new URL(url);
    
    const req = lib.request({
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Referer': options.referer || 'https://dlhd.link/',
        ...options.headers,
      },
      timeout: options.timeout || 10000,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: Buffer.concat(chunks),
          text: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
    req.end();
  });
}

function decodeJWT(jwt) {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (payload.length % 4 !== 0) payload += '=';
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

// Pure JS PoW computation (matches WASM exactly)
function computePoWNonce(resource, keyNumber, timestamp) {
  for (let nonce = 0; nonce < 1000000; nonce++) {
    const data = `${WASM_SECRET_KEY}${resource}${keyNumber}${timestamp}`;
    const hash = crypto.createHash('sha256').update(data + nonce).digest();
    const prefix = (hash[0] << 8) | hash[1];
    if (prefix < POW_THRESHOLD) {
      return nonce;
    }
  }
  return 0;
}

// ============================================================================
// FAST JWT FETCHER
// ============================================================================
// hitsplay.fun accepts channel IDs directly and returns JWTs
// We can batch-fetch these efficiently
async function fetchJWTFromHitsplay(channelId) {
  const url = `https://hitsplay.fun/premiumtv/daddyhd.php?id=${channelId}`;
  try {
    const res = await fetch(url, { timeout: 5000 });
    if (res.status !== 200) return null;
    
    const jwtMatch = res.text.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    if (!jwtMatch) return null;
    
    const payload = decodeJWT(jwtMatch[0]);
    return {
      jwt: jwtMatch[0],
      channelKey: payload?.sub || `premium${channelId}`,
      exp: payload?.exp || (Math.floor(Date.now() / 1000) + 18000),
    };
  } catch {
    return null;
  }
}

// ============================================================================
// FAST M3U8 URL CONSTRUCTOR
// ============================================================================
function constructM3U8Url(channelKey, serverKey) {
  const pattern = SERVER_URL_PATTERNS[serverKey];
  if (!pattern) {
    // Default to zeko if server unknown
    return `https://zekonew.dvalna.ru/zeko/${channelKey}/mono.css`;
  }
  return pattern.replace('{channelKey}', channelKey);
}

// ============================================================================
// MAIN TEST
// ============================================================================
async function testFastPath() {
  console.log('='.repeat(70));
  console.log('DLHD FAST CRACK - Performance Test');
  console.log('='.repeat(70));
  console.log('');
  
  // Load channel mappings
  const channelsPath = path.join(__dirname, '..', 'data', 'dlhd-channels.json');
  if (!fs.existsSync(channelsPath)) {
    console.error('ERROR: data/dlhd-channels.json not found!');
    console.error('Run: node scripts/map-dlhd-channels.js first');
    process.exit(1);
  }
  
  const channels = JSON.parse(fs.readFileSync(channelsPath, 'utf8'));
  const topembedChannels = channels.filter(c => c.source === 'topembed' && c.serverKey);
  
  console.log(`Loaded ${channels.length} channels (${topembedChannels.length} with topembed mapping)`);
  console.log('');
  
  // Test channels
  const testChannels = [
    { id: '35', name: 'Sky Sports Football' },
    { id: '44', name: 'ESPN' },
    { id: '130', name: 'Sky Sports Premier League' },
    { id: '51', name: 'ABC' },
    { id: '31', name: 'TNT Sports 1' },
  ];
  
  console.log('Testing FAST PATH (pre-computed URLs + cached JWT):');
  console.log('-'.repeat(70));
  
  for (const test of testChannels) {
    const channel = channels.find(c => c.id === parseInt(test.id));
    if (!channel) {
      console.log(`  ${test.name}: NOT IN MAPPING`);
      continue;
    }
    
    const startTime = Date.now();
    
    // Step 1: Construct M3U8 URL directly (NO SERVER LOOKUP!)
    const m3u8Url = constructM3U8Url(channel.channelKey, channel.serverKey);
    const urlTime = Date.now() - startTime;
    
    // Step 2: Fetch JWT (this would be cached in production)
    const jwtStart = Date.now();
    const jwtData = await fetchJWTFromHitsplay(test.id);
    const jwtTime = Date.now() - jwtStart;
    
    if (!jwtData) {
      console.log(`  ${test.name}: JWT FETCH FAILED (${jwtTime}ms)`);
      continue;
    }
    
    // Step 3: Fetch M3U8
    const m3u8Start = Date.now();
    try {
      const m3u8Res = await fetch(m3u8Url, { 
        timeout: 5000,
        referer: 'https://epaly.fun/',
      });
      const m3u8Time = Date.now() - m3u8Start;
      
      if (m3u8Res.status !== 200 || !m3u8Res.text.includes('#EXTM3U')) {
        console.log(`  ${test.name}: M3U8 FAILED (${m3u8Res.status}) - ${m3u8Time}ms`);
        continue;
      }
      
      // Extract key URL for PoW test
      const keyMatch = m3u8Res.text.match(/URI="([^"]+key[^"]+)"/);
      let keyTime = 0;
      let powTime = 0;
      
      if (keyMatch) {
        const keyUrl = keyMatch[1];
        const keyPathMatch = keyUrl.match(/\/key\/([^/]+)\/(\d+)/);
        
        if (keyPathMatch) {
          const resource = keyPathMatch[1];
          const keyNumber = keyPathMatch[2];
          const timestamp = Math.floor(Date.now() / 1000);
          
          // Step 4: Compute PoW
          const powStart = Date.now();
          const nonce = computePoWNonce(resource, keyNumber, timestamp);
          powTime = Date.now() - powStart;
          
          // Step 5: Fetch key
          const keyStart = Date.now();
          const keyRes = await fetch(keyUrl, {
            timeout: 5000,
            headers: {
              'Authorization': `Bearer ${jwtData.jwt}`,
              'X-Key-Timestamp': timestamp.toString(),
              'X-Key-Nonce': nonce.toString(),
              'Origin': 'https://epaly.fun',
            },
            referer: 'https://epaly.fun/',
          });
          keyTime = Date.now() - keyStart;
          
          if (keyRes.status === 200 && keyRes.data.length === 16) {
            const totalTime = Date.now() - startTime;
            console.log(`  ✓ ${test.name}: ${totalTime}ms total (url:${urlTime}ms, jwt:${jwtTime}ms, m3u8:${m3u8Time}ms, pow:${powTime}ms, key:${keyTime}ms)`);
          } else {
            console.log(`  ✗ ${test.name}: KEY FAILED (${keyRes.status}) - ${keyRes.text.substring(0, 50)}`);
          }
        }
      } else {
        const totalTime = Date.now() - startTime;
        console.log(`  ✓ ${test.name}: ${totalTime}ms (no encryption)`);
      }
    } catch (e) {
      console.log(`  ✗ ${test.name}: ${e.message}`);
    }
  }
  
  console.log('');
  console.log('='.repeat(70));
  console.log('ANALYSIS:');
  console.log('='.repeat(70));
  console.log('');
  console.log('Current bottlenecks:');
  console.log('  1. JWT fetch: 500-2000ms (MUST BE CACHED!)');
  console.log('  2. M3U8 fetch: 200-500ms (unavoidable network latency)');
  console.log('  3. Key fetch: 200-500ms (unavoidable network latency)');
  console.log('  4. PoW computation: 1-10ms (ALREADY FAST!)');
  console.log('');
  console.log('SOLUTION for <5 second startup:');
  console.log('  1. Pre-fetch JWTs for ALL channels on worker startup');
  console.log('  2. Cache JWTs in KV with 4-hour TTL (they expire in 5 hours)');
  console.log('  3. Use pre-computed M3U8 URLs (no server lookup!)');
  console.log('  4. Result: Only M3U8 + Key fetch needed = ~1-2 seconds');
  console.log('');
}

// ============================================================================
// JWT BATCH FETCHER
// ============================================================================
async function batchFetchJWTs() {
  console.log('='.repeat(70));
  console.log('BATCH JWT FETCHER - Pre-fetch all JWTs');
  console.log('='.repeat(70));
  console.log('');
  
  const channelsPath = path.join(__dirname, '..', 'data', 'dlhd-channels.json');
  const channels = JSON.parse(fs.readFileSync(channelsPath, 'utf8'));
  const topembedChannels = channels.filter(c => c.source === 'topembed' && c.serverKey);
  
  console.log(`Fetching JWTs for ${topembedChannels.length} channels...`);
  console.log('');
  
  const jwtCache = {};
  const batchSize = 20;
  const startTime = Date.now();
  
  for (let i = 0; i < topembedChannels.length; i += batchSize) {
    const batch = topembedChannels.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (ch) => {
        const jwt = await fetchJWTFromHitsplay(ch.id);
        return { id: ch.id, jwt };
      })
    );
    
    for (const r of results) {
      if (r.jwt) {
        jwtCache[r.id] = r.jwt;
      }
    }
    
    const progress = Math.round(((i + batchSize) / topembedChannels.length) * 100);
    process.stdout.write(`\r  Progress: ${Math.min(progress, 100)}% (${Object.keys(jwtCache).length} JWTs cached)`);
    
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 200));
  }
  
  const totalTime = Date.now() - startTime;
  console.log('');
  console.log('');
  console.log(`Fetched ${Object.keys(jwtCache).length} JWTs in ${(totalTime / 1000).toFixed(1)}s`);
  
  // Save to file for testing
  const cachePath = path.join(__dirname, '..', 'data', 'dlhd-jwt-cache.json');
  fs.writeFileSync(cachePath, JSON.stringify(jwtCache, null, 2));
  console.log(`Saved to: ${cachePath}`);
  
  return jwtCache;
}

// ============================================================================
// MAIN
// ============================================================================
const args = process.argv.slice(2);

if (args.includes('--batch-jwt')) {
  batchFetchJWTs().catch(console.error);
} else {
  testFastPath().catch(console.error);
}
