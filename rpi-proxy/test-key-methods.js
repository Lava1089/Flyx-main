#!/usr/bin/env node
/**
 * Test all available methods for fetching DLHD keys
 * Run this on the RPI to find which method works
 */

const { spawn, execSync } = require('child_process');
const https = require('https');

// Get fresh key URL from M3U8
async function getFreshKeyUrl() {
  return new Promise((resolve, reject) => {
    https.get('https://zekonew.kiko2.ru/zeko/premium51/mono.css', {
      headers: {
        'User-Agent': 'Mozilla/5.0 Chrome/120.0.0.0',
        'Referer': 'https://epaly.fun/',
        'Origin': 'https://epaly.fun',
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const match = data.match(/#EXT-X-KEY:METHOD=AES-128,URI="([^"]+)"/);
        resolve(match ? match[1] : null);
      });
    }).on('error', reject);
  });
}

// Test 1: Node.js https (baseline - expected to fail)
async function testNodeHttps(keyUrl) {
  console.log('\n=== Test 1: Node.js https ===');
  return new Promise((resolve) => {
    const url = new URL(keyUrl);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Origin': 'https://epaly.fun',
        'Referer': 'https://epaly.fun/',
      }
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const data = Buffer.concat(chunks);
        const isValid = data.length === 16 && !data.toString('utf8').includes('error');
        console.log(`Status: ${res.statusCode}, Length: ${data.length}`);
        console.log(`Result: ${isValid ? '✓ VALID KEY' : '✗ ' + data.toString('utf8').substring(0, 30)}`);
        resolve(isValid ? data : null);
      });
    });
    req.on('error', (e) => {
      console.log(`Error: ${e.message}`);
      resolve(null);
    });
    req.end();
  });
}

// Test 2: Regular curl (expected to fail)
async function testCurl(keyUrl) {
  console.log('\n=== Test 2: Regular curl ===');
  return new Promise((resolve) => {
    const curl = spawn('curl', [
      '-s', '-w', '\\nHTTP_CODE:%{http_code}',
      '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '-H', 'Origin: https://epaly.fun',
      '-H', 'Referer: https://epaly.fun/',
      keyUrl
    ]);
    
    const chunks = [];
    curl.stdout.on('data', (data) => chunks.push(data));
    curl.on('close', () => {
      const output = Buffer.concat(chunks);
      const outputStr = output.toString();
      const httpMatch = outputStr.match(/HTTP_CODE:(\d+)/);
      const status = httpMatch ? httpMatch[1] : 'unknown';
      const dataEnd = outputStr.indexOf('\nHTTP_CODE:');
      const data = dataEnd > 0 ? output.slice(0, dataEnd) : output;
      const isValid = data.length === 16 && !data.toString('utf8').includes('error');
      console.log(`Status: ${status}, Length: ${data.length}`);
      console.log(`Result: ${isValid ? '✓ VALID KEY' : '✗ ' + data.toString('utf8').substring(0, 30)}`);
      resolve(isValid ? data : null);
    });
    curl.on('error', () => {
      console.log('curl not available');
      resolve(null);
    });
  });
}

// Test 3: curl-impersonate (should work if installed)
async function testCurlImpersonate(keyUrl) {
  console.log('\n=== Test 3: curl-impersonate (Chrome) ===');
  
  // Try different curl-impersonate binaries
  const binaries = ['curl_chrome116', 'curl_chrome110', 'curl-impersonate-chrome'];
  
  for (const binary of binaries) {
    try {
      // Check if binary exists
      execSync(`which ${binary}`, { stdio: 'ignore' });
      console.log(`Using: ${binary}`);
      
      return new Promise((resolve) => {
        const curl = spawn(binary, [
          '-s', '-w', '\\nHTTP_CODE:%{http_code}',
          '-H', 'Origin: https://epicplayplay.cfd',
          '-H', 'Referer: https://epicplayplay.cfd/',
          keyUrl
        ]);
        
        const chunks = [];
        curl.stdout.on('data', (data) => chunks.push(data));
        curl.on('close', () => {
          const output = Buffer.concat(chunks);
          const outputStr = output.toString();
          const httpMatch = outputStr.match(/HTTP_CODE:(\d+)/);
          const status = httpMatch ? httpMatch[1] : 'unknown';
          const dataEnd = outputStr.indexOf('\nHTTP_CODE:');
          const data = dataEnd > 0 ? output.slice(0, dataEnd) : output;
          const isValid = data.length === 16 && !data.toString('utf8').includes('error');
          console.log(`Status: ${status}, Length: ${data.length}`);
          console.log(`Result: ${isValid ? '✓ VALID KEY' : '✗ ' + data.toString('utf8').substring(0, 30)}`);
          resolve(isValid ? data : null);
        });
        curl.on('error', () => resolve(null));
      });
    } catch {
      // Binary not found, try next
    }
  }
  
  console.log('curl-impersonate not installed');
  console.log('Install with: bash install-curl-impersonate.sh');
  return null;
}

