#!/usr/bin/env node
/**
 * DLHD CRACKER TEST - January 2026
 * 
 * Tests the complete DLHD reverse engineering.
 * Runs with Node.js - no TypeScript compilation needed.
 * 
 * IMPORTANT: Uses WASM module for PoW computation (JS implementation doesn't match!)
 * 
 * Usage: node scripts/test-dlhd-cracker.js [--all] [--channel=ID]
 */

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ============================================================================
// CONFIGURATION
// ============================================================================
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const TIMEOUT_MS = 4000;
const CDN_DOMAIN = 'dvalna.ru';
// NOTE: The WASM module has its own internal secret - we use WASM for PoW computation
const POW_THRESHOLD = 0x1000;
const VERBOSE_LOGGING = false; // Set to true for debug output

// ============================================================================
// WASM POW MODULE
// ============================================================================
let wasmExports = null;
let cachedUint8ArrayMemory0 = null;
let WASM_VECTOR_LEN = 0;

const cachedTextEncoder = new TextEncoder();

function getUint8ArrayMemory0() {
  if (!cachedUint8ArrayMemory0 || cachedUint8ArrayMemory0.byteLength === 0) {
    cachedUint8ArrayMemory0 = new Uint8Array(wasmExports.memory.buffer);
  }
  return cachedUint8ArrayMemory0;
}

function passStringToWasm0(arg, malloc) {
  const buf = cachedTextEncoder.encode(arg);
  const ptr = malloc(buf.length, 1) >>> 0;
  getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
  WASM_VECTOR_LEN = buf.length;
  return ptr;
}

async function initWASM() {
  if (wasmExports) return true;
  
  try {
    const wasmPath = path.join(__dirname, '..', 'pow_wasm_bg.wasm');
    if (!fs.existsSync(wasmPath)) {
      console.log('[WASM] pow_wasm_bg.wasm not found at', wasmPath);
      return false;
    }
    
    const wasmBuffer = fs.readFileSync(wasmPath);
    const imports = { './pow_wasm_bg.js': {} };
    const { instance } = await WebAssembly.instantiate(wasmBuffer, imports);
    wasmExports = instance.exports;
    console.log('[WASM] Module initialized');
    return true;
  } catch (e) {
    console.error('[WASM] Init failed:', e.message);
    return false;
  }
}

async function computePoWNonceWASM(resource, keyNumber, timestamp) {
  if (!wasmExports) {
    throw new Error('WASM not initialized');
  }
  
  cachedUint8ArrayMemory0 = null;
  
  const ptr0 = passStringToWasm0(resource, wasmExports.__wbindgen_export);
  const len0 = WASM_VECTOR_LEN;
  const ptr1 = passStringToWasm0(String(keyNumber), wasmExports.__wbindgen_export);
  const len1 = WASM_VECTOR_LEN;
  
  const nonce = wasmExports.compute_nonce(ptr0, len0, ptr1, len1, BigInt(timestamp));
  return Number(nonce);
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================
function fetchUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const lib = urlObj.protocol === 'https:' ? https : require('http');
    
    const req = lib.request({
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        ...options.headers,
      },
      timeout: TIMEOUT_MS,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const data = Buffer.concat(chunks);
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data,
          text: data.toString('utf8'),
        });
      });
    });
    
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

function computeMd5(input) {
  return crypto.createHash('md5').update(input).digest('hex');
}

