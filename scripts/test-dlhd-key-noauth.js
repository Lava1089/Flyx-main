#!/usr/bin/env node
/**
 * Test DLHD key fetching WITHOUT any auth/reCAPTCHA
 * 
 * Goal: Determine if the key server requires reCAPTCHA IP whitelist,
 * or if it just needs the right Referer/Origin headers.
 * 
 * Tests:
 * 1. Fetch M3U8 to get a real, current key URL
 * 2. Fetch key from chevy.soyspace.cyou (original CDN) with various header combos
 * 3. Fetch key from go.ai-chatx.site (reCAPTCHA domain) with various header combos
 * 4. Compare results to determine what's actually needed
 */

const https = require('https');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function fetchRaw(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { 'User-Agent': UA, ...headers },
      timeout: 10000,
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, body: buf });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

function fetchText(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { 'User-Agent': UA, ...headers },
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

function postJson(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const jsonBody = JSON.stringify(body);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(jsonBody),
        ...headers,
      },
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: data, json });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(jsonBody);
    req.end();
  });
}

function analyzeKey(buf, label) {
  console.log(`  [${label}] ${buf.length} bytes`);
  if (buf.length === 16) {
    const hex = buf.toString('hex');
    console.log(`  [${label}] Hex: ${hex}`);
    
    // Known fake patterns
    const isFake = hex.startsWith('455806f8') || hex.startsWith('45c6497');
    const isError = hex.startsWith('6572726f72'); // "error" in hex
    const isZero = hex === '00000000000000000000000000000000';
    
    if (isFake) console.log(`  [${label}] ⚠️  FAKE/DECOY KEY`);
    else if (isError) console.log(`  [${label}] ⚠️  ERROR encoded as key bytes`);
    else if (isZero) console.log(`  [${label}] ⚠️  ALL ZEROS`);
    else console.log(`  [${label}] ✅ Looks like a REAL key`);
    
    return { hex, isFake, isError, isZero, isReal: !isFake && !isError && !isZero };
  } else {
    const text = buf.toString('utf8').substring(0, 200);
    console.log(`  [${label}] Text: ${text}`);
    return { hex: null, isFake: true, isReal: false };
  }
}

