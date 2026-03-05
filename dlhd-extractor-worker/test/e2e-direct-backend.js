#!/usr/bin/env node
/**
 * End-to-End Test for DLHD Direct Backend Access
 * 
 * Tests the full flow:
 * 1. Fetch JWT from hitsplay.fun
 * 2. Find working server
 * 3. Get M3U8 URL
 * 4. Verify stream is playable
 */

const https = require('https');

const JWT_SOURCE_URL = 'https://hitsplay.fun/premiumtv/daddyhd.php';
// All 6 servers discovered by scanning 850 channels (Jan 2026)
const DLHD_SERVERS = ['ddy6', 'zeko', 'wind', 'dokko1', 'nfs', 'wiki'];
const DLHD_DOMAINS = ['dvalna.ru', 'kiko2.ru', 'giokko.ru'];
const LOOKUP_ENDPOINT = 'https://chevy.dvalna.ru/server_lookup';

// Test channels - using channels that are known to work
const TEST_CHANNELS = ['51', '65', '70'];

// Shorter timeout for faster testing
const FETCH_TIMEOUT = 8000;

/**
 * Fetch with promise wrapper
 */
function fetchUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...options.headers,
      },
      timeout: FETCH_TIMEOUT,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

/**
 * Fetch JWT auth data
 */
async function fetchAuthData(channelId) {
  console.log(`\n[Auth] Fetching JWT for channel ${channelId}...`);
  
  const url = `${JWT_SOURCE_URL}?id=${channelId}`;
  const result = await fetchUrl(url, {
    headers: { 'Referer': 'https://dlhd.link/' }
  });
  
  if (result.status !== 200) {
    console.log(`[Auth] ❌ Failed: HTTP ${result.status}`);
    return null;
  }
  
  // Extract JWT token
  const jwtMatch = result.data.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  if (!jwtMatch) {
    console.log(`[Auth] ❌ No JWT found in response`);
    return null;
  }
  
  const token = jwtMatch[0];
  
  // Decode JWT payload
  try {
    const payloadB64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'));
    
    console.log(`[Auth] ✅ JWT obtained:`);
    console.log(`       - Subject: ${payload.sub || 'unknown'}`);
    console.log(`       - Country: ${payload.country || 'US'}`);
    console.log(`       - Expires: ${payload.exp ? new Date(payload.exp * 1000).toISOString() : 'unknown'}`);
    
    return {
      token,
      channelKey: payload.sub || `premium${channelId}`,
      country: payload.country || 'US',
      exp: payload.exp,
    };
  } catch (e) {
    console.log(`[Auth] ⚠️ JWT decode failed, using basic auth`);
    return {
      token,
      channelKey: `premium${channelId}`,
      country: 'US',
    };
  }
}

/**
 * Build M3U8 URL
 */
function buildM3U8Url(channelId, server, domain) {
  return `https://${server}.${domain}/${server}/premium${channelId}/mono.css`;
}

/**
 * Look up server for a channel - uses the single working endpoint
 */
async function lookupServer(channelId) {
  const channelKey = `premium${channelId}`;
  const url = `${LOOKUP_ENDPOINT}?channel_id=${channelKey}`;
  
  try {
    const result = await fetchUrl(url, {
      headers: { 'Referer': 'https://epicplayplay.cfd/' }
    });
    
    if (result.status === 200) {
      const data = JSON.parse(result.data);
      if (data.server_key) {
        console.log(`[Lookup] Server for channel ${channelId}: ${data.server_key}`);
        return data.server_key;
      }
    }
  } catch {
    // Lookup failed
  }
  
  return null;
}

/**
 * Find working server - first tries lookup, then probes ALL servers in parallel
 */
async function findWorkingServer(channelId, authData) {
  console.log(`\n[Server] Finding working server for channel ${channelId}...`);
  
  // First try server lookup
  const lookedUpServer = await lookupServer(channelId);
  if (lookedUpServer) {
    // Try the looked-up server on all domains
    for (const domain of DLHD_DOMAINS) {
      const m3u8Url = buildM3U8Url(channelId, lookedUpServer, domain);
      try {
        const result = await fetchUrl(m3u8Url, {
          headers: {
            'Referer': 'https://dlhd.link/',
            'Origin': 'https://dlhd.link',
            'Authorization': `Bearer ${authData.token}`,
          }
        });
        
        if (result.status === 200 && (result.data.includes('#EXTM3U') || result.data.includes('#EXT-X-'))) {
          console.log(`[Server] ✅ Server lookup success: ${lookedUpServer}.${domain}`);
          return { server: lookedUpServer, domain, m3u8Url, success: true };
        }
      } catch (e) {
        // Continue to next domain
      }
    }
  }
  
  // Fall back to probing all servers in parallel
  console.log(`[Server] Lookup failed, probing all ${DLHD_SERVERS.length * DLHD_DOMAINS.length} combinations in parallel...`);
  
  const serverPromises = [];
  
  for (const domain of DLHD_DOMAINS) {
    for (const server of DLHD_SERVERS) {
      const m3u8Url = buildM3U8Url(channelId, server, domain);
      
      const tryServer = async () => {
        try {
          const result = await fetchUrl(m3u8Url, {
            headers: {
              'Referer': 'https://dlhd.link/',
              'Origin': 'https://dlhd.link',
              'Authorization': `Bearer ${authData.token}`,
            }
          });
          
          if (result.status === 200 && (result.data.includes('#EXTM3U') || result.data.includes('#EXT-X-'))) {
            return { server, domain, m3u8Url, success: true };
          }
          return { server, domain, success: false, status: result.status };
        } catch (e) {
          return { server, domain, success: false, error: e.message };
        }
      };
      
      serverPromises.push(tryServer());
    }
  }
  
  // Wait for all to complete
  const results = await Promise.all(serverPromises);
  
  // Find first working server
  const working = results.find(r => r.success);
  
  if (working) {
    console.log(`[Server] ✅ Found working server: ${working.server}.${working.domain}`);
    return working;
  }
  
  // Log failures
  const failures = results.filter(r => !r.success);
  console.log(`[Server] ❌ No working server found. ${failures.length} servers failed:`);
  failures.slice(0, 5).forEach(f => {
    console.log(`       - ${f.server}.${f.domain}: ${f.error || `HTTP ${f.status}`}`);
  });
  if (failures.length > 5) {
    console.log(`       ... and ${failures.length - 5} more`);
  }
  
  return null;
}

