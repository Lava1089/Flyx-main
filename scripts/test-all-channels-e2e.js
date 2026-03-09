#!/usr/bin/env node
/**
 * FULL E2E test: M3U8 → Key → Segment → Decrypt → Validate 0x47 sync byte
 * Tests that channels actually PLAY, not just return M3U8
 */

const https = require('https');
const crypto = require('crypto');

const CF = 'https://dlhd.vynx.workers.dev';
const API_KEY = 'vynx';

const POISON_KEYS = new Set([
  '45db13cfa0ed393fdb7da4dfe9b5ac81',
  '455806f8bc592fdacb6ed5e071a517b1',
  '4542956ed8680eaccb615f7faad4da8f',
]);

// Test a sample of channels across the range
const TEST_CHANNELS = [];
// First 50, then every 5th up to 350
for (let i = 1; i <= 50; i++) TEST_CHANNELS.push(i);
for (let i = 55; i <= 350; i += 5) TEST_CHANNELS.push(i);

const CONCURRENCY = 5;
const TIMEOUT = 20000;

function fetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const p = new URL(url);
    const req = https.get({
      hostname: p.hostname,
      path: p.pathname + p.search,
      headers: { 'User-Agent': 'Mozilla/5.0', ...(opts.headers || {}) },
      timeout: opts.timeout || TIMEOUT,
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ ms: Date.now() - t0, status: res.statusCode, buf, text: buf.toString(), headers: res.headers });
      });
    });
    req.on('error', e => resolve({ ms: Date.now() - t0, status: 0, buf: Buffer.alloc(0), text: e.message, headers: {} }));
    req.on('timeout', () => { req.destroy(); resolve({ ms: Date.now() - t0, status: 0, buf: Buffer.alloc(0), text: 'timeout', headers: {} }); });
  });
}

