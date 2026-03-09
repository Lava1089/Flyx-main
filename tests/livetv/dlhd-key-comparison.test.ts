/**
 * DLHD Key Comparison Test — WITH WHITELIST
 *
 * 1. Solve reCAPTCHA v3 (HTTP-only, no browser) for 5 channels
 * 2. POST to chevy.soyspace.cyou/verify to whitelist our IP per channel
 * 3. Fetch AES-128 keys from all 5 channels
 * 4. Compare: are the real keys the same across channels?
 *
 * If yes → one cached key serves everything, 13-client limit is irrelevant.
 */

import { describe, test, expect } from 'bun:test';
import { createHmac, createHash } from 'crypto';

const PLAYER_DOMAIN = 'www.ksohls.ru';
const CDN_DOMAIN = 'soyspace.cyou';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const RECAPTCHA_SITE_KEY = '6LfJv4AsAAAAALTLEHKaQ7LN_VYfFqhLPrB2Tvgj';

const HMAC_SECRET = '444c44cc8888888844444444';
const POW_THRESHOLD = 0x1000;
const MAX_NONCE_ITERATIONS = 100000;

const FAKE_KEYS = new Set([
  '45db13cfa0ed393fdb7da4dfe9b5ac81',
  '455806f8bc592fdacb6ed5e071a517b1',
  '4542956ed8680eaccb615f7faad4da8f',
]);

// ─── reCAPTCHA v3 HTTP-only solver (port of rust-fetch logic) ───

