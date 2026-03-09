#!/usr/bin/env node
/**
 * Full E2E test: reCAPTCHA v3 bypass → IP whitelist → real key fetch
 * Tests both RPI proxy directly AND CF worker endpoints
 */

const https = require('https');
const http = require('http');

const RPI_URL = 'https://rpi-proxy.vynx.cc';
const RPI_KEY = '5f1845926d725bb2a8230a6ed231fce1d03f07782f74a3f683c30ec04d4ac560';
const CF_WORKER = 'https://dlhd.vynx.workers.dev';
const API_KEY = 'vynx';
const CHANNEL = '44';

const POISON_KEYS = new Set([
  '45db13cfa0ed393fdb7da4dfe9b5ac81',
  '455806f8bc592fdacb6ed5e071a517b1',
  '4542956ed8680eaccb615f7faad4da8f',
]);

function fetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: opts.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...(opts.headers || {}),
      },
      timeout: opts.timeout || 30000,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, buf, text: buf.toString() });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function pass(msg) { console.log(`  ✅ ${msg}`); }
function fail(msg) { console.log(`  ❌ ${msg}`); }
function info(msg) { console.log(`  ℹ️  ${msg}`); }

let passed = 0, failed = 0;

async function test(name, fn) {
  console.log(`\n[${'='.repeat(60)}]`);
  console.log(`TEST: ${name}`);
  console.log(`[${'='.repeat(60)}]`);
  const t0 = Date.now();
  try {
    const ok = await fn();
    const ms = Date.now() - t0;
    if (ok !== false) { passed++; pass(`PASSED (${ms}ms)`); }
    else { failed++; fail(`FAILED (${ms}ms)`); }
  } catch (e) {
    failed++;
    fail(`ERROR: ${e.message} (${Date.now() - t0}ms)`);
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  DLHD reCAPTCHA v3 Bypass — Full E2E Test              ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`RPI:    ${RPI_URL}`);
  console.log(`Worker: ${CF_WORKER}`);
  console.log(`Channel: ${CHANNEL}`);

  // ─── TEST 1: RPI health check ───
  await test('RPI Proxy is alive', async () => {
    const r = await fetch(`${RPI_URL}/health?key=${RPI_KEY}`);
    info(`Status: ${r.status}, Body: ${r.text.substring(0, 200)}`);
    return r.status === 200;
  });

  // ─── TEST 2: RPI whitelist endpoint (triggers reCAPTCHA bypass) ───
  let whitelistOk = false;
  await test('RPI /dlhd-whitelist (reCAPTCHA v3 bypass)', async () => {
    const r = await fetch(`${RPI_URL}/dlhd-whitelist?channel=premium${CHANNEL}&key=${RPI_KEY}`, { timeout: 35000 });
    info(`Status: ${r.status}`);
    let data;
    try { data = JSON.parse(r.text); } catch { data = r.text; }
    info(`Response: ${JSON.stringify(data).substring(0, 300)}`);
    whitelistOk = r.status === 200 && data.success === true;
    if (whitelistOk) info(`IP whitelisted! score=${data.score}`);
    return whitelistOk;
  });

  // ─── TEST 3: Direct key fetch from chevy.soyspace.cyou (after whitelist) ───
  let realKeyHex = null;
  await test('Direct key fetch (chevy.soyspace.cyou) — should be REAL key', async () => {
    // First get M3U8 to find key URL
    const m3u8 = await fetch(`https://chevy.soyspace.cyou/proxy/zeko/premium${CHANNEL}/mono.css`, {
      headers: { 'Referer': 'https://www.ksohls.ru/', 'Origin': 'https://www.ksohls.ru' },
    });
    info(`M3U8 status: ${m3u8.status}, length: ${m3u8.buf.length}`);
    
    if (!m3u8.text.includes('#EXTM3U')) {
      info(`M3U8 content: ${m3u8.text.substring(0, 200)}`);
      fail('Not a valid M3U8');
      return false;
    }
    
    const keyMatch = m3u8.text.match(/URI="([^"]+)"/);
    if (!keyMatch) { fail('No key URI in M3U8'); return false; }
    info(`Key path: ${keyMatch[1]}`);
    
    const keyUrl = keyMatch[1].startsWith('http') ? keyMatch[1] : `https://chevy.soyspace.cyou${keyMatch[1]}`;
    const keyResp = await fetch(keyUrl, {
      headers: { 'Referer': 'https://www.ksohls.ru/', 'Origin': 'https://www.ksohls.ru' },
    });
    
    const hex = keyResp.buf.toString('hex');
    info(`Key: ${hex} (${keyResp.buf.length} bytes)`);
    info(`Is poison: ${POISON_KEYS.has(hex)}`);
    
    if (keyResp.buf.length === 16 && !POISON_KEYS.has(hex)) {
      realKeyHex = hex;
      return true;
    }
    return false;
  });

  // ─── TEST 4: RPI /dlhd-key-v6 endpoint (auto-whitelist + key fetch) ───
  await test('RPI /dlhd-key-v6 (key fetch via rust-fetch)', async () => {
    const keyUrl = encodeURIComponent(`https://chevy.soyspace.cyou/key/premium${CHANNEL}/1`);
    const r = await fetch(`${RPI_URL}/dlhd-key-v6?url=${keyUrl}&key=${RPI_KEY}`, { timeout: 40000 });
    info(`Status: ${r.status}, Content-Type: ${r.headers['content-type']}, Length: ${r.buf.length}`);
    
    if (r.buf.length === 16) {
      const hex = r.buf.toString('hex');
      info(`Key: ${hex}`);
      info(`Is poison: ${POISON_KEYS.has(hex)}`);
      info(`Source: ${r.headers['x-fetched-by'] || 'unknown'}`);
      return !POISON_KEYS.has(hex);
    }
    
    // Might be JSON error
    info(`Body: ${r.text.substring(0, 300)}`);
    return false;
  });

  // ─── TEST 5: CF Worker /debug/keytest ───
  await test('CF Worker /debug/keytest', async () => {
    const r = await fetch(`${CF_WORKER}/debug/keytest?ch=${CHANNEL}&key=${API_KEY}`, { timeout: 45000 });
    info(`Status: ${r.status}`);
    let data;
    try { data = JSON.parse(r.text); } catch { data = r.text; }
    info(`Response: ${JSON.stringify(data).substring(0, 500)}`);
    
    // Check if any test got a real key
    if (data.tests && Array.isArray(data.tests)) {
      for (const t of data.tests) {
        if (t.keyHex && !POISON_KEYS.has(t.keyHex)) {
          info(`Real key found via ${t.server}: ${t.keyHex}`);
          return true;
        }
      }
    }
    // Check if whitelist was triggered
    if (data.whitelistRefresh) {
      info(`Whitelist triggered: ${JSON.stringify(data.whitelistRefresh).substring(0, 200)}`);
    }
    return false;
  });

  // ─── TEST 6: CF Worker /key endpoint ───
  await test('CF Worker /key endpoint', async () => {
    const keyUrl = encodeURIComponent(`https://chevy.soyspace.cyou/key/premium${CHANNEL}/1`);
    const r = await fetch(`${CF_WORKER}/key?url=${keyUrl}&key=${API_KEY}`, { timeout: 45000 });
    info(`Status: ${r.status}, Content-Type: ${r.headers['content-type']}, Length: ${r.buf.length}`);
    info(`X-Key-Source: ${r.headers['x-key-source'] || 'none'}`);
    
    if (r.buf.length === 16) {
      const hex = r.buf.toString('hex');
      info(`Key: ${hex}`);
      info(`Is poison: ${POISON_KEYS.has(hex)}`);
      return !POISON_KEYS.has(hex);
    }
    info(`Body: ${r.text.substring(0, 300)}`);
    return false;
  });

  // ─── TEST 7: CF Worker /play endpoint (full pipeline) ───
  await test('CF Worker /play (full M3U8 pipeline)', async () => {
    const r = await fetch(`${CF_WORKER}/play/${CHANNEL}?key=${API_KEY}`, { timeout: 45000 });
    info(`Status: ${r.status}, Content-Type: ${r.headers['content-type']}, Length: ${r.buf.length}`);
    
    if (r.text.includes('#EXTM3U')) {
      info('Got valid M3U8 playlist');
      const lines = r.text.split('\n').filter(l => l.trim());
      info(`Lines: ${lines.length}`);
      const hasKey = r.text.includes('#EXT-X-KEY');
      info(`Has encryption key ref: ${hasKey}`);
      const hasSegments = r.text.includes('.ts') || r.text.includes('mono.css');
      info(`Has segments: ${hasSegments}`);
      return true;
    }
    
    info(`Body: ${r.text.substring(0, 500)}`);
    return false;
  });

  // ─── Summary ───
  console.log('\n' + '═'.repeat(62));
  console.log(`  Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log('═'.repeat(62));
  
  if (failed === 0) {
    console.log('  🎉 ALL TESTS PASSED — reCAPTCHA bypass is fully working!');
  } else {
    console.log('  ⚠️  Some tests failed — check output above');
  }
  console.log();
}

main().catch(console.error);
