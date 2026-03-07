#!/usr/bin/env node
/**
 * DLHD E2E Test - March 2026
 * 
 * Tests the full live TV pipeline:
 * 1. Server lookup (chevy.vovlacosa.sbs)
 * 2. M3U8 fetch (chevy.soyspace.cyou/proxy/)
 * 3. Key URL extraction from M3U8
 * 4. Key domain reachability (go.ai-chatx.site)
 * 5. Player 6 fallback (lovetier.bz)
 * 6. New player domain (adffdafdsafds.sbs) reachability
 * 7. reCAPTCHA verify endpoint format test
 */

const https = require('https');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(url, {
      method: options.method || 'GET',
      headers: { 'User-Agent': UA, ...(options.headers || {}) },
      timeout: options.timeout || 10000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

let passed = 0;
let failed = 0;

function ok(name) { passed++; console.log(`  ✅ ${name}`); }
function fail(name, reason) { failed++; console.log(`  ❌ ${name}: ${reason}`); }

async function main() {
  console.log('DLHD E2E Test - March 2026\n');
  
  // Test 1: Server lookup
  console.log('1. Server Lookup');
  try {
    const res = await fetch('https://chevy.vovlacosa.sbs/server_lookup?channel_id=premium44', {
      headers: { 'Referer': 'https://www.ksohls.ru/', 'Origin': 'https://www.ksohls.ru' },
    });
    const data = JSON.parse(res.body);
    if (data.server_key) ok(`Server lookup: ${data.server_key}`);
    else fail('Server lookup', 'No server_key');
  } catch (e) { fail('Server lookup', e.message); }
  
  // Test 2: M3U8 fetch
  console.log('\n2. M3U8 Fetch');
  let keyUri = null;
  try {
    const res = await fetch('https://chevy.soyspace.cyou/proxy/zeko/premium44/mono.css', {
      headers: { 'Referer': 'https://www.ksohls.ru/', 'Origin': 'https://www.ksohls.ru' },
    });
    if (res.body.includes('#EXTM3U')) {
      ok('M3U8 valid');
      const match = res.body.match(/URI="([^"]+)"/);
      if (match) {
        keyUri = match[1];
        ok(`Key URI: ${keyUri}`);
      } else fail('Key URI extraction', 'No URI found');
    } else fail('M3U8 fetch', `Status ${res.status}, not M3U8`);
  } catch (e) { fail('M3U8 fetch', e.message); }
  
  // Test 3: Key domain reachability
  console.log('\n3. Key Domain');
  try {
    const keyUrl = keyUri ? `https://go.ai-chatx.site${keyUri}` : 'https://go.ai-chatx.site/key/premium44/5909692';
    const res = await fetch(keyUrl, {
      headers: { 'Referer': 'https://www.ksohls.ru/', 'Origin': 'https://www.ksohls.ru' },
    });
    if (res.status === 200) ok(`Key domain reachable (${res.body.length} bytes)`);
    else fail('Key domain', `Status ${res.status}`);
    
    if (res.headers['access-control-allow-origin'] === '*') ok('CORS: *');
    else fail('CORS', res.headers['access-control-allow-origin'] || 'not set');
  } catch (e) { fail('Key domain', e.message); }
  
  // Test 4: Player 6 fallback
  console.log('\n4. Player 6 Fallback');
  try {
    const res = await fetch('https://lovetier.bz/player/ESPN', {
      headers: { 'Referer': 'https://lovecdn.ru/' },
    });
    if (res.status === 200 && res.body.includes('streamUrl')) ok('Player 6 working');
    else fail('Player 6', `Status ${res.status}`);
  } catch (e) { fail('Player 6', e.message); }
  
  // Test 5: New player domain
  console.log('\n5. New Player Domain');
  try {
    const res = await fetch('https://adffdafdsafds.sbs/premiumtv/daddyhd.php?id=44', {
      headers: { 'Referer': 'https://dlstreams.top/' },
    });
    if (res.status === 200) {
      ok(`adffdafdsafds.sbs reachable (${res.body.length} chars)`);
      if (res.body.includes('CHANNEL_KEY')) ok('Has CHANNEL_KEY');
      else fail('CHANNEL_KEY', 'Not found in page');
      if (res.body.includes('recaptcha')) ok('Has reCAPTCHA');
      else fail('reCAPTCHA', 'Not found in page');
    } else fail('New player domain', `Status ${res.status}`);
  } catch (e) { fail('New player domain', e.message); }
  
  // Test 6: reCAPTCHA verify endpoint format
  console.log('\n6. Verify Endpoint');
  try {
    // Test that the endpoint accepts POST with JSON body
    const res = await fetch('https://go.ai-chatx.site/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 'recaptcha-token': 'test-invalid-token', 'channel_id': 'premium44' }),
    });
    // We expect a JSON response (even if verification fails due to invalid token)
    try {
      const data = JSON.parse(res.body);
      ok(`Verify endpoint responds with JSON: ${JSON.stringify(data).substring(0, 100)}`);
      if (data.success === false) ok('Correctly rejects invalid token');
    } catch {
      fail('Verify endpoint', `Non-JSON response: ${res.body.substring(0, 100)}`);
    }
  } catch (e) { fail('Verify endpoint', e.message); }
  
  // Test 7: dlstreams.top → stream page → player iframe
  console.log('\n7. Domain Chain');
  try {
    const res = await fetch('https://dlstreams.top/stream/stream-44.php', {
      headers: { 'Referer': 'https://dlstreams.top/' },
    });
    if (res.status === 200) {
      const iframeMatch = res.body.match(/<iframe[^>]*src="([^"]+)"/i);
      if (iframeMatch) {
        const playerUrl = iframeMatch[1];
        ok(`Stream page → ${playerUrl}`);
        const playerDomain = new URL(playerUrl).hostname;
        if (playerDomain === 'adffdafdsafds.sbs') ok('Player domain confirmed: adffdafdsafds.sbs');
        else fail('Player domain', `Expected adffdafdsafds.sbs, got ${playerDomain}`);
      } else fail('Stream page', 'No iframe found');
    } else fail('Stream page', `Status ${res.status}`);
  } catch (e) { fail('Domain chain', e.message); }
  
  // Summary
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed === 0) console.log('🎉 All tests passed!');
  else console.log('⚠️ Some tests failed — see above');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
