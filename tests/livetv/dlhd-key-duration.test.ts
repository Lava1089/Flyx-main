/**
 * DLHD Key Duration Test
 *
 * We already whitelisted premium44 — its key was 10640fc5a5ffaa92abe37906a7db4f73.
 * This test fetches the key for premium44 repeatedly over time to see when/if it changes.
 *
 * We also fetch from premium52/53/54 which were whitelisted in the previous test
 * to see if those keys are still the same.
 */

import { describe, test } from 'bun:test';
import { createHmac, createHash } from 'crypto';

const PLAYER_DOMAIN = 'www.ksohls.ru';
const CDN_DOMAIN = 'soyspace.cyou';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HMAC_SECRET = '444c44cc8888888844444444';
const POW_THRESHOLD = 0x1000;
const MAX_NONCE_ITERATIONS = 100000;

const FAKE_KEYS = new Set([
  '45db13cfa0ed393fdb7da4dfe9b5ac81',
  '455806f8bc592fdacb6ed5e071a517b1',
  '4542956ed8680eaccb615f7faad4da8f',
]);

function computePoWNonce(resource: string, keyNumber: string, timestamp: number): number | null {
  const hmac = createHmac('sha256', HMAC_SECRET).update(resource).digest('hex');
  for (let nonce = 0; nonce < MAX_NONCE_ITERATIONS; nonce++) {
    const data = `${hmac}${resource}${keyNumber}${timestamp}${nonce}`;
    const hash = createHash('md5').update(data).digest('hex');
    if (parseInt(hash.substring(0, 4), 16) < POW_THRESHOLD) return nonce;
  }
  return null;
}

function generateKeyJWT(resource: string, keyNumber: string, timestamp: number, nonce: number): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = { resource, keyNumber, timestamp, nonce, exp: timestamp + 300 };
  const b64H = Buffer.from(JSON.stringify(header)).toString('base64url');
  const b64P = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', HMAC_SECRET).update(`${b64H}.${b64P}`).digest('base64url');
  return `${b64H}.${b64P}.${sig}`;
}

async function fetchKey(channelKey: string, keyNumber: string = '1'): Promise<string | null> {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = computePoWNonce(channelKey, keyNumber, timestamp);
  if (nonce === null) return null;
  const jwt = generateKeyJWT(channelKey, keyNumber, timestamp, nonce);

  const servers = [
    `https://chevy.${CDN_DOMAIN}/key/${channelKey}/${keyNumber}`,
    `https://go.ai-chatx.site/key/${channelKey}/${keyNumber}`,
    `https://chevy.vovlacosa.sbs/key/${channelKey}/${keyNumber}`,
  ];

  for (const url of servers) {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 10000);
      const resp = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Referer': `https://${PLAYER_DOMAIN}/`,
          'Origin': `https://${PLAYER_DOMAIN}`,
          'Authorization': `Bearer ${jwt}`,
          'X-Key-Timestamp': timestamp.toString(),
          'X-Key-Nonce': nonce.toString(),
        },
        signal: c.signal,
      });
      clearTimeout(t);
      if (!resp.ok) continue;
      const buf = await resp.arrayBuffer();
      return Buffer.from(buf).toString('hex');
    } catch { continue; }
  }
  return null;
}