async function getRecaptchaVersion(): Promise<string> {
  const jsUrl = 'https://www.google.com/recaptcha/api.js?render=explicit';
  const resp = await fetch(jsUrl, {
    headers: { 'Referer': `https://${PLAYER_DOMAIN}/` },
  });
  const body = await resp.text();

  // Look for releases/VERSION pattern
  const idx = body.indexOf('releases/');
  if (idx !== -1) {
    const rest = body.substring(idx + 9);
    const end = rest.search(/[/"']/);
    if (end > 0) return rest.substring(0, end);
  }
  throw new Error('Could not extract reCAPTCHA version from api.js');
}

async function solveRecaptchaV3(pageUrl: string, action: string): Promise<string> {
  const version = await getRecaptchaVersion();
  console.log(`  [recaptcha] version=${version}`);

  // Build co param: base64 of origin with port
  const origin = new URL(pageUrl).origin;
  const originWithPort = origin.includes(':443') ? origin : `${origin}:443`;
  const co = Buffer.from(originWithPort).toString('base64').replace(/=+$/, '') + '.';
  console.log(`  [recaptcha] co=${co}`);

  const cb = `cb_${Date.now()}`;

  // GET anchor page
  const anchorUrl = `https://www.google.com/recaptcha/api2/anchor?ar=1&k=${RECAPTCHA_SITE_KEY}&co=${co}&hl=en&v=${version}&size=invisible&cb=${cb}`;
  const anchorResp = await fetch(anchorUrl, {
    headers: {
      'User-Agent': USER_AGENT,
      'Referer': pageUrl,
    },
  });
  const anchorHtml = await anchorResp.text();
  console.log(`  [recaptcha] anchor HTML: ${anchorHtml.length} bytes`);

  // Extract recaptcha-token from anchor HTML
  const tokenMatch = anchorHtml.match(/id="recaptcha-token"\s+value="([^"]+)"/);
  if (!tokenMatch) throw new Error('Could not find recaptcha-token in anchor page');
  const anchorToken = tokenMatch[1];
  console.log(`  [recaptcha] anchor token: ${anchorToken.substring(0, 20)}...`);

  // POST reload
  const reloadUrl = `https://www.google.com/recaptcha/api2/reload?k=${RECAPTCHA_SITE_KEY}`;
  const formData = new URLSearchParams([
    ['v', version],
    ['reason', 'q'],
    ['k', RECAPTCHA_SITE_KEY],
    ['c', anchorToken],
    ['sa', action],
    ['co', co],
  ]);

  const reloadResp = await fetch(reloadUrl, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      'Referer': `https://www.google.com/recaptcha/api2/anchor?k=${RECAPTCHA_SITE_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formData.toString(),
  });
  const reloadBody = await reloadResp.text();
  console.log(`  [recaptcha] reload response: ${reloadBody.length} bytes`);

  // Parse rresp token: look for ["rresp","TOKEN"
  const rrespMatch = reloadBody.match(/\["rresp","([^"]+)"/);
  if (!rrespMatch) throw new Error('Could not parse rresp from reload response');

  console.log(`  [recaptcha] ✅ got token (${rrespMatch[1].length}b)`);
  return rrespMatch[1];
}

// ─── Whitelist via chevy.soyspace.cyou/verify ───

async function whitelistChannel(channel: string): Promise<{ success: boolean; body: string }> {
  const channelNum = channel.replace('premium', '');
  const pageUrl = `https://${PLAYER_DOMAIN}/premiumtv/daddyhd.php?id=${channelNum}`;

  console.log(`\n[whitelist] Solving reCAPTCHA for ${channel}...`);
  const token = await solveRecaptchaV3(pageUrl, 'player_access');

  console.log(`[whitelist] POSTing to verify for ${channel}...`);
  const resp = await fetch('https://chevy.soyspace.cyou/verify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': `https://${PLAYER_DOMAIN}`,
      'Referer': `https://${PLAYER_DOMAIN}/`,
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({
      'recaptcha-token': token,
      'channel_id': channel,
    }),
  });

  const body = await resp.text();
  console.log(`[whitelist] ${channel}: ${resp.status} → ${body.substring(0, 200)}`);

  let success = false;
  try {
    const json = JSON.parse(body);
    success = json.success === true;
  } catch {}

  return { success, body };
}

// ─── PoW + Key fetch ───

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

async function fetchKey(channelKey: string, keyNumber: string = '1'): Promise<{ hex: string; size: number; isFake: boolean } | null> {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = computePoWNonce(channelKey, keyNumber, timestamp);
  if (nonce === null) return null;

  const jwt = generateKeyJWT(channelKey, keyNumber, timestamp, nonce);

  const keyServers = [
    `https://chevy.${CDN_DOMAIN}/key/${channelKey}/${keyNumber}`,
    `https://go.ai-chatx.site/key/${channelKey}/${keyNumber}`,
    `https://chevy.vovlacosa.sbs/key/${channelKey}/${keyNumber}`,
  ];

  for (const keyUrl of keyServers) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const resp = await fetch(keyUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          'Referer': `https://${PLAYER_DOMAIN}/`,
          'Origin': `https://${PLAYER_DOMAIN}`,
          'Authorization': `Bearer ${jwt}`,
          'X-Key-Timestamp': timestamp.toString(),
          'X-Key-Nonce': nonce.toString(),
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!resp.ok) continue;
      const buf = await resp.arrayBuffer();
      const hex = Buffer.from(buf).toString('hex');
      return { hex, size: buf.byteLength, isFake: FAKE_KEYS.has(hex) };
    } catch { continue; }
  }
  return null;
}

// ─── THE TEST ───

