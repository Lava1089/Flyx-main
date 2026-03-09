#!/usr/bin/env node
/**
 * Test DLHD whitelist flow:
 * 1. rust-fetch generates reCAPTCHA v3 token (HTTP-only, no browser)
 * 2. POST token to chevy.soyspace.cyou/verify → whitelists our IP
 * 3. Fetch key → should return REAL key (not poison)
 * 4. Fetch M3U8 → verify stream is playable
 */

const { execFileSync } = require('child_process');
const path = require('path');
const https = require('https');

const RUST = path.join(__dirname, '..', 'rpi-proxy', 'rust-fetch', 'target', 'release', 'rust-fetch.exe');
const SITE_KEY = '6LfJv4AsAAAAALTLEHKaQ7LN_VYfFqhLPrB2Tvgj';
const PAGE_URL = 'https://www.ksohls.ru/premiumtv/daddyhd.php?id=44';
const VERIFY_URL = 'https://chevy.soyspace.cyou/verify';
const CHANNEL = 'premium44';

const POISON_KEYS = new Set([
  '45db13cfa0ed393fdb7da4dfe9b5ac81',
  '455806f8bc592fdacb6ed5e071a517b1',
  '4542956ed8680eaccb615f7faad4da8f',
]);

function postJson(url, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': 'https://www.ksohls.ru',
        'Referer': 'https://www.ksohls.ru/',
      },
    }, (res) => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        try { resolve({ status: res.statusCode, data: JSON.parse(text) }); }
        catch { resolve({ status: res.statusCode, data: text }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function fetchBinary(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    https.get({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.ksohls.ru/',
      },
    }, (res) => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, data: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

async function main() {
  console.log('=== DLHD Whitelist Test ===\n');

  // Step 0: Fetch key BEFORE whitelist (should be poison)
  console.log('[0] Fetching key BEFORE whitelist...');
  const m3u8Resp = await fetchBinary('https://chevy.soyspace.cyou/proxy/zeko/premium44/mono.css');
  const m3u8Text = m3u8Resp.data.toString();
  const keyUriMatch = m3u8Text.match(/URI="([^"]+)"/);
  if (!keyUriMatch) { console.error('No key URI in M3U8!'); return; }
  const keyPath = keyUriMatch[1];
  console.log(`   Key path: ${keyPath}`);

  const beforeKey = await fetchBinary(`https://chevy.soyspace.cyou${keyPath}`);
  const beforeHex = Buffer.from(beforeKey.data).toString('hex');
  console.log(`   Key before: ${beforeHex} (${beforeKey.data.length}b)`);
  console.log(`   Is poison: ${POISON_KEYS.has(beforeHex)}\n`);

  // Step 1: Generate reCAPTCHA token
  console.log('[1] Generating reCAPTCHA v3 token via rust-fetch...');
  const t0 = Date.now();
  let token;
  try {
    token = execFileSync(RUST, [
      '--mode', 'recaptcha-v3',
      '--url', PAGE_URL,
      '--site-key', SITE_KEY,
      '--action', 'player_access',
    ], { encoding: 'utf8', timeout: 20000, windowsHide: true }).trim();
  } catch (e) {
    // rust-fetch outputs token to stdout, logs to stderr
    // execFileSync might throw if stderr has content but stdout is fine
    if (e.stdout) token = e.stdout.trim();
    else { console.error('Failed to get token:', e.message); return; }
  }
  console.log(`   Token: ${token.substring(0, 40)}... (${token.length} chars, ${Date.now() - t0}ms)\n`);

  // Step 2: POST to verify endpoint
  console.log('[2] POSTing to verify endpoint...');
  const t1 = Date.now();
  const verifyResp = await postJson(VERIFY_URL, {
    'recaptcha-token': token,
    'channel_id': CHANNEL,
  });
  console.log(`   Status: ${verifyResp.status} (${Date.now() - t1}ms)`);
  console.log(`   Response:`, verifyResp.data);
  console.log();

  if (!verifyResp.data.success) {
    console.error('Verification FAILED! Cannot proceed.');
    return;
  }

  // Step 3: Fetch key AFTER whitelist
  console.log('[3] Fetching key AFTER whitelist...');
  // Small delay to let whitelist propagate
  await new Promise(r => setTimeout(r, 500));
  
  const afterKey = await fetchBinary(`https://chevy.soyspace.cyou${keyPath}`);
  const afterHex = Buffer.from(afterKey.data).toString('hex');
  console.log(`   Key after:  ${afterHex} (${afterKey.data.length}b)`);
  console.log(`   Is poison:  ${POISON_KEYS.has(afterHex)}`);
  console.log();

  if (POISON_KEYS.has(afterHex)) {
    console.log('❌ STILL GETTING POISON KEY after whitelist!');
    console.log('   The whitelist may be per-channel or have a delay.');
  } else {
    console.log('✅ GOT REAL KEY! Whitelist is working!');
    console.log(`   Real key: ${afterHex}`);
  }

  // Step 4: Also test go.ai-chatx.site
  console.log('\n[4] Testing go.ai-chatx.site key server...');
  try {
    const aiKey = await fetchBinary(`https://go.ai-chatx.site${keyPath}`);
    const aiHex = Buffer.from(aiKey.data).toString('hex');
    console.log(`   go.ai-chatx.site: ${aiHex} (${aiKey.data.length}b) poison=${POISON_KEYS.has(aiHex)}`);
  } catch (e) {
    console.log(`   go.ai-chatx.site: ERROR ${e.message}`);
  }

  console.log('\n=== Done ===');
}

main().catch(console.error);
