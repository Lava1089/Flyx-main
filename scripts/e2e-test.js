#!/usr/bin/env node
/**
 * DLHD E2E Decryption Test
 * Tests multiple channels: M3U8 → Key → Segment → Decrypt → TS Validate
 */
const https = require('https');
const crypto = require('crypto');

const CHANNELS = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : ['51', '44', '1', '100', '70', '130', '200', '33', '309', '399'];

const WORKER = 'https://dlhd.vynx.workers.dev';

function fetch(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.get(
      { hostname: u.hostname, path: u.pathname + u.search, headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 60000 },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function testChannel(ch) {
  const t0 = Date.now();

  // 1. Fetch M3U8
  const m3u8Resp = await fetch(`${WORKER}/play/${ch}?key=vynx`);
  const m3u8 = m3u8Resp.body.toString();
  if (!m3u8.includes('#EXTM3U')) return { ch, ok: false, reason: `no M3U8 (${m3u8Resp.status})`, ms: Date.now() - t0 };

  // 2. Extract key
  const keyLine = m3u8.split('\n').find((l) => l.includes('EXT-X-KEY'));
  if (!keyLine) return { ch, ok: false, reason: 'no EXT-X-KEY', ms: Date.now() - t0 };

  const ivMatch = keyLine.match(/IV=0x([a-f0-9]+)/);
  if (!ivMatch) return { ch, ok: false, reason: 'no IV', ms: Date.now() - t0 };

  const b64Match = keyLine.match(/base64,([^"]+)/);
  let key;
  if (b64Match) {
    key = Buffer.from(b64Match[1], 'base64');
  } else {
    const uriMatch = keyLine.match(/URI="([^"]+)"/);
    if (!uriMatch) return { ch, ok: false, reason: 'no key URI', ms: Date.now() - t0 };
    const keyResp = await fetch(uriMatch[1]);
    key = keyResp.body;
  }

  if (key.length !== 16) return { ch, ok: false, reason: `bad key size: ${key.length}`, ms: Date.now() - t0 };

  // 3. Fetch first segment
  const segUrl = m3u8.split('\n').filter((l) => l.trim() && !l.startsWith('#'))[0]?.trim();
  if (!segUrl) return { ch, ok: false, reason: 'no segment URL', ms: Date.now() - t0 };
  const segResp = await fetch(segUrl);

  // 4. Decrypt
  try {
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, Buffer.from(ivMatch[1], 'hex'));
    const dec = Buffer.concat([decipher.update(segResp.body), decipher.final()]);

    // 5. Validate TS
    let syncs = 0;
    const total = Math.min(Math.floor(dec.length / 188), 20);
    for (let i = 0; i < total * 188; i += 188) {
      if (dec[i] === 0x47) syncs++;
    }

    const ok = dec[0] === 0x47 && syncs === total;
    return { ch, ok, syncs, total, ms: Date.now() - t0, keyType: b64Match ? 'inline' : 'proxy' };
  } catch (e) {
    return { ch, ok: false, reason: 'decrypt failed', ms: Date.now() - t0, keyHex: key.toString('hex').substring(0, 8) };
  }
}

(async () => {
  console.log(`\nDLHD E2E Test — ${CHANNELS.length} channels\n`);
  console.log('CH    Result  Time    Details');
  console.log('─'.repeat(50));

  let passed = 0;
  for (const ch of CHANNELS) {
    const r = await testChannel(ch);
    const time = (r.ms / 1000).toFixed(1).padStart(5) + 's';
    if (r.ok) {
      passed++;
      console.log(`${ch.padEnd(6)}✅     ${time}   ${r.syncs}/${r.total} TS  ${r.keyType}`);
    } else {
      const detail = r.reason || `key=${r.keyHex}...`;
      console.log(`${ch.padEnd(6)}❌     ${time}   ${detail}`);
    }
  }

  console.log('─'.repeat(50));
  console.log(`${passed}/${CHANNELS.length} passed\n`);
  process.exit(passed === CHANNELS.length ? 0 : 1);
})();
