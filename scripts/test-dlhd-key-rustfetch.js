#!/usr/bin/env node
/**
 * Test DLHD key fetching via RPI's rust-fetch (Chrome TLS fingerprint + residential IP)
 * 
 * Hypothesis: The key server might check TLS fingerprint, not just IP whitelist.
 * rust-fetch mimics Chrome's TLS fingerprint from a residential IP.
 * If this returns a REAL key (decrypts to 0x47), we don't need reCAPTCHA at all.
 * 
 * Also tests: fetching the player page via rust-fetch to see if we can extract
 * anything useful for server-side whitelist.
 */

const https = require('https');
const crypto = require('crypto');

const RPI_URL = process.env.RPI_PROXY_URL || 'https://rpi-proxy.vynx.cc';
const RPI_KEY = process.env.RPI_API_KEY || '5f1845926d725bb2a8230a6ed231fce1d03f07782f74a3f683c30ec04d4ac560';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function fetchBuf(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { 'User-Agent': UA, ...headers },
      timeout: 20000,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
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
      timeout: 20000,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

function decryptAndValidate(keyBuf, ivBuf, segmentBuf) {
  try {
    const decipher = crypto.createDecipheriv('aes-128-cbc', keyBuf, ivBuf);
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(segmentBuf), decipher.final()]);
    const firstByte = decrypted[0];
    let syncCount = 0;
    for (let i = 0; i < Math.min(decrypted.length, 1880); i += 188) {
      if (decrypted[i] === 0x47) syncCount++;
    }
    return {
      valid: firstByte === 0x47,
      firstByte: '0x' + firstByte.toString(16).padStart(2, '0'),
      syncCount,
    };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

async function main() {
  console.log('='.repeat(80));
  console.log('DLHD Key via RPI rust-fetch (Chrome TLS + Residential IP)');
  console.log('='.repeat(80));
  console.log(`RPI: ${RPI_URL}`);

  // Step 1: Get M3U8 and extract key URI + IV + segment
  console.log('\n--- Step 1: Fetch M3U8 ---');
  const lookupRes = await fetchText('https://chevy.vovlacosa.sbs/server_lookup?channel_id=premium44', {
    'Referer': 'https://adffdafdsafds.sbs/',
  });
  const serverKey = JSON.parse(lookupRes.body).server_key;
  
  const m3u8Url = `https://chevy.soyspace.cyou/proxy/${serverKey}/premium44/mono.css`;
  const m3u8Res = await fetchText(m3u8Url, {
    'Referer': 'https://adffdafdsafds.sbs/',
    'Origin': 'https://adffdafdsafds.sbs',
  });
  
  const keyLine = m3u8Res.body.match(/#EXT-X-KEY:([^\n]+)/);
  const uriMatch = keyLine[1].match(/URI="([^"]+)"/);
  const ivMatch = keyLine[1].match(/IV=([^,\s]+)/);
  const keyPath = uriMatch[1];
  const ivBuf = Buffer.from(ivMatch[1].replace(/^0x/i, ''), 'hex');
  
  const lines = m3u8Res.body.split('\n');
  let segmentUrl = null;
  for (const line of lines) {
    const t = line.trim();
    if (t && !t.startsWith('#') && t.startsWith('http')) { segmentUrl = t; break; }
  }
  
  console.log(`  Server: ${serverKey}`);
  console.log(`  Key path: ${keyPath}`);
  console.log(`  IV: ${ivBuf.toString('hex')}`);
  console.log(`  Segment: ${segmentUrl?.substring(0, 60)}...`);

  // Step 2: Fetch segment
  console.log('\n--- Step 2: Fetch Segment ---');
  const segRes = await fetchBuf(segmentUrl);
  console.log(`  Size: ${segRes.body.length} bytes`);

  // Step 3: Fetch key via RPI rust-fetch
  console.log('\n--- Step 3: Fetch Key via RPI rust-fetch ---');
  
  const keyUrls = [
    `https://go.ai-chatx.site${keyPath}`,
    `https://chevy.soyspace.cyou${keyPath}`,
  ];
  
  for (const keyUrl of keyUrls) {
    console.log(`\n  🔑 Testing via RPI rust-fetch: ${keyUrl}`);
    
    // Use RPI's /fetch-rust endpoint
    const rpiUrl = `${RPI_URL}/fetch-rust?url=${encodeURIComponent(keyUrl)}&headers=${encodeURIComponent(JSON.stringify({
      'Referer': 'https://adffdafdsafds.sbs/',
      'Origin': 'https://adffdafdsafds.sbs',
    }))}`;
    
    try {
      const keyRes = await fetchBuf(rpiUrl, { 'X-API-Key': RPI_KEY });
      console.log(`     RPI status: ${keyRes.status}`);
      console.log(`     Proxied-By: ${keyRes.headers['x-proxied-by'] || 'unknown'}`);
      console.log(`     Body size: ${keyRes.body.length}`);
      
      if (keyRes.body.length === 16) {
        const keyHex = keyRes.body.toString('hex');
        console.log(`     Key hex: ${keyHex}`);
        
        const validation = decryptAndValidate(keyRes.body, ivBuf, segRes.body);
        if (validation.valid) {
          console.log(`     ✅ REAL KEY! Decrypts to valid TS (0x47 sync, ${validation.syncCount}/10 packets)`);
        } else {
          console.log(`     ❌ FAKE KEY — first byte ${validation.firstByte} ≠ 0x47`);
        }
      } else {
        // Might be JSON error or HTML
        const text = keyRes.body.toString('utf8').substring(0, 200);
        console.log(`     Body: ${text}`);
      }
    } catch (e) {
      console.log(`     Error: ${e.message}`);
    }
  }

  // Step 4: Also try via RPI's /dlhdprivate (uses Node.js https, not rust-fetch)
  console.log('\n--- Step 4: Fetch Key via RPI /dlhdprivate ---');
  for (const keyUrl of keyUrls) {
    console.log(`\n  🔑 Testing via RPI /dlhdprivate: ${keyUrl}`);
    const rpiUrl = `${RPI_URL}/dlhdprivate?url=${encodeURIComponent(keyUrl)}&headers=${encodeURIComponent(JSON.stringify({
      'Referer': 'https://adffdafdsafds.sbs/',
      'Origin': 'https://adffdafdsafds.sbs',
    }))}`;
    
    try {
      const keyRes = await fetchBuf(rpiUrl, { 'X-API-Key': RPI_KEY });
      console.log(`     Status: ${keyRes.status}, Size: ${keyRes.body.length}`);
      
      if (keyRes.body.length === 16) {
        const keyHex = keyRes.body.toString('hex');
        console.log(`     Key hex: ${keyHex}`);
        const validation = decryptAndValidate(keyRes.body, ivBuf, segRes.body);
        if (validation.valid) {
          console.log(`     ✅ REAL KEY!`);
        } else {
          console.log(`     ❌ FAKE KEY — first byte ${validation.firstByte}`);
        }
      } else {
        console.log(`     Body: ${keyRes.body.toString('utf8').substring(0, 200)}`);
      }
    } catch (e) {
      console.log(`     Error: ${e.message}`);
    }
  }

  // Step 5: Try fetching the DLHD player page via rust-fetch to see what we get
  console.log('\n--- Step 5: Fetch DLHD Player Page via RPI ---');
  const playerUrl = 'https://adffdafdsafds.sbs/premiumtv/daddyhd.php?id=44';
  const rpiPlayerUrl = `${RPI_URL}/fetch-rust?url=${encodeURIComponent(playerUrl)}&headers=${encodeURIComponent(JSON.stringify({
    'Referer': 'https://dlstreams.top/',
  }))}`;
  
  try {
    const pageRes = await fetchText(rpiPlayerUrl, { 'X-API-Key': RPI_KEY });
    console.log(`  Status: ${pageRes.status}`);
    console.log(`  Body length: ${pageRes.body.length}`);
    console.log(`  Has reCAPTCHA: ${pageRes.body.includes('recaptcha')}`);
    console.log(`  Has grecaptcha: ${pageRes.body.includes('grecaptcha')}`);
    console.log(`  Has verify: ${pageRes.body.includes('ai-chatx.site/verify')}`);
    console.log(`  Has Clappr: ${pageRes.body.includes('Clappr')}`);
    console.log(`  Has server_lookup: ${pageRes.body.includes('server_lookup')}`);
    
    // Check if there's any token or session data we can extract
    const tokenMatch = pageRes.body.match(/token['":\s]+['"]([^'"]{20,})['"]/i);
    if (tokenMatch) console.log(`  Token found: ${tokenMatch[1].substring(0, 40)}...`);
    
    const sessionMatch = pageRes.body.match(/session['":\s]+['"]([^'"]+)['"]/i);
    if (sessionMatch) console.log(`  Session found: ${sessionMatch[1].substring(0, 40)}...`);
  } catch (e) {
    console.log(`  Error: ${e.message}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('DONE');
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
