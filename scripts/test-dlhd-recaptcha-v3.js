#!/usr/bin/env node
/**
 * Test reCAPTCHA v3 HTTP-only bypass via rust-fetch
 * 
 * Tests the full flow:
 * 1. rust-fetch --mode recaptcha-v3 → gets token
 * 2. POST token to go.ai-chatx.site/verify → whitelist IP
 * 3. Fetch key from key server → should be real (not fake)
 */

const { spawn } = require('child_process');
const https = require('https');
const path = require('path');

const RUST_FETCH = path.join(__dirname, '..', 'rpi-proxy', 'rust-fetch', 'target', 'release', 'rust-fetch.exe');
const SITE_KEY = '6LfJv4AsAAAAALTLEHKaQ7LN_VYfFqhLPrB2Tvgj';
const PAGE_URL = 'https://adffdafdsafds.sbs/';
const ACTION = 'player_access';
const VERIFY_URL = 'https://go.ai-chatx.site/verify';
const FAKE_KEY = '45db13cfa0ed393fdb7da4dfe9b5ac81';

async function step1_getRecaptchaToken() {
  console.log('\n=== Step 1: Get reCAPTCHA v3 token via rust-fetch ===');
  
  return new Promise((resolve, reject) => {
    const args = [
      '--mode', 'recaptcha-v3',
      '--url', PAGE_URL,
      '--site-key', SITE_KEY,
      '--action', ACTION,
      '--timeout', '30',
    ];
    
    const proc = spawn(RUST_FETCH, args);
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { 
      stderr += d.toString();
      // Print stderr in real-time for debugging
      process.stderr.write(d);
    });
    
    proc.on('error', (err) => reject(new Error(`spawn error: ${err.message}`)));
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`rust-fetch exit ${code}\nstderr: ${stderr}`));
        return;
      }
      const token = stdout.trim();
      console.log(`\n✅ Got token (${token.length} chars): ${token.substring(0, 40)}...${token.substring(token.length - 20)}`);
      resolve(token);
    });
  });
}

async function step2_verifyToken(token) {
  console.log('\n=== Step 2: POST token to verify endpoint ===');
  
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      'recaptcha-token': token,
      'channel_id': 'premium44',
    });
    
    console.log(`POST ${VERIFY_URL}`);
    console.log(`Body: ${postData.substring(0, 80)}...`);
    
    const url = new URL(VERIFY_URL);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
        'Origin': 'https://adffdafdsafds.sbs',
        'Referer': 'https://adffdafdsafds.sbs/',
      },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        console.log(`Response status: ${res.statusCode}`);
        console.log(`Response body: ${data}`);
        try {
          const json = JSON.parse(data);
          if (json.success) {
            console.log(`✅ Verification passed! Score: ${json.score}`);
          } else {
            console.log(`❌ Verification failed:`, json);
          }
          resolve(json);
        } catch {
          reject(new Error(`Non-JSON response: ${data.substring(0, 200)}`));
        }
      });
    });
    
    req.on('error', (err) => reject(err));
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(postData);
    req.end();
  });
}

async function step3_testKeyFetch() {
  console.log('\n=== Step 3: Test key fetch (should be real key now) ===');
  
  // Try multiple key servers
  const keyUrls = [
    'https://chevy.soyspace.cyou/key/premium44/key.php',
    'https://go.ai-chatx.site/key/premium44/key.php',
    'https://chevy.vovlacosa.sbs/key/premium44/key.php',
  ];
  
  for (const keyUrl of keyUrls) {
    console.log(`\nFetching key: ${keyUrl}`);
    
    try {
      const result = await new Promise((resolve, reject) => {
        // Use https directly to get raw binary
        const url = new URL(keyUrl);
        const req = https.get({
          hostname: url.hostname,
          path: url.pathname,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
            'Referer': 'https://adffdafdsafds.sbs/',
            'Origin': 'https://adffdafdsafds.sbs',
          },
          timeout: 10000,
        }, (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const buf = Buffer.concat(chunks);
            resolve({ buf, status: res.statusCode });
          });
        });
        req.on('error', (err) => reject(err));
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      });
      
      const hex = result.buf.toString('hex');
      console.log(`  Status: ${result.status}, Size: ${result.buf.length} bytes, Hex: ${hex}`);
      
      if (result.buf.length === 16) {
        if (hex === FAKE_KEY) {
          console.log(`  ❌ FAKE key`);
        } else {
          console.log(`  ✅ REAL key: ${hex}`);
        }
      } else {
        console.log(`  ⚠️ Unexpected size: ${result.buf.length}`);
        console.log(`  Text: ${result.buf.toString('utf8').substring(0, 200)}`);
      }
    } catch (err) {
      console.log(`  ❌ Error: ${err.message}`);
    }
  }
}

async function main() {
  console.log('DLHD reCAPTCHA v3 HTTP-only Bypass Test');
  console.log('========================================');
  
  try {
    const token = await step1_getRecaptchaToken();
    const verifyResult = await step2_verifyToken(token);
    
    if (verifyResult.success) {
      // Wait a moment for whitelist to propagate
      console.log('\nWaiting 2s for whitelist propagation...');
      await new Promise(r => setTimeout(r, 2000));
      await step3_testKeyFetch();
    }
    
    console.log('\n========================================');
    console.log('Test complete!');
  } catch (err) {
    console.error(`\n❌ FAILED: ${err.message}`);
    process.exit(1);
  }
}

main();
