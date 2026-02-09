#!/usr/bin/env node
/**
 * End-to-end test of the DEPLOYED DLHD CF worker.
 * Simulates what a real user's browser does:
 * 1. Hit /play/:channelId on the CF worker
 * 2. Parse the returned M3U8
 * 3. Fetch the key via the proxied /dlhdprivate URL
 * 4. Fetch a segment via the proxied URL
 * 5. Decrypt the segment and verify TS sync byte (0x47)
 */
const crypto = require('crypto');

const WORKER_URL = 'https://dlhd.vynx.workers.dev';
const API_KEY = 'vynx';
const CHANNELS = [40, 31, 43, 130, 1];
const DELAY_BETWEEN = 3000; // 3s between channels to avoid upstream rate limits

async function testChannel(channelId) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`CHANNEL ${channelId}`);
  console.log('='.repeat(60));

  // Step 1: Hit /play endpoint
  console.log(`\n[1] Fetching /play/${channelId}...`);
  const t0 = Date.now();
  const playRes = await fetch(`${WORKER_URL}/play/${channelId}?key=${API_KEY}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Origin': 'https://flyx.lol',
      'Referer': 'https://flyx.lol/',
    },
  });
  const elapsed1 = Date.now() - t0;

  if (!playRes.ok) {
    const errText = await playRes.text();
    console.log(`   ❌ HTTP ${playRes.status} (${elapsed1}ms)`);
    console.log(`   Body: ${errText.substring(0, 300)}`);
    return { channel: channelId, status: 'FAIL', reason: `play HTTP ${playRes.status}` };
  }

  const contentType = playRes.headers.get('content-type') || '';
  const body = await playRes.text();
  console.log(`   ✅ HTTP ${playRes.status} (${elapsed1}ms), Content-Type: ${contentType}`);
  console.log(`   Body length: ${body.length}`);

  // Check if it's JSON (error) or M3U8
  if (contentType.includes('json')) {
    try {
      const json = JSON.parse(body);
      if (json.m3u8Url || json.streamUrl) {
        console.log(`   Got JSON with stream URL`);
        // Some responses return JSON with the M3U8 URL
      } else {
        console.log(`   ❌ JSON error: ${JSON.stringify(json).substring(0, 200)}`);
        return { channel: channelId, status: 'FAIL', reason: 'JSON error response' };
      }
    } catch {}
  }

  // Check if body is M3U8
  if (!body.includes('#EXTM3U') && !body.includes('#EXT-X-')) {
    console.log(`   ❌ Not an M3U8 response`);
    console.log(`   First 300 chars: ${body.substring(0, 300)}`);
    return { channel: channelId, status: 'FAIL', reason: 'Not M3U8' };
  }

  console.log(`   M3U8 lines: ${body.split('\n').length}`);

  // Step 2: Parse M3U8 for key URL and segment URL
  const lines = body.split('\n');
  let keyUrl = null;
  let keyIV = null;
  let segmentUrl = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#EXT-X-KEY') && trimmed.includes('URI="')) {
      const uriMatch = trimmed.match(/URI="([^"]+)"/);
      const ivMatch = trimmed.match(/IV=0x([0-9a-fA-F]+)/);
      if (uriMatch) keyUrl = uriMatch[1];
      if (ivMatch) keyIV = ivMatch[1];
    }
    if (!trimmed.startsWith('#') && trimmed.length > 5 && (trimmed.startsWith('http') || trimmed.includes('/dlhdprivate'))) {
      segmentUrl = trimmed;
    }
  }

  if (!keyUrl) {
    console.log(`   ❌ No key URL found in M3U8`);
    return { channel: channelId, status: 'FAIL', reason: 'No key URL in M3U8' };
  }

  console.log(`\n[2] Key URL: ${keyUrl.substring(0, 100)}...`);
  if (keyIV) console.log(`   IV: ${keyIV}`);

  // Step 3: Fetch the key
  console.log(`\n[3] Fetching key...`);
  const t1 = Date.now();
  const keyRes = await fetch(keyUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Origin': 'https://flyx.lol',
      'Referer': 'https://flyx.lol/',
    },
  });
  const elapsed2 = Date.now() - t1;
  const keyBuf = Buffer.from(await keyRes.arrayBuffer());
  const keyHex = keyBuf.toString('hex');
  const fetchedBy = keyRes.headers.get('x-fetched-by') || 'unknown';

  console.log(`   Status: ${keyRes.status} (${elapsed2}ms)`);
  console.log(`   Key size: ${keyBuf.length} bytes`);
  console.log(`   Key hex: ${keyHex}`);
  console.log(`   Fetched by: ${fetchedBy}`);

  if (keyBuf.length !== 16) {
    console.log(`   ❌ Invalid key size (expected 16)`);
    const text = keyBuf.toString('utf8').substring(0, 200);
    console.log(`   Text: ${text}`);
    return { channel: channelId, status: 'FAIL', reason: `Key size ${keyBuf.length}` };
  }

  // Check for known fake keys
  const fakeKeys = ['45c6497365ca4c64c83460adca4e65ee', '455806f8', '6572726f7220636f64653a2031303135', '00000000000000000000000000000000'];
  if (fakeKeys.some(fk => keyHex.startsWith(fk))) {
    console.log(`   ❌ FAKE KEY detected!`);
    return { channel: channelId, status: 'FAIL', reason: 'Fake key' };
  }
  console.log(`   ✅ Real key!`);

  // Step 4: Fetch a segment
  if (!segmentUrl) {
    console.log(`\n[4] No segment URL found in M3U8 (might be live with no segments yet)`);
    return { channel: channelId, status: 'PASS-NO-SEGMENT', reason: 'Key OK but no segment URL' };
  }

  console.log(`\n[4] Fetching segment: ${segmentUrl.substring(0, 100)}...`);
  const t2 = Date.now();
  const segRes = await fetch(segmentUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Origin': 'https://flyx.lol',
      'Referer': 'https://flyx.lol/',
    },
  });
  const elapsed3 = Date.now() - t2;
  const segBuf = Buffer.from(await segRes.arrayBuffer());

  console.log(`   Status: ${segRes.status} (${elapsed3}ms)`);
  console.log(`   Segment size: ${segBuf.length} bytes`);

  if (!segRes.ok || segBuf.length < 188) {
    console.log(`   ❌ Segment fetch failed or too small`);
    return { channel: channelId, status: 'PARTIAL', reason: 'Key OK, segment fetch failed' };
  }

  // Step 5: Decrypt segment
  console.log(`\n[5] Decrypting segment...`);
  try {
    let ivBuf;
    if (keyIV) {
      ivBuf = Buffer.from(keyIV.padStart(32, '0'), 'hex');
    } else {
      ivBuf = Buffer.alloc(16, 0); // Default IV
    }

    const decipher = crypto.createDecipheriv('aes-128-cbc', keyBuf, ivBuf);
    const decrypted = Buffer.concat([decipher.update(segBuf), decipher.final()]);

    console.log(`   Decrypted size: ${decrypted.length} bytes`);
    console.log(`   First 4 bytes: ${decrypted.slice(0, 4).toString('hex')}`);

    // Check for TS sync byte (0x47)
    if (decrypted[0] === 0x47) {
      console.log(`   ✅ TS sync byte 0x47 confirmed! Valid MPEG-TS stream!`);
      return { channel: channelId, status: 'PASS', reason: 'Full pipeline OK' };
    } else {
      console.log(`   ⚠️ First byte is 0x${decrypted[0].toString(16)}, not 0x47`);
      // Check if TS sync appears within first 376 bytes (2 packets)
      for (let i = 1; i < Math.min(376, decrypted.length); i++) {
        if (decrypted[i] === 0x47 && i + 188 < decrypted.length && decrypted[i + 188] === 0x47) {
          console.log(`   ✅ TS sync found at offset ${i} (valid stream with header)`);
          return { channel: channelId, status: 'PASS', reason: `TS sync at offset ${i}` };
        }
      }
      console.log(`   ⚠️ No TS sync found — key might be wrong or stream format different`);
      return { channel: channelId, status: 'PARTIAL', reason: 'Decrypted but no TS sync' };
    }
  } catch (e) {
    console.log(`   ❌ Decrypt error: ${e.message}`);
    return { channel: channelId, status: 'FAIL', reason: `Decrypt error: ${e.message}` };
  }
}

async function main() {
  console.log('DLHD End-to-End Test — Deployed CF Worker');
  console.log(`Worker: ${WORKER_URL}`);
  console.log(`Channels: ${CHANNELS.join(', ')}`);
  console.log(`Delay between channels: ${DELAY_BETWEEN}ms`);

  const results = [];

  for (let i = 0; i < CHANNELS.length; i++) {
    if (i > 0) {
      console.log(`\n⏳ Waiting ${DELAY_BETWEEN}ms before next channel...`);
      await new Promise(r => setTimeout(r, DELAY_BETWEEN));
    }
    const result = await testChannel(CHANNELS[i]);
    results.push(result);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('SUMMARY');
  console.log('='.repeat(60));
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✅' : r.status.startsWith('PASS') ? '🟡' : r.status === 'PARTIAL' ? '🟡' : '❌';
    console.log(`  ${icon} Channel ${r.channel}: ${r.status} — ${r.reason}`);
  }

  const passed = results.filter(r => r.status.startsWith('PASS')).length;
  console.log(`\n${passed}/${results.length} channels passed`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