async function testChannelE2E(ch) {
  const result = { ch, m3u8: false, keyUrl: null, keyOk: false, keyHex: null, keyPoison: false, segmentOk: false, decryptOk: false, error: null, ms: 0 };
  const t0 = Date.now();

  try {
    // Step 1: Fetch M3U8 via /play
    const m3u8Resp = await fetch(`${CF}/play/${ch}?key=${API_KEY}`);
    if (!m3u8Resp.text.includes('#EXTM3U')) {
      result.error = `no-m3u8 (${m3u8Resp.status})`;
      result.ms = Date.now() - t0;
      return result;
    }
    result.m3u8 = true;

    // Step 2: Extract key URL from M3U8
    const keyMatch = m3u8Resp.text.match(/URI="([^"]+)"/);
    if (!keyMatch) {
      // Unencrypted stream (player6/moveonjoy) — that's fine
      result.keyOk = true;
      result.decryptOk = true;
      result.error = 'unencrypted';
      result.ms = Date.now() - t0;
      return result;
    }
    result.keyUrl = keyMatch[1];

    // Step 3: Fetch key
    const keyResp = await fetch(result.keyUrl, { timeout: 45000 });
    if (keyResp.buf.length !== 16) {
      result.error = `key-bad-size (${keyResp.buf.length}b, status=${keyResp.status})`;
      result.ms = Date.now() - t0;
      return result;
    }
    result.keyHex = keyResp.buf.toString('hex');
    result.keyPoison = POISON_KEYS.has(result.keyHex);
    result.keyOk = !result.keyPoison;

    if (result.keyPoison) {
      result.error = `poison-key (${result.keyHex.substring(0, 8)}...)`;
      result.ms = Date.now() - t0;
      return result;
    }

    // Step 4: Extract IV from EXT-X-KEY line
    const ivMatch = m3u8Resp.text.match(/IV=0x([0-9a-fA-F]+)/);
    const iv = ivMatch ? Buffer.from(ivMatch[1], 'hex') : Buffer.alloc(16, 0);

    // Step 5: Fetch first segment
    const segLines = m3u8Resp.text.split('\n').filter(l => {
      const t = l.trim();
      return t.startsWith('http') && !t.includes('workers.dev');
    });
    if (segLines.length === 0) {
      result.error = 'no-segments';
      result.ms = Date.now() - t0;
      return result;
    }

    const segResp = await fetch(segLines[0].trim(), { timeout: 15000 });
    if (segResp.buf.length < 188) {
      result.error = `segment-too-small (${segResp.buf.length}b)`;
      result.ms = Date.now() - t0;
      return result;
    }
    result.segmentOk = true;

    // Step 6: Decrypt first 16 bytes and check for 0x47 TS sync byte
    try {
      const decipher = crypto.createDecipheriv('aes-128-cbc', keyResp.buf, iv);
      decipher.setAutoPadding(false);
      // Decrypt at least 1 block (16 bytes)
      const blockSize = Math.min(segResp.buf.length, 4096);
      // AES-CBC needs multiple of 16
      const alignedSize = Math.floor(blockSize / 16) * 16;
      if (alignedSize >= 16) {
        const encrypted = segResp.buf.slice(0, alignedSize);
        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        // TS packets start with 0x47
        result.decryptOk = decrypted[0] === 0x47;
        if (!result.decryptOk) {
          result.error = `decrypt-bad-sync (first byte: 0x${decrypted[0].toString(16)})`;
        }
      } else {
        result.error = 'segment-too-small-for-decrypt';
      }
    } catch (e) {
      result.error = `decrypt-error: ${e.message}`;
    }
  } catch (e) {
    result.error = `exception: ${e.message}`;
  }

  result.ms = Date.now() - t0;
  return result;
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  DLHD Full E2E Test — M3U8 + Key + Decrypt Validation  ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`Testing ${TEST_CHANNELS.length} channels via ${CF}`);
  console.log(`Concurrency: ${CONCURRENCY}\n`);

  const results = [];
  const fullyWorking = [];  // M3U8 + real key + decrypts to 0x47
  const poisonKey = [];     // M3U8 ok but key is poison
  const badDecrypt = [];    // Key looks ok but doesn't decrypt properly
  const noM3U8 = [];        // Channel offline / no M3U8
  const otherError = [];    // Other errors

  for (let i = 0; i < TEST_CHANNELS.length; i += CONCURRENCY) {
    const batch = TEST_CHANNELS.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(testChannelE2E));

    for (const r of batchResults) {
      results.push(r);

      if (r.decryptOk) {
        fullyWorking.push(r);
        process.stdout.write('✅');
      } else if (!r.m3u8) {
        noM3U8.push(r);
        process.stdout.write('⬜');
      } else if (r.keyPoison) {
        poisonKey.push(r);
        process.stdout.write('🔴');
      } else if (r.keyOk && r.segmentOk && !r.decryptOk) {
        badDecrypt.push(r);
        process.stdout.write('🟡');
      } else {
        otherError.push(r);
        process.stdout.write('❌');
      }
    }
  }

  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  ✅ FULLY WORKING (decrypt OK):  ${fullyWorking.length}`);
  console.log(`  🔴 POISON KEY:                  ${poisonKey.length}`);
  console.log(`  🟡 BAD DECRYPT (key wrong):     ${badDecrypt.length}`);
  console.log(`  ❌ OTHER ERROR:                  ${otherError.length}`);
  console.log(`  ⬜ OFFLINE (no M3U8):            ${noM3U8.length}`);
  console.log(`  TOTAL TESTED:                   ${results.length}`);
  console.log('═══════════════════════════════════════════════════════════');

  const totalWithM3U8 = fullyWorking.length + poisonKey.length + badDecrypt.length + otherError.length;
  if (totalWithM3U8 > 0) {
    const pct = Math.round((fullyWorking.length / totalWithM3U8) * 100);
    console.log(`\n  Decrypt success rate: ${pct}% (${fullyWorking.length}/${totalWithM3U8} channels with M3U8)`);
  }

  if (poisonKey.length > 0) {
    console.log(`\n  POISON KEY channels (${poisonKey.length}):`);
    console.log(`    ${poisonKey.map(r => r.ch).join(', ')}`);
    // Show unique poison keys
    const uniquePoison = new Set(poisonKey.map(r => r.keyHex));
    console.log(`    Unique poison keys: ${[...uniquePoison].join(', ')}`);
  }

  if (badDecrypt.length > 0) {
    console.log(`\n  BAD DECRYPT channels (${badDecrypt.length}):`);
    for (const r of badDecrypt.slice(0, 20)) {
      console.log(`    ch${r.ch}: key=${r.keyHex?.substring(0, 16)}... error=${r.error}`);
    }
    if (badDecrypt.length > 20) console.log(`    ... and ${badDecrypt.length - 20} more`);
  }

  if (otherError.length > 0) {
    console.log(`\n  OTHER ERRORS (${otherError.length}):`);
    for (const r of otherError.slice(0, 20)) {
      console.log(`    ch${r.ch}: ${r.error}`);
    }
    if (otherError.length > 20) console.log(`    ... and ${otherError.length - 20} more`);
  }

  if (fullyWorking.length > 0) {
    const avgMs = Math.round(fullyWorking.reduce((s, r) => s + r.ms, 0) / fullyWorking.length);
    console.log(`\n  Avg E2E latency (working): ${avgMs}ms`);
  }

  console.log('\n  Done.');
}

main().catch(console.error);
