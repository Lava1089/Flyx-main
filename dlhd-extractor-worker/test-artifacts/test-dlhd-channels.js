/**
 * Test DLHD channels - Sky Sports and other popular channels
 * Tests the full flow: JWT fetch → manifest → key fetch
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');
// Note: fs removed - was unused

// Sky Sports and popular channels to test
const TEST_CHANNELS = [
  { id: '35', name: 'Sky Sports Football' },
  { id: '36', name: 'Sky Sports Arena' },
  { id: '37', name: 'Sky Sports Action' },
  { id: '38', name: 'Sky Sports Main Event' },
  { id: '130', name: 'Sky Sports Premier League' },
  { id: '44', name: 'ESPN' },
  { id: '45', name: 'ESPN 2' },
  { id: '31', name: 'TNT Sports 1' },
];

// Config - SECURITY: Use environment variables, no hardcoded URLs in public repos
const CF_PROXY_URL = process.env.CF_PROXY_URL;
const LOCAL_PROXY_URL = process.env.LOCAL_PROXY_URL || 'http://localhost:8787';
const USE_LOCAL = process.argv.includes('--local');

if (!USE_LOCAL && !CF_PROXY_URL) {
  console.error('ERROR: CF_PROXY_URL environment variable required for remote testing');
  console.error('Usage: CF_PROXY_URL=https://your-proxy.workers.dev node test-dlhd-channels.js');
  console.error('   or: node test-dlhd-channels.js --local');
  process.exit(1);
}

const PROXY_URL = USE_LOCAL ? LOCAL_PROXY_URL : CF_PROXY_URL;

async function fetchUrl(url, options = {}) {
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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...options.headers,
      },
      timeout: 15000,
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
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

async function testChannel(channel) {
  const startTime = Date.now();
  const results = {
    channel: channel.id,
    name: channel.name,
    steps: [],
    success: false,
    totalTime: 0,
  };
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${channel.name} (ID: ${channel.id})`);
  console.log('='.repeat(60));
  
  try {
    // Step 1: Fetch manifest from proxy
    const manifestUrl = `${PROXY_URL}/tv?channel=${channel.id}`;
    console.log(`\n[1] Fetching manifest: ${manifestUrl}`);
    
    const t1 = Date.now();
    const manifestRes = await fetchUrl(manifestUrl, {
      headers: { 'Origin': 'https://tv.vynx.cc', 'Referer': 'https://tv.vynx.cc/' }
    });
    const manifestTime = Date.now() - t1;
    
    results.steps.push({ step: 'manifest', time: manifestTime, status: manifestRes.status });
    console.log(`   Status: ${manifestRes.status} (${manifestTime}ms)`);
    console.log(`   Backend: ${manifestRes.headers['x-dlhd-backend'] || 'unknown'}`);
    
    if (manifestRes.status !== 200) {
      console.log(`   ERROR: ${manifestRes.text.substring(0, 200)}`);
      results.error = `Manifest failed: ${manifestRes.status}`;
      return results;
    }
    
    const manifest = manifestRes.text;
    if (!manifest.includes('#EXTM3U')) {
      console.log(`   ERROR: Invalid manifest`);
      results.error = 'Invalid manifest';
      return results;
    }
    
    console.log(`   ✓ Valid M3U8 (${manifest.length} bytes)`);
    
    // Step 2: Extract key URL from manifest
    const keyMatch = manifest.match(/URI="([^"]+key[^"]+)"/);
    if (!keyMatch) {
      console.log(`   No encryption key needed (unencrypted stream)`);
      results.steps.push({ step: 'key', time: 0, status: 'not_needed' });
    } else {
      const keyUrl = keyMatch[1];
      console.log(`\n[2] Fetching key: ${keyUrl.substring(0, 80)}...`);
      
      const t2 = Date.now();
      const keyRes = await fetchUrl(keyUrl, {
        headers: { 'Origin': 'https://tv.vynx.cc', 'Referer': 'https://tv.vynx.cc/' }
      });
      const keyTime = Date.now() - t2;
      
      results.steps.push({ step: 'key', time: keyTime, status: keyRes.status });
      console.log(`   Status: ${keyRes.status} (${keyTime}ms)`);
      
      if (keyRes.status !== 200) {
        console.log(`   ERROR: ${keyRes.text.substring(0, 200)}`);
        results.error = `Key failed: ${keyRes.status}`;
        return results;
      }
      
      if (keyRes.data.length !== 16) {
        console.log(`   ERROR: Invalid key size: ${keyRes.data.length} (expected 16)`);
        results.error = `Invalid key size: ${keyRes.data.length}`;
        return results;
      }
      
      console.log(`   ✓ Valid AES-128 key (${keyRes.data.length} bytes, hash: ${require('crypto').createHash('md5').update(keyRes.data).digest('hex').substring(0, 8)}...)`);
    }
    
    // Step 3: Extract and test first segment
    const segmentMatch = manifest.match(/https?:\/\/[^\s]+\.ts[^\s]*/m) || 
                         manifest.match(/segment\?url=[^\s]+/m);
    
    if (segmentMatch) {
      let segmentUrl = segmentMatch[0];
      // If it's a relative URL, make it absolute
      if (segmentUrl.startsWith('segment?')) {
        segmentUrl = `${PROXY_URL}/${segmentUrl}`;
      }
      
      console.log(`\n[3] Testing segment: ${segmentUrl.substring(0, 80)}...`);
      
      const t3 = Date.now();
      const segRes = await fetchUrl(segmentUrl, {
        headers: { 'Origin': 'https://tv.vynx.cc', 'Referer': 'https://tv.vynx.cc/' }
      });
      const segTime = Date.now() - t3;
      
      results.steps.push({ step: 'segment', time: segTime, status: segRes.status });
      console.log(`   Status: ${segRes.status} (${segTime}ms)`);
      
      if (segRes.status === 200) {
        const firstByte = segRes.data[0];
        const isValidTS = firstByte === 0x47;
        console.log(`   Size: ${segRes.data.length} bytes`);
        console.log(`   Valid TS: ${isValidTS ? '✓' : '✗'} (first byte: 0x${firstByte?.toString(16)})`);
        
        if (!isValidTS) {
          console.log(`   Preview: ${segRes.text.substring(0, 100)}`);
        }
      } else {
        console.log(`   ERROR: ${segRes.text.substring(0, 200)}`);
      }
    }
    
    results.success = true;
    results.totalTime = Date.now() - startTime;
    console.log(`\n✓ SUCCESS - Total time: ${results.totalTime}ms`);
    
  } catch (error) {
    results.error = error.message;
    results.totalTime = Date.now() - startTime;
    console.log(`\n✗ FAILED: ${error.message}`);
  }
  
  return results;
}

async function main() {
  console.log('DLHD Channel Test Suite');
  console.log(`Proxy: ${PROXY_URL}`);
  console.log(`Time: ${new Date().toISOString()}`);
  
  const results = [];
  
  for (const channel of TEST_CHANNELS) {
    const result = await testChannel(channel);
    results.push(result);
    
    // Small delay between tests to avoid rate limiting
    await new Promise(r => setTimeout(r, 1000));
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(`\nSuccessful: ${successful.length}/${results.length}`);
  if (successful.length > 0) {
    const avgTime = Math.round(successful.reduce((a, r) => a + r.totalTime, 0) / successful.length);
    console.log(`Average load time: ${avgTime}ms`);
    
    console.log('\nFastest channels:');
    successful.sort((a, b) => a.totalTime - b.totalTime).slice(0, 3).forEach(r => {
      console.log(`  ${r.name}: ${r.totalTime}ms`);
    });
  }
  
  if (failed.length > 0) {
    console.log('\nFailed channels:');
    failed.forEach(r => {
      console.log(`  ${r.name}: ${r.error}`);
    });
  }
}

main().catch(console.error);
