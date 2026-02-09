// Test key extraction across multiple channels to confirm pipeline works
const crypto = require('crypto');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function md5(str) { return crypto.createHash('md5').update(str).digest('hex'); }
function hmacSha256(data, key) { return crypto.createHmac('sha256', key).update(data).digest('hex'); }
function sha256(str) { return crypto.createHash('sha256').update(str).digest('hex'); }
function generateFingerprint() { return sha256(UA + '1920x1080' + 'America/New_York' + 'en-US').substring(0, 16); }

function computePowNonce(channelKey, keyNumber, timestamp, channelSalt) {
  const hmacPrefix = hmacSha256(channelKey, channelSalt);
  for (let nonce = 0; nonce < 100000; nonce++) {
    const data = hmacPrefix + channelKey + keyNumber + timestamp + nonce;
    const hash = md5(data);
    if (parseInt(hash.substring(0, 4), 16) < 0x1000) return nonce;
  }
  return 99999;
}

function computeKeyPath(resource, keyNumber, timestamp, fingerprint, channelSalt) {
  return hmacSha256(`${resource}|${keyNumber}|${timestamp}|${fingerprint}`, channelSalt).substring(0, 16);
}

async function testChannel(channelId) {
  const start = Date.now();
  const result = { channelId, success: false, error: null, timeMs: 0, keyHex: null };
  
  try {
    // 1. Auth
    const controller1 = new AbortController();
    setTimeout(() => controller1.abort(), 8000);
    const authRes = await fetch(`https://epaly.fun/premiumtv/daddyhd.php?id=${channelId}`, {
      headers: { 'User-Agent': UA, 'Referer': 'https://dlhd.link/' },
      signal: controller1.signal,
    });
    const html = await authRes.text();
    const initMatch = html.match(/EPlayerAuth\.init\s*\(\s*\{([^}]+)\}\s*\)/);
    if (!initMatch) { result.error = 'No EPlayerAuth'; return result; }
    
    const s = initMatch[1];
    const authToken = s.match(/authToken\s*:\s*["']([^"']+)["']/)?.[1];
    const channelSalt = s.match(/channelSalt\s*:\s*["']([^"']+)["']/)?.[1];
    const channelKey = s.match(/channelKey\s*:\s*["']([^"']+)["']/)?.[1] || `premium${channelId}`;
    if (!authToken || !channelSalt) { result.error = 'Missing auth/salt'; return result; }

    // 2. Server lookup
    const controller2 = new AbortController();
    setTimeout(() => controller2.abort(), 5000);
    let serverKey = 'zeko';
    try {
      const lookupRes = await fetch(`https://chevy.dvalna.ru/server_lookup?channel_id=${channelKey}`, {
        headers: { 'User-Agent': UA, 'Referer': 'https://epaly.fun/' },
        signal: controller2.signal,
      });
      const lookupData = await lookupRes.json();
      if (lookupData.server_key) serverKey = lookupData.server_key;
    } catch {}

    // 3. M3U8
    const m3u8Url = `https://${serverKey}new.dvalna.ru/${serverKey}/${channelKey}/mono.css`;
    const controller3 = new AbortController();
    setTimeout(() => controller3.abort(), 5000);
    const m3u8Res = await fetch(m3u8Url, {
      headers: { 'User-Agent': UA, 'Referer': 'https://epaly.fun/', 'Origin': 'https://epaly.fun' },
      signal: controller3.signal,
    });
    const m3u8Text = await m3u8Res.text();
    if (!m3u8Text.includes('#EXTM3U')) { result.error = `M3U8 invalid (${serverKey})`; return result; }
    
    const keyMatch = m3u8Text.match(/URI="([^"]+)"/);
    if (!keyMatch) { result.error = 'No key URL'; return result; }
    
    const keyParams = keyMatch[1].match(/\/key\/([^/]+)\/(\d+)/);
    if (!keyParams) { result.error = 'Bad key URL'; return result; }

    // 4. PoW + Key fetch
    const resource = keyParams[1];
    const keyNumber = keyParams[2];
    const timestamp = Math.floor(Date.now() / 1000);
    const fingerprint = generateFingerprint();
    const nonce = computePowNonce(resource, keyNumber, timestamp, channelSalt);
    const keyPath = computeKeyPath(resource, keyNumber, timestamp, fingerprint, channelSalt);

    const controller4 = new AbortController();
    setTimeout(() => controller4.abort(), 8000);
    const keyRes = await fetch(`https://chevy.dvalna.ru/key/${resource}/${keyNumber}`, {
      headers: {
        'User-Agent': UA, 'Accept': '*/*',
        'Origin': 'https://epaly.fun', 'Referer': 'https://epaly.fun/',
        'Authorization': `Bearer ${authToken}`,
        'X-Key-Timestamp': timestamp.toString(),
        'X-Key-Nonce': nonce.toString(),
        'X-Key-Path': keyPath,
        'X-Fingerprint': fingerprint,
      },
      signal: controller4.signal,
    });
    
    const buf = await keyRes.arrayBuffer();
    if (buf.byteLength === 16) {
      const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
      const isFake = hex.startsWith('455806f8') || hex.startsWith('45c6497');
      result.keyHex = hex;
      result.success = !isFake;
      if (isFake) result.error = 'FAKE KEY';
    } else {
      const text = new TextDecoder().decode(buf);
      result.error = `Bad key size: ${buf.byteLength}b (${text.substring(0, 50)})`;
    }
  } catch (e) {
    result.error = e.message || e.name;
  }
  
  result.timeMs = Date.now() - start;
  return result;
}

async function main() {
  const channels = ['31', '35', '38', '44', '45', '51', '60', '65', '130', '338'];
  console.log('=== DLHD Multi-Channel Key Test ===');
  console.log('Time:', new Date().toISOString());
  console.log(`Testing ${channels.length} channels...\n`);

  let success = 0, fail = 0;
  
  // Test sequentially to avoid rate limiting
  for (const ch of channels) {
    const r = await testChannel(ch);
    if (r.success) {
      success++;
      console.log(`✅ ch${ch.padStart(3)}: ${r.keyHex} (${r.timeMs}ms)`);
    } else {
      fail++;
      console.log(`❌ ch${ch.padStart(3)}: ${r.error} (${r.timeMs}ms)`);
    }
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  console.log(`\nResults: ${success}/${channels.length} success, ${fail} failed`);
}

main().catch(console.error);
