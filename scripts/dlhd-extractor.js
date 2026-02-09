#!/usr/bin/env node
/**
 * DLHD Stream Extractor - Reverse Engineered from Player 1 & 2
 * 
 * Player 1: https://dlhd.link/stream/stream-{id}.php -> embeds hitsplay.fun
 * Player 2: https://dlhd.link/cast/stream-{id}.php -> embeds hitsplay.fun
 * 
 * Both players embed: https://hitsplay.fun/premiumtv/daddyhd.php?id={channel}
 * 
 * Flow:
 * 1. Fetch hitsplay.fun page with proper referer
 * 2. Extract JWT token (SESSION_TOKEN) from page
 * 3. Extract CHANNEL_KEY from page  
 * 4. Call server_lookup API to get correct server
 * 5. Construct M3U8 URL and fetch with JWT auth
 */

const https = require('https');
const http = require('http');

// Configuration
const HITSPLAY_BASE = 'https://hitsplay.fun/premiumtv/daddyhd.php';
const SERVER_LOOKUP = 'https://chevy.dvalna.ru/server_lookup';
const REFERER = 'https://dlhd.link/';

/**
 * Simple HTTPS fetch with custom headers
 */
function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const lib = isHttps ? https : http;
    
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...options.headers
      }
    };
    
    const req = lib.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    
    req.on('error', reject);
    req.setTimeout(options.timeout || 10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

/**
 * Extract JWT token from hitsplay page
 * The token is base64 encoded and split across multiple variables
 */
function extractJWT(html) {
  // Pattern 1: Look for the array of base64 chunks that form the JWT
  // const _15123a=["ZXl...", "rcF...", ...]; let _b023f8165d=[..._15123a].join('');
  const arrayMatch = html.match(/const\s+_[a-f0-9]+\s*=\s*\[(["'][A-Za-z0-9+/=]+["'],?\s*)+\];\s*let\s+(_[a-f0-9]+)\s*=\s*\[\.\.\._[a-f0-9]+\]\.join\(['"]{2}\)/);
  
  if (arrayMatch) {
    // Extract the array contents
    const fullMatch = html.match(/const\s+_[a-f0-9]+\s*=\s*\[([^\]]+)\]/);
    if (fullMatch) {
      const chunks = fullMatch[1].match(/["']([A-Za-z0-9+/=]+)["']/g);
      if (chunks) {
        const base64 = chunks.map(c => c.replace(/["']/g, '')).join('');
        try {
          return Buffer.from(base64, 'base64').toString('utf8');
        } catch (e) {}
      }
    }
  }
  
  // Pattern 2: Look for window.SESSION_TOKEN assignment
  const tokenMatch = html.match(/window\.SESSION_TOKEN\s*=\s*["']([^"']+)["']/);
  if (tokenMatch) {
    return tokenMatch[1];
  }
  
  // Pattern 3: Look for _b023f8165d variable after atob
  const atobMatch = html.match(/const\s+_[a-f0-9]+\s*=\s*atob\((_[a-f0-9]+)\);\s*\1\s*=\s*_[a-f0-9]+/);
  if (atobMatch) {
    // Find the original base64 value
    const varName = atobMatch[1];
    const varMatch = html.match(new RegExp(`let\\s+${varName}\\s*=\\s*\\[\\.\\.\\._[a-f0-9]+\\]\\.join\\(['"]\\s*['"]\\)`));
  }
  
  // Pattern 4: Direct eyJ... JWT pattern
  const jwtMatch = html.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  if (jwtMatch) {
    return jwtMatch[0];
  }
  
  return null;
}

/**
 * Extract CHANNEL_KEY from hitsplay page
 */
function extractChannelKey(html) {
  // Pattern 1: window.CHANNEL_KEY assignment
  const keyMatch = html.match(/window\.CHANNEL_KEY\s*=\s*["']?([a-zA-Z0-9]+)["']?/);
  if (keyMatch) {
    return keyMatch[1];
  }
  
  // Pattern 2: Look for the obfuscated channel key
  // let _64f84c098976a6="cHJ"+"lbW"+"l1b"+"TMx"; then atob
  const concatMatch = html.match(/let\s+(_[a-f0-9]+)\s*=\s*(["'][A-Za-z0-9+/=]+["']\s*\+\s*)+["'][A-Za-z0-9+/=]+["']/);
  if (concatMatch) {
    const fullLine = html.match(new RegExp(`let\\s+${concatMatch[1]}\\s*=\\s*([^;]+)`));
    if (fullLine) {
      const parts = fullLine[1].match(/["']([A-Za-z0-9+/=]+)["']/g);
      if (parts) {
        const base64 = parts.map(p => p.replace(/["']/g, '')).join('');
        try {
          return Buffer.from(base64, 'base64').toString('utf8');
        } catch (e) {}
      }
    }
  }
  
  // Pattern 3: Look for premium{number} pattern
  const premiumMatch = html.match(/premium\d+/);
  if (premiumMatch) {
    return premiumMatch[0];
  }
  
  return null;
}

/**
 * Get server key from dvalna server_lookup API
 */
async function getServerKey(channelKey) {
  const url = `${SERVER_LOOKUP}?channel_id=${encodeURIComponent(channelKey)}`;
  
  try {
    const res = await fetch(url, {
      headers: {
        'Referer': 'https://epaly.fun/',
        'Origin': 'https://epaly.fun'
      },
      timeout: 5000
    });
    
    if (res.status === 200 && !res.body.startsWith('<')) {
      const data = JSON.parse(res.body);
      if (data.server_key) {
        return data.server_key;
      }
    }
  } catch (e) {
    console.error('Server lookup failed:', e.message);
  }
  
  return 'zeko'; // Default fallback
}

/**
 * Construct M3U8 URL based on server key
 */
function constructM3U8Url(serverKey, channelKey) {
  if (serverKey === 'top1/cdn') {
    return `https://top1.dvalna.ru/top1/cdn/${channelKey}/mono.css`;
  }
  return `https://${serverKey}new.dvalna.ru/${serverKey}/${channelKey}/mono.css`;
}

/**
 * Fetch M3U8 playlist with JWT authorization
 */
async function fetchM3U8(m3u8Url, jwt) {
  try {
    const res = await fetch(m3u8Url, {
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Referer': 'https://dlhd.link/',
        'Origin': 'https://dlhd.link'
      },
      timeout: 10000
    });
    
    if (res.status === 200 && res.body.includes('#EXTM3U')) {
      return res.body;
    }
    
    return { error: `HTTP ${res.status}`, body: res.body.substring(0, 200) };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Main extraction function
 */
async function extractStream(channelId) {
  console.log(`\n=== Extracting DLHD Channel ${channelId} ===\n`);
  
  // Step 1: Fetch hitsplay page
  console.log('1. Fetching hitsplay.fun page...');
  const hitsplayUrl = `${HITSPLAY_BASE}?id=${channelId}`;
  
  let hitsplayRes;
  try {
    hitsplayRes = await fetch(hitsplayUrl, {
      headers: {
        'Referer': `https://dlhd.link/stream/stream-${channelId}.php`,
        'Origin': 'https://dlhd.link'
      },
      timeout: 15000
    });
  } catch (e) {
    console.error('Failed to fetch hitsplay page:', e.message);
    return null;
  }
  
  if (hitsplayRes.status !== 200) {
    console.error(`Hitsplay returned HTTP ${hitsplayRes.status}`);
    return null;
  }
  
  const html = hitsplayRes.body;
  console.log(`   Page size: ${html.length} bytes`);
  
  // Step 2: Extract JWT token
  console.log('2. Extracting JWT token...');
  const jwt = extractJWT(html);
  if (!jwt) {
    console.error('   Failed to extract JWT token');
    return null;
  }
  console.log(`   JWT: ${jwt.substring(0, 50)}...`);
  
  // Step 3: Extract channel key
  console.log('3. Extracting channel key...');
  let channelKey = extractChannelKey(html);
  if (!channelKey) {
    channelKey = `premium${channelId}`;
    console.log(`   Using default: ${channelKey}`);
  } else {
    console.log(`   Channel key: ${channelKey}`);
  }
  
  // Step 4: Get server key
  console.log('4. Getting server key from lookup...');
  const serverKey = await getServerKey(channelKey);
  console.log(`   Server: ${serverKey}`);
  
  // Step 5: Construct and fetch M3U8
  console.log('5. Fetching M3U8 playlist...');
  const m3u8Url = constructM3U8Url(serverKey, channelKey);
  console.log(`   URL: ${m3u8Url}`);
  
  const m3u8 = await fetchM3U8(m3u8Url, jwt);
  
  if (typeof m3u8 === 'string') {
    console.log('\n=== SUCCESS ===');
    console.log(`M3U8 Preview:\n${m3u8.substring(0, 500)}...`);
    return {
      channelId,
      channelKey,
      serverKey,
      jwt,
      m3u8Url,
      m3u8
    };
  } else {
    console.error('\n=== FAILED ===');
    console.error('Error:', m3u8.error);
    if (m3u8.body) console.error('Response:', m3u8.body);
    return null;
  }
}

// CLI
const channelId = process.argv[2] || '31';
extractStream(channelId).then(result => {
  if (result) {
    console.log('\n=== RESULT ===');
    console.log(JSON.stringify({
      channelId: result.channelId,
      channelKey: result.channelKey,
      serverKey: result.serverKey,
      jwt: result.jwt.substring(0, 50) + '...',
      m3u8Url: result.m3u8Url
    }, null, 2));
  }
  process.exit(result ? 0 : 1);
});