describe('DLHD Key Duration', () => {

  // Previous test results for comparison
  const PREVIOUS_KEYS: Record<string, string> = {
    premium44: '10640fc5a5ffaa92abe37906a7db4f73',
    premium52: 'd5c693b4f6971cd16dfcc45855d3903b',
    premium53: '7c2fc5a98005219df7f9cb28355dac87',
    premium54: '6ca734affbd830fb69e81ee766e19382',
  };

  test('check if keys from previous test are still the same', async () => {
    console.log('\n════════════════════════════════════════');
    console.log('  KEY PERSISTENCE CHECK');
    console.log('  Comparing against keys from previous test run');
    console.log('════════════════════════════════════════\n');

    for (const [channel, previousHex] of Object.entries(PREVIOUS_KEYS)) {
      const currentHex = await fetchKey(channel);
      if (!currentHex) {
        console.log(`[${channel}] ❌ FAILED to fetch`);
        continue;
      }

      const isFake = FAKE_KEYS.has(currentHex);
      const same = currentHex === previousHex;

      if (isFake) {
        console.log(`[${channel}] ⚠️  FAKE — whitelist expired`);
        console.log(`  previous: ${previousHex}`);
        console.log(`  current:  ${currentHex} (fake)`);
      } else if (same) {
        console.log(`[${channel}] ✅ SAME KEY — still valid`);
        console.log(`  key: ${currentHex}`);
      } else {
        console.log(`[${channel}] 🔄 KEY CHANGED`);
        console.log(`  previous: ${previousHex}`);
        console.log(`  current:  ${currentHex}`);
      }
      console.log('');
      await new Promise(r => setTimeout(r, 500));
    }
  }, 60000);

  test('poll premium44 key every 30s for 5 minutes to detect rotation', async () => {
    console.log('\n════════════════════════════════════════');
    console.log('  KEY ROTATION POLLING — premium44');
    console.log('  Fetching every 30s for 5 minutes');
    console.log('════════════════════════════════════════\n');

    const INTERVAL_MS = 30_000;
    const DURATION_MS = 5 * 60_000;
    const iterations = Math.floor(DURATION_MS / INTERVAL_MS) + 1;

    const results: { time: string; elapsed: string; hex: string; status: string }[] = [];
    const startTime = Date.now();
    let firstRealKey: string | null = null;
    let rotationDetected = false;

    for (let i = 0; i < iterations; i++) {
      const elapsed = Date.now() - startTime;
      const elapsedStr = `${Math.floor(elapsed / 60000)}m${Math.floor((elapsed % 60000) / 1000)}s`;
      const timeStr = new Date().toISOString().substring(11, 19);

      const hex = await fetchKey('premium44');

      if (!hex) {
        console.log(`[${timeStr}] +${elapsedStr} ❌ FAILED`);
        results.push({ time: timeStr, elapsed: elapsedStr, hex: 'FAILED', status: 'failed' });
      } else if (FAKE_KEYS.has(hex)) {
        console.log(`[${timeStr}] +${elapsedStr} ⚠️  FAKE — whitelist expired`);
        results.push({ time: timeStr, elapsed: elapsedStr, hex, status: 'fake' });
      } else {
        if (!firstRealKey) firstRealKey = hex;
        const same = hex === firstRealKey;
        if (same) {
          console.log(`[${timeStr}] +${elapsedStr} ✅ ${hex} (unchanged)`);
          results.push({ time: timeStr, elapsed: elapsedStr, hex, status: 'same' });
        } else {
          console.log(`[${timeStr}] +${elapsedStr} 🔄 ${hex} (ROTATED!)`);
          results.push({ time: timeStr, elapsed: elapsedStr, hex, status: 'rotated' });
          rotationDetected = true;
        }
      }

      if (i < iterations - 1) {
        await new Promise(r => setTimeout(r, INTERVAL_MS));
      }
    }

    // Summary
    console.log('\n════════════════════════════════════════');
    console.log('  SUMMARY');
    console.log('════════════════════════════════════════\n');

    const realResults = results.filter(r => r.status === 'same' || r.status === 'rotated');
    const fakeResults = results.filter(r => r.status === 'fake');
    const rotations = results.filter(r => r.status === 'rotated');
    const uniqueRealKeys = new Set(realResults.map(r => r.hex));

    console.log(`Total polls:       ${results.length}`);
    console.log(`Real keys:         ${realResults.length}`);
    console.log(`Fake keys:         ${fakeResults.length} (whitelist expired)`);
    console.log(`Unique real keys:  ${uniqueRealKeys.size}`);
    console.log(`Rotations:         ${rotations.length}`);

    if (fakeResults.length > 0 && realResults.length > 0) {
      const firstFake = results.findIndex(r => r.status === 'fake');
      if (firstFake > 0) {
        console.log(`\nWhitelist lasted until poll #${firstFake} (${results[firstFake].elapsed})`);
      }
    }

    if (rotationDetected) {
      const firstRotation = results.findIndex(r => r.status === 'rotated');
      console.log(`\nKey first rotated at poll #${firstRotation} (${results[firstRotation].elapsed})`);
      console.log('Keys rotate within the test window — caching TTL should be shorter.');
    } else if (uniqueRealKeys.size === 1) {
      console.log(`\n🎯 Key stayed the same for the entire ${Math.floor(DURATION_MS / 60000)} minutes!`);
      console.log('Cache TTL can be generous — keys outlast the whitelist window.');
    }
  }, 400000); // 6.5 min timeout
});