async function main() {
  console.log('='.repeat(80));
  console.log('DLHD Key Auth Test - No reCAPTCHA');
  console.log('='.repeat(80));
  
  // Step 1: Get server lookup
  console.log('\n--- Step 1: Server Lookup ---');
  let serverKey;
  try {
    const lookup = await fetchText('https://chevy.vovlacosa.sbs/server_lookup?channel_id=premium44', {
      'Referer': 'https://adffdafdsafds.sbs/',
      'Origin': 'https://adffdafdsafds.sbs',
    });
    console.log(`  Status: ${lookup.status}`);
    console.log(`  Body: ${lookup.body}`);
    const data = JSON.parse(lookup.body);
    serverKey = data.server_key;
    console.log(`  Server key: ${serverKey}`);
  } catch (e) {
    console.log(`  Error: ${e.message}`);
    serverKey = 'zeko';
  }
  
  // Step 2: Fetch M3U8 to get real key URL
  console.log('\n--- Step 2: Fetch M3U8 ---');
  const m3u8Url = `https://chevy.soyspace.cyou/proxy/${serverKey}/premium44/mono.css`;
  console.log(`  URL: ${m3u8Url}`);
  
  let keyUri = null;
  let m3u8Base = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);
  
  try {
    const m3u8 = await fetchText(m3u8Url, {
      'Referer': 'https://adffdafdsafds.sbs/',
      'Origin': 'https://adffdafdsafds.sbs',
    });
    console.log(`  Status: ${m3u8.status}`);
    console.log(`  Valid M3U8: ${m3u8.body.includes('#EXTM3U')}`);
    
    // Extract key URI
    const keyMatch = m3u8.body.match(/URI="([^"]+)"/);
    if (keyMatch) {
      keyUri = keyMatch[1];
      console.log(`  Key URI: ${keyUri}`);
    }
    
    // Show first few lines
    const lines = m3u8.body.split('\n').slice(0, 10);
    for (const line of lines) {
      console.log(`  | ${line}`);
    }
  } catch (e) {
    console.log(`  Error: ${e.message}`);
  }
  
  if (!keyUri) {
    console.log('\n❌ Could not get key URI from M3U8. Exiting.');
    return;
  }
  
  // Build absolute key URLs
  const keyOnCDN = keyUri.startsWith('http') ? keyUri : (keyUri.startsWith('/') 
    ? `https://chevy.soyspace.cyou${keyUri}` 
    : `${m3u8Base}${keyUri}`);
  
  // Also build go.ai-chatx.site version
  const keyPath = keyUri.startsWith('/') ? keyUri : `/${keyUri}`;
  const keyOnAiChatx = `https://go.ai-chatx.site${keyPath}`;
  
  console.log(`\n  Key on CDN: ${keyOnCDN}`);
  console.log(`  Key on ai-chatx: ${keyOnAiChatx}`);
  
  // Step 3: Test key fetching with various header combinations
  console.log('\n--- Step 3: Key Fetch Tests ---');
  
  const headerCombos = [
    {
      label: 'No headers (bare)',
      headers: {},
    },
    {
      label: 'Referer: adffdafdsafds.sbs',
      headers: {
        'Referer': 'https://adffdafdsafds.sbs/',
        'Origin': 'https://adffdafdsafds.sbs',
      },
    },
    {
      label: 'Referer: dlstreams.top',
      headers: {
        'Referer': 'https://dlstreams.top/',
        'Origin': 'https://dlstreams.top',
      },
    },
    {
      label: 'Referer: go.ai-chatx.site',
      headers: {
        'Referer': 'https://go.ai-chatx.site/',
        'Origin': 'https://go.ai-chatx.site',
      },
    },
    {
      label: 'Accept + Referer (browser-like)',
      headers: {
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://adffdafdsafds.sbs/',
        'Origin': 'https://adffdafdsafds.sbs',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'cross-site',
      },
    },
  ];
  
  // Test on CDN domain
  console.log(`\n  === Key from CDN (chevy.soyspace.cyou) ===`);
  for (const combo of headerCombos) {
    console.log(`\n  Test: ${combo.label}`);
    try {
      const res = await fetchRaw(keyOnCDN, combo.headers);
      console.log(`  Status: ${res.status}, CORS: ${res.headers['access-control-allow-origin'] || 'none'}`);
      analyzeKey(res.body, combo.label);
    } catch (e) {
      console.log(`  Error: ${e.message}`);
    }
  }
  
  // Test on ai-chatx domain
  console.log(`\n  === Key from ai-chatx (go.ai-chatx.site) ===`);
  for (const combo of headerCombos) {
    console.log(`\n  Test: ${combo.label}`);
    try {
      const res = await fetchRaw(keyOnAiChatx, combo.headers);
      console.log(`  Status: ${res.status}, CORS: ${res.headers['access-control-allow-origin'] || 'none'}`);
      analyzeKey(res.body, combo.label);
    } catch (e) {
      console.log(`  Error: ${e.message}`);
    }
  }
  
  // Step 4: Test verify endpoint without reCAPTCHA token
  console.log('\n--- Step 4: Verify Endpoint Probing ---');
  
  // Try with empty/fake token
  const verifyTests = [
    { label: 'Empty body', body: {} },
    { label: 'Empty token', body: { 'recaptcha-token': '', 'channel_id': 'premium44' } },
    { label: 'Fake token', body: { 'recaptcha-token': 'fake-token-12345', 'channel_id': 'premium44' } },
    { label: 'No channel', body: { 'recaptcha-token': 'test' } },
  ];
  
  for (const test of verifyTests) {
    console.log(`\n  Test: ${test.label}`);
    try {
      const res = await postJson('https://go.ai-chatx.site/verify', test.body);
      console.log(`  Status: ${res.status}`);
      console.log(`  Response: ${JSON.stringify(res.json || res.body).substring(0, 200)}`);
    } catch (e) {
      console.log(`  Error: ${e.message}`);
    }
  }
  
  // Step 5: Check if there's a different key endpoint that doesn't need whitelist
  console.log('\n--- Step 5: Alternative Key Endpoints ---');
  const altKeyUrls = [
    // Try the key path on different hosts
    `https://go.ai-chatx.site/proxy/${serverKey}/premium44/mono.css`,
    `https://chevy.vovlacosa.sbs/key/premium44/5909692`,
  ];
  
  for (const url of altKeyUrls) {
    console.log(`\n  Testing: ${url}`);
    try {
      const res = await fetchRaw(url, {
        'Referer': 'https://adffdafdsafds.sbs/',
        'Origin': 'https://adffdafdsafds.sbs',
      });
      console.log(`  Status: ${res.status}, Size: ${res.body.length}`);
      if (res.body.length <= 200) {
        if (res.body.length === 16) {
          analyzeKey(res.body, url.substring(0, 50));
        } else {
          console.log(`  Body: ${res.body.toString('utf8').substring(0, 200)}`);
        }
      } else {
        console.log(`  Body: ${res.body.toString('utf8').substring(0, 100)}...`);
      }
    } catch (e) {
      console.log(`  Error: ${e.message}`);
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('DONE');
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
