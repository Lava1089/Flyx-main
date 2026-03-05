#!/usr/bin/env node
/**
 * Compare segments - fetch from proxy vs direct upstream
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
      timeout: 60000,
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
      timeout: 60000,
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
  console.log('COMPARE SEGMENTS - PROXY VS DIRECT');
  console.log('═'.repeat(70));
  
  // Step 1: Get stream and M3U8
  console.log('\n1. Getting stream info...');
  const streamRes = await fetchLocal(`${API_URL}/stream/31`);
  const streamData = JSON.parse(streamRes.data.toString());
  
  const m3u8Res = await fetchLocal(streamData.streamUrl + '&key=' + API_KEY);
  const m3u8Content = m3u8Res.data.toString();
  
  // Extract first segment URL from M3U8
  const lines = m3u8Content.split('\n');
  let proxySegmentUrl = null;
  
  for (const line of lines) {
    if (line.trim().startsWith('http') && line.includes('/live/ts')) {
      proxySegmentUrl = line.trim();
      break;
    }
  }
  
  if (!proxySegmentUrl) {
    console.log('   ❌ No segment URL found');
    return;
  }
  
  console.log(`   Proxy segment URL: ${proxySegmentUrl.substring(0, 80)}...`);
  
  // Extract original segment URL
  const proxyUrlObj = new URL(proxySegmentUrl);
  const encodedOriginalUrl = proxyUrlObj.searchParams.get('url');
  const originalSegmentUrl = decodeBase64Url(encodedOriginalUrl);
  console.log(`   Original segment URL: ${originalSegmentUrl.substring(0, 80)}...`);
  
  // Step 2: Fetch segment through proxy
  console.log('\n2. Fetching segment through PROXY...');
  const proxySegRes = await fetchLocal(proxySegmentUrl);
  
  if (proxySegRes.error) {
    console.log(`   ❌ Error: ${proxySegRes.error}`);
    return;
  }
  
  console.log(`   Status: ${proxySegRes.status}`);
  console.log(`   Size: ${proxySegRes.data.length} bytes`);
  console.log(`   First 32 bytes: ${proxySegRes.data.slice(0, 32).toString('hex')}`);
  console.log(`   MD5: ${crypto.createHash('md5').update(proxySegRes.data).digest('hex')}`);
  
  // Step 3: Fetch segment directly (follow redirects)
  console.log('\n3. Fetching segment DIRECTLY...');
  
  // Extract headers from proxy URL
  const encodedHeaders = proxyUrlObj.searchParams.get('h');
  let headers = {};
  if (encodedHeaders) {
    try {
      headers = JSON.parse(decodeBase64Url(encodedHeaders));
    } catch (e) {}
  }
  
  console.log(`   Using headers: ${JSON.stringify(Object.keys(headers))}`);
  
  let directSegRes = await fetchRemote(originalSegmentUrl, headers);
  
  // Follow redirects
  let redirectCount = 0;
  while (directSegRes.status === 302 || directSegRes.status === 301) {
    redirectCount++;
    if (redirectCount > 5) {
      console.log('   ❌ Too many redirects');
      break;
    }
    const location = directSegRes.headers.location;
    console.log(`   Redirect ${redirectCount}: ${location?.substring(0, 80)}...`);
    if (!location) break;
    directSegRes = await fetchRemote(location, headers);
  }
  
  if (directSegRes.error) {
    console.log(`   ❌ Error: ${directSegRes.error}`);
  } else {
    console.log(`   Status: ${directSegRes.status}`);
    console.log(`   Size: ${directSegRes.data.length} bytes`);
    console.log(`   First 32 bytes: ${directSegRes.data.slice(0, 32).toString('hex')}`);
    console.log(`   MD5: ${crypto.createHash('md5').update(directSegRes.data).digest('hex')}`);
  }
  
  // Step 4: Compare
  if (proxySegRes.status === 200 && directSegRes.status === 200) {
    const sizeMatch = proxySegRes.data.length === directSegRes.data.length;
    const dataMatch = proxySegRes.data.equals(directSegRes.data);
    
    console.log(`\n4. Comparison:`);
    console.log(`   Size match: ${sizeMatch ? '✅ YES' : '❌ NO'}`);
    console.log(`   Data match: ${dataMatch ? '✅ YES' : '❌ NO'}`);
    
    if (!dataMatch && sizeMatch) {
      // Find first difference
      for (let i = 0; i < proxySegRes.data.length; i++) {
        if (proxySegRes.data[i] !== directSegRes.data[i]) {
          console.log(`   First difference at byte ${i}`);
          console.log(`   Proxy: ${proxySegRes.data.slice(i, i+16).toString('hex')}`);
          console.log(`   Direct: ${directSegRes.data.slice(i, i+16).toString('hex')}`);
          break;
        }
      }
    }
  }
  
  // Step 5: Try decrypting direct segment
  console.log('\n5. Trying to decrypt DIRECT segment...');
  
  // Get key
  const keyMatch = m3u8Content.match(/URI="([^"]+)"/);
  const proxyKeyUrl = keyMatch[1];
  const keyRes = await fetchLocal(proxyKeyUrl);
  const key = keyRes.data;
  
  // Get IV
  const ivMatch = m3u8Content.match(/IV=0x([0-9a-fA-F]+)/i);
  const iv = ivMatch ? Buffer.from(ivMatch[1], 'hex') : Buffer.alloc(16, 0);
  
  console.log(`   Key: ${key.toString('hex')}`);
  console.log(`   IV: ${iv.toString('hex')}`);
  
  try {
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    decipher.setAutoPadding(false);
    
    const decrypted = Buffer.concat([
      decipher.update(directSegRes.data),
      decipher.final()
    ]);
    
    console.log(`   Decrypted first 32 bytes: ${decrypted.slice(0, 32).toString('hex')}`);
    
    if (decrypted[0] === 0x47) {
      console.log(`   ✅ Direct segment decrypts correctly!`);
    } else {
      console.log(`   ❌ First byte is 0x${decrypted[0].toString(16)}`);
    }
  } catch (e) {
    console.log(`   ❌ Decryption error: ${e.message}`);
  }
}

main().catch(console.error);
