#!/usr/bin/env node
/**
 * Test the full whitelist flow: solve reCAPTCHA, verify, then fetch key
 * Do it all from THIS machine to see if whitelist actually works
 */
const https = require('https');
const { execSync } = require('child_process');

const RPI = 'https://rpi-proxy.vynx.cc';
const RPI_KEY = '5f1845926d725bb2a8230a6ed231fce1d03f07782f74a3f683c30ec04d4ac560';

function fetchFull(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
        ...options.headers,
      },
      timeout: 20000,
    };
    
    const req = https.request(opts, r => {
      const chunks = [];
      r.on('data', c => chunks.push(c));
      r.on('end', () => resolve({
        status: r.statusCode,
        headers: r.headers,
        buf: Buffer.concat(chunks),
        cookies: r.headers['set-cookie'] || [],
      }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function main() {
  console.log('=== WHITELIST FLOW TEST ===\n');

  // Step 1: Check RPI whitelist status
  console.log('[1] RPI whitelist status:');
  const status = await fetchFull(`${RPI}/whitelist-status`);
  console.log(`    ${status.buf.toString()}\n`);

  // Step 2: Trigger whitelist refresh on RPI
  console.log('[2] Triggering whitelist refresh...');
  const refresh = await fetchFull(`${RPI}/whitelist-refresh?key=${RPI_KEY}`, {
    headers: { 'X-API-Key': RPI_KEY },
  });
  console.log(`    ${refresh.buf.toString()}\n`);

  // Step 3: Wait for whitelist to complete
  console.log('[3] Waiting 10s for whitelist to complete...');
  await new Promise(r => setTimeout(r, 10000));

  // Step 4: Check status again
  console.log('[4] RPI whitelist status after refresh:');
  const status2 = await fetchFull(`${RPI}/whitelist-status`);
  console.log(`    ${status2.buf.toString()}\n`);

  // Step 5: Fetch key via RPI /fetch (should be whitelisted now)
  console.log('[5] Fetching key via RPI /fetch...');
  const keyUrl = 'https://go.ai-chatx.site/key/premium303/5909740';
  const rpiKeyUrl = `${RPI}/fetch?url=${encodeURIComponent(keyUrl)}&headers=${encodeURIComponent(JSON.stringify({
    'Referer': 'https://adffdafdsafds.sbs/',
    'Origin': 'https://adffdafdsafds.sbs',
  }))}&key=${RPI_KEY}`;
  const key1 = await fetchFull(rpiKeyUrl, { headers: { 'X-API-Key': RPI_KEY } });
  console.log(`    Status: ${key1.status}, Size: ${key1.buf.length}`);
  if (key1.buf.length === 16) {
    console.log(`    Key: ${key1.buf.toString('hex')}`);
  }

  // Step 6: Also test the verify endpoint directly to see what it returns
  console.log('\n[6] Testing verify endpoint directly from RPI...');
  // Use RPI to POST to verify (so it's from the RPI's IP)
  const verifyUrl = 'https://go.ai-chatx.site/verify';
  const verifyBody = JSON.stringify({ 'recaptcha-token': 'test-token', 'channel_id': 'premium303' });
  
  // We can't POST through /fetch, but let's check what the RPI logs say
  // Instead, let's check if there's a cookie requirement
  
  // Step 7: Fetch key from different servers via RPI
  console.log('\n[7] Testing all key servers via RPI:');
  const servers = [
    'https://go.ai-chatx.site/key/premium303/5909740',
    'https://chevy.vovlacosa.sbs/key/premium303/5909740',
    'https://chevy.soyspace.cyou/key/premium303/5909740',
  ];
  
  for (const srv of servers) {
    const u = `${RPI}/fetch?url=${encodeURIComponent(srv)}&headers=${encodeURIComponent(JSON.stringify({
      'Referer': 'https://adffdafdsafds.sbs/',
      'Origin': 'https://adffdafdsafds.sbs',
    }))}&key=${RPI_KEY}`;
    const r = await fetchFull(u, { headers: { 'X-API-Key': RPI_KEY } });
    const hex = r.buf.length === 16 ? r.buf.toString('hex') : `(${r.buf.length} bytes)`;
    console.log(`    ${new URL(srv).hostname}: ${hex}`);
  }

  // Step 8: Check if the key changes between requests (real keys are different each time)
  console.log('\n[8] Key stability test (3 rapid requests to same URL):');
  for (let i = 0; i < 3; i++) {
    const u = `${RPI}/fetch?url=${encodeURIComponent('https://go.ai-chatx.site/key/premium303/5909740')}&headers=${encodeURIComponent(JSON.stringify({
      'Referer': 'https://adffdafdsafds.sbs/',
      'Origin': 'https://adffdafdsafds.sbs',
    }))}&key=${RPI_KEY}`;
    const r = await fetchFull(u, { headers: { 'X-API-Key': RPI_KEY } });
    const hex = r.buf.length === 16 ? r.buf.toString('hex') : `(${r.buf.length} bytes)`;
    console.log(`    Request ${i+1}: ${hex}`);
  }
}

main().catch(e => console.error(e));