/**
 * Verify M3U8 content
 */
async function verifyM3U8(m3u8Url, authData) {
  console.log(`\n[M3U8] Verifying stream content...`);
  
  const result = await fetchUrl(m3u8Url, {
    headers: {
      'Referer': 'https://dlhd.link/',
      'Origin': 'https://dlhd.link',
      'Authorization': `Bearer ${authData.token}`,
    }
  });
  
  if (result.status !== 200) {
    console.log(`[M3U8] ❌ Failed: HTTP ${result.status}`);
    return false;
  }
  
  const content = result.data;
  
  // Check for valid M3U8 markers
  const hasExtM3U = content.includes('#EXTM3U');
  const hasExtInf = content.includes('#EXTINF');
  const hasKey = content.includes('#EXT-X-KEY');
  const hasSegments = content.includes('.ts');
  
  console.log(`[M3U8] Content analysis:`);
  console.log(`       - Has #EXTM3U: ${hasExtM3U}`);
  console.log(`       - Has #EXTINF: ${hasExtInf}`);
  console.log(`       - Has #EXT-X-KEY: ${hasKey}`);
  console.log(`       - Has .ts segments: ${hasSegments}`);
  console.log(`       - Content length: ${content.length} bytes`);
  
  if (hasExtM3U && (hasExtInf || hasSegments)) {
    console.log(`[M3U8] ✅ Valid M3U8 playlist`);
    
    // Show first few lines
    const lines = content.split('\n').slice(0, 10);
    console.log(`\n[M3U8] First 10 lines:`);
    lines.forEach(line => console.log(`       ${line}`));
    
    return true;
  }
  
  console.log(`[M3U8] ❌ Invalid M3U8 content`);
  return false;
}

/**
 * Test a single channel
 */
async function testChannel(channelId) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing Channel ${channelId}`);
  console.log('='.repeat(60));
  
  // Step 1: Fetch JWT
  const authData = await fetchAuthData(channelId);
  if (!authData) {
    return { channelId, success: false, error: 'Failed to get JWT' };
  }
  
  // Step 2: Find working server
  const serverInfo = await findWorkingServer(channelId, authData);
  if (!serverInfo) {
    return { channelId, success: false, error: 'No working server found' };
  }
  
  // Step 3: Verify M3U8
  const isValid = await verifyM3U8(serverInfo.m3u8Url, authData);
  
  return {
    channelId,
    success: isValid,
    server: `${serverInfo.server}.${serverInfo.domain}`,
    m3u8Url: serverInfo.m3u8Url,
    error: isValid ? null : 'Invalid M3U8 content',
  };
}

/**
 * Main test runner
 */
async function main() {
  console.log('DLHD Direct Backend Access - End-to-End Test');
  console.log('=============================================\n');
  console.log('This test verifies the direct backend access flow:');
  console.log('1. Fetch JWT from hitsplay.fun');
  console.log('2. Find working DLHD server');
  console.log('3. Verify M3U8 stream is valid');
  
  const results = [];
  
  for (const channelId of TEST_CHANNELS) {
    try {
      const result = await testChannel(channelId);
      results.push(result);
    } catch (e) {
      results.push({
        channelId,
        success: false,
        error: e.message,
      });
    }
  }
  
  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));
  
  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log(`\nTotal: ${results.length} channels tested`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  
  console.log('\nResults:');
  results.forEach(r => {
    const status = r.success ? '✅' : '❌';
    console.log(`  ${status} Channel ${r.channelId}: ${r.success ? r.server : r.error}`);
    if (r.success && r.m3u8Url) {
      console.log(`     URL: ${r.m3u8Url}`);
    }
  });
  
  // Exit with appropriate code
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