describe('DLHD Whitelist → Key Comparison', () => {

  const TEST_CHANNELS = ['premium44', 'premium51', 'premium52', 'premium53', 'premium54'];

  test('whitelist 5 channels, then compare their real keys', async () => {
    console.log('\n════════════════════════════════════════');
    console.log('  PHASE 1: WHITELIST 5 CHANNELS');
    console.log('════════════════════════════════════════');

    const whitelistResults: Map<string, boolean> = new Map();

    for (const ch of TEST_CHANNELS) {
      let retries = 3;
      while (retries > 0) {
        try {
          const result = await whitelistChannel(ch);
          whitelistResults.set(ch, result.success);

          if (!result.success && result.body.includes('channel_limit_exceeded')) {
            // Parse wait time from response
            const waitMatch = result.body.match(/opens in (\d+)s/);
            const waitSec = waitMatch ? parseInt(waitMatch[1]) + 3 : 20;
            console.log(`[whitelist] ${ch}: Slot full — waiting ${waitSec}s for slot to open...`);
            await new Promise(r => setTimeout(r, waitSec * 1000));
            retries--;
            continue;
          }
          break; // success or non-retryable error
        } catch (err) {
          console.log(`[whitelist] ${ch}: ❌ ERROR: ${(err as Error).message}`);
          whitelistResults.set(ch, false);
          break;
        }
      }
      // Small delay between channels
      await new Promise(r => setTimeout(r, 1500));
    }

    const whitelisted = [...whitelistResults.entries()].filter(([, ok]) => ok).map(([ch]) => ch);
    const failed = [...whitelistResults.entries()].filter(([, ok]) => !ok).map(([ch]) => ch);

    console.log(`\nWhitelisted: ${whitelisted.length} — [${whitelisted.join(', ')}]`);
    console.log(`Failed:      ${failed.length} — [${failed.join(', ')}]`);

    console.log('\n════════════════════════════════════════');
    console.log('  PHASE 2: FETCH KEYS FROM ALL CHANNELS');
    console.log('════════════════════════════════════════\n');

    // Wait a moment for whitelist to propagate
    await new Promise(r => setTimeout(r, 2000));

    const keys: Map<string, { hex: string; isFake: boolean }> = new Map();

    for (const ch of TEST_CHANNELS) {
      console.log(`[key] Fetching key for ${ch}...`);
      const result = await fetchKey(ch);
      if (result) {
        keys.set(ch, { hex: result.hex, isFake: result.isFake });
        const status = result.isFake ? '⚠️  FAKE' : '✅ REAL';
        console.log(`[key] ${ch}: ${status} | ${result.hex}`);
      } else {
        console.log(`[key] ${ch}: ❌ FAILED`);
      }
      await new Promise(r => setTimeout(r, 500));
    }

    console.log('\n════════════════════════════════════════');
    console.log('  PHASE 3: ANALYSIS');
    console.log('════════════════════════════════════════\n');

    const realKeys = new Map<string, string[]>();
    const fakeKeys = new Map<string, string[]>();

    for (const [ch, k] of keys) {
      const target = k.isFake ? fakeKeys : realKeys;
      const list = target.get(k.hex) || [];
      list.push(ch);
      target.set(k.hex, list);
    }

    console.log(`Total fetched:     ${keys.size}/${TEST_CHANNELS.length}`);
    console.log(`Real keys:         ${[...realKeys.values()].flat().length}`);
    console.log(`Fake keys:         ${[...fakeKeys.values()].flat().length}`);
    console.log(`Unique real keys:  ${realKeys.size}`);

    console.log('\nReal key breakdown:');
    for (const [hex, channels] of realKeys) {
      console.log(`  ${hex} → [${channels.join(', ')}]`);
    }

    if (fakeKeys.size > 0) {
      console.log('\nFake key breakdown:');
      for (const [hex, channels] of fakeKeys) {
        console.log(`  ${hex} → [${channels.join(', ')}]`);
      }
    }

    // THE VERDICT
    console.log('\n════════════════════════════════════════');
    const realCount = [...realKeys.values()].flat().length;

    if (realKeys.size === 1 && realCount > 1) {
      console.log('  🎯 ALL REAL KEYS ARE IDENTICAL!');
      console.log('  → One key serves all channels.');
      console.log('  → 13-client limit is COMPLETELY BYPASSED.');
    } else if (realKeys.size > 1) {
      console.log('  ❌ KEYS DIFFER ACROSS CHANNELS.');
      console.log(`  → ${realKeys.size} unique keys for ${realCount} channels.`);
      console.log('  → Each channel needs its own key fetch.');
    } else if (realCount === 1) {
      console.log('  🔶 Only got 1 real key — need more to compare.');
    } else {
      console.log('  ⚠️  NO REAL KEYS — whitelist may have failed.');
    }
    console.log('════════════════════════════════════════\n');

    // We should have gotten at least some keys
    expect(keys.size).toBeGreaterThan(0);
  }, 600000); // 10 minute timeout — may need to wait for whitelist slots
});
