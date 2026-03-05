#!/usr/bin/env node
/**
 * Compare keys - fetch from proxy vs direct upstream
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');

const API_URL = 'http://127.0.0.1:8787';
const API_KEY = 'test';

function fetchLocal(url, headers = {}) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const req = http.request({
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: { 'X-API-Key': API_KEY, ...headers },
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, data: Buffer.concat(chunks), headers: res.headers }));
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.end();
  });
}

function fetchRemote(url, headers = {}) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;
    const req = client.request({
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...headers,
      },
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, data: Buffer.concat(chunks), headers: res.headers }));
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.end();
  });
}

// Decode URL-safe base64
function decodeBase64Url(encoded) {
  let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padding = base64.length % 4;
  if (padding) base64 += '='.repeat(4 - padding);
  return Buffer.from(base64, 'base64').toString('utf-8');
}

async function main() {
  console.log('═'.repeat(70));
  console.log('COMPARE KEYS - PROXY VS DIRECT');
  console.log('═'.repeat(70));
  
  // Step 1: Get stream and M3U8
  console.log('\n1. Getting stream info...');
  const streamRes = await fetchLocal(`${API_URL}/stream/31`);
  const streamData = JSON.parse(streamRes.data.toString());
  
  const m3u8Res = await fetchLocal(streamData.streamUrl + '&key=' + API_KEY);
  const m3u8Content = m3u8Res.data.toString();
  
  // Extract key URL from M3U8
  const keyMatch = m3u8Content.match(/URI="([^"]+)"/);
  if (!keyMatch) {
    console.log('   ❌ No key URL found in M3U8');
    return;
  }
  
  const proxyKeyUrl = keyMatch[1];
  console.log(`   Proxy key URL: ${proxyKeyUrl.substring(0, 80)}...`);
  
  // Extract original key URL from proxy URL
  const proxyUrlObj = new URL(proxyKeyUrl);
  const encodedOriginalUrl = proxyUrlObj.searchParams.get('url');
  const originalKeyUrl = decodeBase64Url(encodedOriginalUrl);
  console.log(`   Original key URL: ${originalKeyUrl}`);
  
  // Step 2: Fetch key through proxy
  console.log('\n2. Fetching key through PROXY...');
  const proxyKeyRes = await fetchLocal(proxyKeyUrl);
  
  if (proxyKeyRes.error) {
    console.log(`   ❌ Error: ${proxyKeyRes.error}`);
  } else {
    console.log(`   Status: ${proxyKeyRes.status}`);
    console.log(`   Size: ${proxyKeyRes.data.length} bytes`);
    console.log(`   Key (hex): ${proxyKeyRes.data.toString('hex')}`);
  }
  
  // Step 3: Try to fetch key directly (will likely fail due to auth)
  console.log('\n3. Fetching key DIRECTLY (may fail without auth)...');
  const directKeyRes = await fetchRemote(originalKeyUrl, {
    'Referer': 'https://dlhd.link/',
    'Origin': 'https://dlhd.link',
  });
  
  if (directKeyRes.error) {
    console.log(`   ❌ Error: ${directKeyRes.error}`);
  } else {
    console.log(`   Status: ${directKeyRes.status}`);
    console.log(`   Size: ${directKeyRes.data.length} bytes`);
    if (directKeyRes.status === 200) {
      console.log(`   Key (hex): ${directKeyRes.data.toString('hex')}`);
    } else {
      console.log(`   Response: ${directKeyRes.data.toString().substring(0, 200)}`);
    }
  }
  
  // Step 4: Compare keys if both succeeded
  if (proxyKeyRes.status === 200 && directKeyRes.status === 200) {
    const match = proxyKeyRes.data.equals(directKeyRes.data);
    console.log(`\n4. Keys match: ${match ? '✅ YES' : '❌ NO'}`);
    if (!match) {
      console.log(`   Proxy key:  ${proxyKeyRes.data.toString('hex')}`);
      console.log(`   Direct key: ${directKeyRes.data.toString('hex')}`);
    }
  }
  
  // Step 5: Check if key looks valid (should be 16 bytes for AES-128)
  console.log('\n5. Key validation...');
  if (proxyKeyRes.data.length === 16) {
    console.log('   ✅ Key is 16 bytes (correct for AES-128)');
  } else {
    console.log(`   ⚠️  Key is ${proxyKeyRes.data.length} bytes, expected 16`);
    console.log(`   Raw content: ${proxyKeyRes.data.toString()}`);
  }
  
  // Step 6: Check if key might be base64 encoded
  if (proxyKeyRes.data.length === 24 || proxyKeyRes.data.length === 22) {
    console.log('\n6. Key might be base64 encoded, trying to decode...');
    try {
      const decoded = Buffer.from(proxyKeyRes.data.toString(), 'base64');
      console.log(`   Decoded length: ${decoded.length}`);
      console.log(`   Decoded hex: ${decoded.toString('hex')}`);
    } catch (e) {
      console.log(`   Not valid base64`);
    }
  }
}

main().catch(console.error);