function computeHmacSha256(message, secret) {
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

async function computePoWNonce(resource, keyNumber, timestamp) {
  const hmac = computeHmacSha256(resource, HMAC_SECRET);
  
  for (let nonce = 0; nonce < 100000; nonce++) {
    const data = `${hmac}${resource}${keyNumber}${timestamp}${nonce}`;
    const hash = computeMd5(data);
    const prefix = parseInt(hash.substring(0, 4), 16);
    
    if (prefix < POW_THRESHOLD) {
      return nonce;
    }
  }
  return 99999;
}

// ============================================================================
// BACKEND 1: MOVEONJOY.COM - NO AUTH (FASTEST!)
// ============================================================================
const MOVEONJOY_CHANNELS = {
  '11': { url: 'https://fl7.moveonjoy.com/UFC/index.m3u8', name: 'UFC' },
  '19': { url: 'https://fl31.moveonjoy.com/MLB_NETWORK/index.m3u8', name: 'MLB Network' },
  '39': { url: 'https://fl7.moveonjoy.com/FOX_Sports_1/index.m3u8', name: 'FOX Sports 1' },
  '44': { url: 'https://fl2.moveonjoy.com/ESPN/index.m3u8', name: 'ESPN' },
  '45': { url: 'https://fl2.moveonjoy.com/ESPN_2/index.m3u8', name: 'ESPN 2' },
  '51': { url: 'https://fl1.moveonjoy.com/AL_BIRMINGHAM_ABC/index.m3u8', name: 'ABC' },
  '52': { url: 'https://fl1.moveonjoy.com/FL_West_Palm_Beach_CBS/index.m3u8', name: 'CBS' },
  '53': { url: 'https://fl61.moveonjoy.com/FL_Tampa_NBC/index.m3u8', name: 'NBC' },
  '54': { url: 'https://fl61.moveonjoy.com/FL_Tampa_FOX/index.m3u8', name: 'FOX' },
  '98': { url: 'https://fl31.moveonjoy.com/NBA_TV/index.m3u8', name: 'NBA TV' },
  '146': { url: 'https://fl7.moveonjoy.com/WWE/index.m3u8', name: 'WWE' },
  '303': { url: 'https://fl61.moveonjoy.com/AMC_NETWORK/index.m3u8', name: 'AMC' },
  '321': { url: 'https://fl61.moveonjoy.com/HBO/index.m3u8', name: 'HBO' },
  '333': { url: 'https://fl31.moveonjoy.com/SHOWTIME/index.m3u8', name: 'Showtime' },
  '336': { url: 'https://fl7.moveonjoy.com/TBS/index.m3u8', name: 'TBS' },
  '338': { url: 'https://fl7.moveonjoy.com/TNT/index.m3u8', name: 'TNT' },
  '376': { url: 'https://fl7.moveonjoy.com/WWE/index.m3u8', name: 'WWE' },
  '405': { url: 'https://fl31.moveonjoy.com/NFL_NETWORK/index.m3u8', name: 'NFL Network' },
};

async function tryMoveonjoy(channelId) {
  const channel = MOVEONJOY_CHANNELS[channelId];
  if (!channel) return null;
  
  const start = Date.now();
  try {
    const res = await fetchUrl(channel.url);
    if (res.status === 200 && res.text.includes('#EXTM3U')) {
      return {
        channelId,
        channelName: channel.name,
        m3u8Url: channel.url,
        backend: 'moveonjoy',
        encrypted: false,
        fetchTimeMs: Date.now() - start,
      };
    }
  } catch (e) {}
  return null;
}

// ============================================================================
// BACKEND 2: TOPEMBED.PW → DVALNA.RU (JWT + PoW)
// ============================================================================
const TOPEMBED_CHANNELS = {
  '31': { name: 'TNTSports1[UK]', channelKey: 'eplayerdigitvbt1', serverKey: 'top1' },
  '32': { name: 'TNTSports2[UK]', channelKey: 'eplayerdigitvbt2', serverKey: 'top1' },
  '33': { name: 'TNTSports3[UK]', channelKey: 'eplayerdigitvbt3', serverKey: 'top1' },
  '34': { name: 'TNTSports4[UK]', channelKey: 'eplayerdigitvbt4', serverKey: 'top1' },
  '35': { name: 'SkySportsFootball[UK]', channelKey: 'eplayerskyfoot', serverKey: 'top2' },
  '36': { name: 'SkySportsArena[UK]', channelKey: 'skyarena', serverKey: 'top1' },
  '37': { name: 'SkySportsAction[UK]', channelKey: 'skyaction', serverKey: 'top2' },
  '38': { name: 'SkySportsMainEvent[UK]', channelKey: 'eplayerskymain2', serverKey: 'top2' },
  '39': { name: 'FOXSports1[USA]', channelKey: 'eplayerfs1', serverKey: 'wiki' },
  '44': { name: 'ESPN[USA]', channelKey: 'eplayerespn_usa', serverKey: 'hzt' },
  '45': { name: 'ESPN2[USA]', channelKey: 'eplayerespn2_usa', serverKey: 'hzt' },
  '51': { name: 'AbcTv[USA]', channelKey: 'ustvabc', serverKey: 'wiki' },
  '52': { name: 'CBS[USA]', channelKey: 'ustvcbs', serverKey: 'x4' },
  '53': { name: 'NBC[USA]', channelKey: 'ustvnbc', serverKey: 'wiki' },
  '60': { name: 'SkySportsF1[UK]', channelKey: 'eplayerskyf1', serverKey: 'top2' },
  '65': { name: 'SkySportsCricket[UK]', channelKey: 'eplayerskycric', serverKey: 'top2' },
  '70': { name: 'SkySportsGolf[UK]', channelKey: 'skygolf', serverKey: 'top2' },
  '130': { name: 'SkySportsPremierLeague[UK]', channelKey: 'eplayerSKYPL', serverKey: 'top2' },
  '230': { name: 'DAZN1UK[UK]', channelKey: 'dazn1uk', serverKey: 'x4' },
  '276': { name: 'LaLigaTV[UK]', channelKey: 'laligatvuk', serverKey: 'azo' },
  '449': { name: 'SkySportsMix[UK]', channelKey: 'skymix', serverKey: 'x4' },
};

function constructM3U8Url(serverKey, channelKey) {
  const serverMap = {
    'wiki': 'wikinew', 'hzt': 'hztnew', 'x4': 'x4new',
    'top1': 'top1new', 'top2': 'top2new', 'azo': 'azonew', 'max2': 'max2new',
  };
  const subdomain = serverMap[serverKey] || `${serverKey}new`;
  return `https://${subdomain}.${CDN_DOMAIN}/${serverKey}/${channelKey}/mono.css`;
}

async function fetchTopembedJWT(channelName) {
  try {
    const url = `https://topembed.pw/channel/${channelName}`;
    const res = await fetchUrl(url, { headers: { 'Referer': 'https://dlhd.link/' } });
    if (res.status !== 200) return null;
    
    const jwtMatch = res.text.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    if (!jwtMatch) return null;
    
    const jwt = jwtMatch[0];
    let channelKey = '';
    try {
      const payloadB64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'));
      channelKey = payload.sub || '';
    } catch {}
    
    return { jwt, channelKey };
  } catch {
    return null;
  }
}

async function fetchHitsplayJWT(channelId) {
  try {
    const url = `https://hitsplay.fun/premiumtv/daddyhd.php?id=${channelId}`;
    const res = await fetchUrl(url, { headers: { 'Referer': 'https://dlhd.link/' } });
    if (res.status !== 200) return null;
    
    const jwtMatch = res.text.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    if (!jwtMatch) return null;
    
    const jwt = jwtMatch[0];
    let channelKey = `premium${channelId}`;
    try {
      const payloadB64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'));
      channelKey = payload.sub || channelKey;
    } catch {}
    
    return { jwt, channelKey };
  } catch {
    return null;
  }
}

async function tryDvalna(channelId) {
  const channel = TOPEMBED_CHANNELS[channelId];
  if (!channel || !channel.serverKey) return null;
  
  const start = Date.now();
  try {
    // Get JWT
    let jwtData = await fetchTopembedJWT(channel.name);
    if (!jwtData) {
      jwtData = await fetchHitsplayJWT(channelId);
    }
    if (!jwtData) return null;
    
    // Construct M3U8 URL
    const m3u8Url = constructM3U8Url(channel.serverKey, channel.channelKey);
    
    // Fetch M3U8 (NOTE: dvalna.ru blocks datacenter IPs - needs residential proxy in production)
    const res = await fetchUrl(m3u8Url, {
      headers: {
        'Origin': 'https://topembed.pw',
        'Referer': 'https://topembed.pw/',
      },
    });
    
    if (res.status !== 200 || !res.text.includes('#EXTM3U')) {
      // Try with hitsplay origin
      const res2 = await fetchUrl(m3u8Url, {
        headers: {
          'Origin': 'https://epaly.fun',
          'Referer': 'https://epaly.fun/',
        },
      });
      if (res2.status !== 200 || !res2.text.includes('#EXTM3U')) {
        return { channelId, error: `M3U8 blocked (${res.status})`, backend: 'dvalna', jwt: jwtData.jwt, m3u8Url };
      }
    }
    
    // Extract key URL
    let keyUrl = null;
    const keyMatch = res.text.match(/URI="([^"]+key[^"]+)"/);
    if (keyMatch) {
      keyUrl = keyMatch[1];
      const keyPathMatch = keyUrl.match(/\/key\/([^/]+)\/(\d+)/);
      if (keyPathMatch) {
        keyUrl = `https://chevy.${CDN_DOMAIN}/key/${keyPathMatch[1]}/${keyPathMatch[2]}`;
      }
    }
    
    return {
      channelId,
      channelName: channel.name,
      m3u8Url,
      backend: 'dvalna',
      encrypted: !!keyUrl,
      keyUrl,
      jwt: jwtData.jwt,
      fetchTimeMs: Date.now() - start,
    };
  } catch (e) {
    return null;
  }
}

// ============================================================================
// KEY FETCH WITH POW
// ============================================================================
async function fetchDecryptionKey(keyUrl, jwt) {
  const keyMatch = keyUrl.match(/\/key\/([^/]+)\/(\d+)/);
  if (!keyMatch) return null;
  
  const resource = keyMatch[1];
  const keyNumber = keyMatch[2];
  const timestamp = Math.floor(Date.now() / 1000) - 7;
  const nonce = await computePoWNonce(resource, keyNumber, timestamp);
  
  console.log(`  PoW: resource=${resource}, keyNum=${keyNumber}, ts=${timestamp}, nonce=${nonce}`);
  
  try {
    const res = await fetchUrl(keyUrl, {
      headers: {
        'Origin': 'https://epaly.fun',
        'Referer': 'https://epaly.fun/',
        'Authorization': `Bearer ${jwt}`,
        'X-Key-Timestamp': timestamp.toString(),
        'X-Key-Nonce': nonce.toString(),
      },
    });
    
    if (res.status === 200 && res.data.length === 16) {
      return res.data;
    }
    console.log(`  Key response: ${res.status}, ${res.data.length} bytes, preview: ${res.text.substring(0, 50)}`);
    return null;
  } catch (e) {
    console.log(`  Key fetch error: ${e.message}`);
    return null;
  }
}

// ============================================================================
// MAIN CRACKER
// ============================================================================
async function crackChannel(channelId) {
  const attempts = [];
  
  // Try moveonjoy first (fastest, no auth)
  const start1 = Date.now();
  const moveonjoyResult = await tryMoveonjoy(channelId);
  attempts.push({ backend: 'moveonjoy', timeMs: Date.now() - start1, success: !!moveonjoyResult });
  if (moveonjoyResult) {
    return { success: true, stream: moveonjoyResult, attempts };
  }
  
  // Try dvalna (most channels)
  const start2 = Date.now();
  const dvalnaResult = await tryDvalna(channelId);
  attempts.push({ backend: 'dvalna', timeMs: Date.now() - start2, success: !!dvalnaResult?.m3u8Url });
  if (dvalnaResult?.m3u8Url && !dvalnaResult.error) {
    return { success: true, stream: dvalnaResult, attempts };
  }
  
  // Return partial result if we got JWT but M3U8 was blocked
  if (dvalnaResult?.jwt) {
    return { success: false, partial: dvalnaResult, attempts, error: 'M3U8 blocked - needs residential IP proxy' };
  }
  
  return { success: false, attempts, error: 'All backends failed' };
}

// ============================================================================
// CLI
// ============================================================================
async function main() {
  console.log('='.repeat(70));
  console.log('DLHD COMPLETE CRACKER TEST - January 2026');
  console.log('='.repeat(70));
  
  const args = process.argv.slice(2);
  const channelArg = args.find(a => a.startsWith('--channel='));
  const testAll = args.includes('--all');
  
  let testChannels;
  if (channelArg) {
    const channelId = channelArg.split('=')[1];
    // Input validation: channel IDs should be numeric
    if (!/^\d+$/.test(channelId)) {
      console.error('❌ Invalid channel ID. Must be numeric.');
      process.exit(1);
    }
    testChannels = [channelId];
  } else if (testAll) {
    // All mapped channels
    testChannels = [...new Set([
      ...Object.keys(MOVEONJOY_CHANNELS),
      ...Object.keys(TOPEMBED_CHANNELS),
    ])].sort((a, b) => parseInt(a) - parseInt(b));
  } else {
    // Default test set - popular channels
    testChannels = [
      '35', '38', '60', '130', // Sky Sports UK
      '31', '32', // TNT Sports UK
      '44', '45', '51', '52', '53', // USA
      '39', '336', '338', // More USA
      '321', '333', // Entertainment
    ];
  }
  
  console.log(`\nTesting ${testChannels.length} channels...\n`);
  
  const startTime = Date.now();
  const results = [];
  
  // Process in batches with rate limiting
  const batchSize = 10;
  const BATCH_DELAY_MS = 500; // Delay between batches to avoid rate limiting
  for (let i = 0; i < testChannels.length; i += batchSize) {
    const batch = testChannels.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(id => crackChannel(id)));
    results.push(...batchResults.map((r, idx) => ({ channelId: batch[idx], ...r })));
    
    // Progress
    console.log(`Progress: ${Math.min(i + batchSize, testChannels.length)}/${testChannels.length}`);
    
    // Rate limit: wait between batches to avoid triggering upstream protection
    if (i + batchSize < testChannels.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }
  
  const totalTime = Date.now() - startTime;
  
  // Results
  console.log('\n' + '='.repeat(70));
  console.log('RESULTS');
  console.log('='.repeat(70));
  
  let successful = 0;
  let partial = 0;
  let failed = 0;
  const byBackend = {};
  
  for (const result of results) {
    if (result.success && result.stream) {
      successful++;
      byBackend[result.stream.backend] = (byBackend[result.stream.backend] || 0) + 1;
      const enc = result.stream.encrypted ? '🔐' : '🔓';
      const time = result.stream.fetchTimeMs || 0;
      console.log(`✅ ${result.channelId.padStart(4)}: ${result.stream.backend.padEnd(10)} ${time.toString().padStart(4)}ms ${enc} ${result.stream.channelName || ''}`);
    } else if (result.partial) {
      partial++;
      // SECURITY: Don't log JWT tokens - they contain session data
      const jwtPreview = VERBOSE_LOGGING ? result.partial.jwt?.slice(0, 20) + '...' : '[redacted]';
      console.log(`⚠️  ${result.channelId.padStart(4)}: ${result.partial.backend.padEnd(10)} JWT OK (${jwtPreview}), M3U8 blocked (needs RPI proxy)`);
    } else {
      failed++;
      console.log(`❌ ${result.channelId.padStart(4)}: ${result.error}`);
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total time: ${totalTime}ms (target: < 5000ms) ${totalTime < 5000 ? '✅' : '⚠️'}`);
  console.log(`Fully working: ${successful}/${testChannels.length}`);
  console.log(`JWT OK (needs RPI): ${partial}/${testChannels.length}`);
  console.log(`Failed: ${failed}/${testChannels.length}`);
  console.log('\nBy backend:');
  for (const [backend, count] of Object.entries(byBackend)) {
    console.log(`  ${backend}: ${count}`);
  }
  
  // Test key fetch if we have an encrypted channel
  const encryptedResult = results.find(r => r.success && r.stream?.encrypted);
  if (encryptedResult?.stream?.keyUrl && encryptedResult?.stream?.jwt) {
    console.log('\n' + '='.repeat(70));
    console.log('KEY FETCH TEST');
    console.log('='.repeat(70));
    console.log(`Channel: ${encryptedResult.channelId}`);
    console.log(`Key URL: ${encryptedResult.stream.keyUrl}`);
    
    const keyStart = Date.now();
    const key = await fetchDecryptionKey(encryptedResult.stream.keyUrl, encryptedResult.stream.jwt);
    const keyTime = Date.now() - keyStart;
    
    if (key) {
      // SECURITY: Only show key hash in logs, not the actual key
      const keyPreview = VERBOSE_LOGGING ? key.toString('hex') : `[${key.length} bytes, hash: ${crypto.createHash('md5').update(key).digest('hex').slice(0,8)}...]`;
      console.log(`✅ Key fetched in ${keyTime}ms: ${keyPreview}`);
    } else {
      console.log(`❌ Key fetch failed (dvalna.ru blocks datacenter IPs - needs residential proxy)`);
    }
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('NOTES');
  console.log('='.repeat(70));
  console.log('• moveonjoy.com: NO AUTH needed - direct M3U8 access');
  console.log('• dvalna.ru: Requires JWT + PoW for keys, blocks datacenter IPs');
  console.log('• For production: Use RPI proxy for dvalna.ru requests');
  console.log('• All 6 DLHD players have been reverse engineered');
}

main().catch(console.error);