// Test 4: Puppeteer (should work)
async function testPuppeteer(keyUrl) {
  console.log('\n=== Test 4: Puppeteer (Chromium) ===');
  
  let puppeteer;
  try {
    puppeteer = require('puppeteer-core');
  } catch {
    console.log('puppeteer-core not installed');
    console.log('Install with: npm install puppeteer-core');
    return null;
  }
  
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: '/usr/bin/chromium-browser',
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    
    const page = await browser.newPage();
    await page.goto('https://epaly.fun/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    const result = await page.evaluate(async (url) => {
      try {
        const res = await fetch(url, { mode: 'cors' });
        const buf = await res.arrayBuffer();
        const bytes = new Uint8Array(buf);
        return { status: res.status, bytes: Array.from(bytes) };
      } catch (e) {
        return { error: e.message };
      }
    }, keyUrl);
    
    if (result.error) {
      console.log(`Error: ${result.error}`);
      return null;
    }
    
    const data = Buffer.from(result.bytes);
    const isValid = data.length === 16 && !data.toString('utf8').includes('error');
    console.log(`Status: ${result.status}, Length: ${data.length}`);
    console.log(`Result: ${isValid ? '✓ VALID KEY' : '✗ ' + data.toString('utf8').substring(0, 30)}`);
    return isValid ? data : null;
    
  } catch (e) {
    console.log(`Error: ${e.message}`);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

async function main() {
  console.log('Testing DLHD key fetch methods...\n');
  
  // Get fresh key URL
  const keyUrl = await getFreshKeyUrl();
  if (!keyUrl) {
    console.log('ERROR: Could not get key URL from M3U8');
    return;
  }
  console.log('Key URL:', keyUrl);
  
  // Run all tests
  const results = {
    nodeHttps: await testNodeHttps(keyUrl),
    curl: await testCurl(keyUrl),
    curlImpersonate: await testCurlImpersonate(keyUrl),
    puppeteer: await testPuppeteer(keyUrl),
  };
  
  // Summary
  console.log('\n\n=== SUMMARY ===');
  console.log('Node.js https:', results.nodeHttps ? '✓ WORKS' : '✗ BLOCKED');
  console.log('Regular curl:', results.curl ? '✓ WORKS' : '✗ BLOCKED');
  console.log('curl-impersonate:', results.curlImpersonate ? '✓ WORKS' : '✗ BLOCKED/NOT INSTALLED');
  console.log('Puppeteer:', results.puppeteer ? '✓ WORKS' : '✗ BLOCKED/NOT INSTALLED');
  
  // Recommendation
  console.log('\n=== RECOMMENDATION ===');
  if (results.curlImpersonate) {
    console.log('Use curl-impersonate for key fetching (fastest)');
  } else if (results.puppeteer) {
    console.log('Use Puppeteer for key fetching (works but slower)');
  } else if (results.nodeHttps || results.curl) {
    console.log('Basic methods work - no special handling needed');
  } else {
    console.log('All methods blocked! Check if your IP is residential.');
    console.log('Try: curl https://api.ipify.org && curl https://ipinfo.io/$(curl -s https://api.ipify.org)/json');
  }
}

main().catch(console.error);
