#!/usr/bin/env node
/**
 * Validate that the REAL key decrypts a DLHD TS segment.
 * Checks for 0x47 sync byte (MPEG-TS packet header).
 */

const https = require('https');
const crypto = require('crypto');

const REAL_KEY_HEX = '99a0ac133c9dcfbc6d6525882f841f05';

// Fetch a segment from the M3U8 to test decryption
async function fetchUrl(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.get({
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...headers,
      },
      timeout: 15000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ buf: Buffer.concat(chunks), status: res.statusCode, headers: res.headers }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function main() {
  console.log('DLHD Key Decryption Validation');
  console.log('==============================\n');

  // 1. Get M3U8 playlist
  const m3u8Url = 'https://chevy.soyspace.cyou/proxy/zeko/premium44/mono.css';
  console.log(`Fetching M3U8: ${m3u8Url}`);
  
  const m3u8Resp = await fetchUrl(m3u8Url, {
    Referer: 'https://adffdafdsafds.sbs/',
    Origin: 'https://adffdafdsafds.sbs',
  });
  
  const m3u8Text = m3u8Resp.buf.toString('utf8');
  console.log(`M3U8 status: ${m3u8Resp.status}, size: ${m3u8Text.length}`);
  
  if (!m3u8Text.includes('#EXTM3U')) {
    console.log('❌ Not a valid M3U8');
    console.log(m3u8Text.substring(0, 500));
    return;
  }

  // 2. Parse key URI and IV from M3U8
  const keyMatch = m3u8Text.match(/#EXT-X-KEY:METHOD=AES-128,(?:IV=0x([0-9a-fA-F]+),)?URI="([^"]+)"(?:,IV=0x([0-9a-fA-F]+))?/);
  if (!keyMatch) {
    console.log('❌ No AES-128 key found in M3U8');
    console.log(m3u8Text.substring(0, 1000));
    return;
  }
  
  const keyUri = keyMatch[2];
  const ivHex = keyMatch[1] || keyMatch[3];
  console.log(`Key URI: ${keyUri}`);
  console.log(`IV: ${ivHex || 'none (use sequence number)'}`);

  // Make key URI absolute
  let absoluteKeyUri = keyUri;
  if (!keyUri.startsWith('http')) {
    // Relative to the M3U8 host
    const m3u8UrlObj = new URL(m3u8Url);
    absoluteKeyUri = `${m3u8UrlObj.origin}${keyUri}`;
  }
  console.log(`Absolute key URI: ${absoluteKeyUri}`);

  // Fetch the key from the REAL server (go.ai-chatx.site since soyspace returns fake)
  const keyPath = new URL(absoluteKeyUri).pathname;
  const realKeyUrl = `https://go.ai-chatx.site${keyPath}`;
  console.log(`\nFetching REAL key from: ${realKeyUrl}`);
  
  const keyResp = await fetchUrl(realKeyUrl, {
    Referer: 'https://adffdafdsafds.sbs/',
    Origin: 'https://adffdafdsafds.sbs',
  });
  
  if (keyResp.buf.length !== 16) {
    console.log(`❌ Key is ${keyResp.buf.length} bytes, expected 16`);
    console.log(`Text: ${keyResp.buf.toString('utf8').substring(0, 200)}`);
    return;
  }
  
  const fetchedKeyHex = keyResp.buf.toString('hex');
  console.log(`Fetched key: ${fetchedKeyHex}`);
  
  if (fetchedKeyHex === '45db13cfa0ed393fdb7da4dfe9b5ac81') {
    console.log(`❌ Still getting FAKE key — whitelist may have expired`);
    console.log(`Using hardcoded real key instead...`);
  }
  const lines = m3u8Text.split('\n');
  let segmentUrl = null;
  let segmentSeq = 0;
  
  const seqMatch = m3u8Text.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/);
  if (seqMatch) segmentSeq = parseInt(seqMatch[1]);
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      segmentUrl = trimmed;
      break;
    }
  }
  
  if (!segmentUrl) {
    console.log('❌ No segment URL found');
    return;
  }
  
  // Make segment URL absolute
  if (!segmentUrl.startsWith('http')) {
    const base = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);
    segmentUrl = base + segmentUrl;
  }
  
  console.log(`\nSegment: ${segmentUrl.substring(0, 100)}`);
  console.log(`Sequence: ${segmentSeq}`);

  // 4. Fetch segment
  console.log(`\nFetching segment...`);
  const segResp = await fetchUrl(segmentUrl, {
    Referer: 'https://adffdafdsafds.sbs/',
    Origin: 'https://adffdafdsafds.sbs',
  });
  
  console.log(`Segment: ${segResp.status}, ${segResp.buf.length} bytes`);
  
  if (segResp.buf.length < 16) {
    console.log('❌ Segment too small');
    return;
  }

  // 5. Decrypt with the fetched key (or fallback to hardcoded)
  const key = (fetchedKeyHex !== '45db13cfa0ed393fdb7da4dfe9b5ac81') 
    ? keyResp.buf 
    : Buffer.from(REAL_KEY_HEX, 'hex');
  let iv;
  if (ivHex) {
    iv = Buffer.from(ivHex, 'hex');
  } else {
    // IV = segment sequence number as 16-byte big-endian
    iv = Buffer.alloc(16, 0);
    iv.writeUInt32BE(segmentSeq, 12);
  }
  
  console.log(`\nDecrypting with key: ${key.toString('hex')}`);
  console.log(`IV: ${iv.toString('hex')}`);
  
  try {
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    const decrypted = Buffer.concat([decipher.update(segResp.buf), decipher.final()]);
    
    console.log(`Decrypted: ${decrypted.length} bytes`);
    console.log(`First 16 bytes: ${decrypted.slice(0, 16).toString('hex')}`);
    console.log(`First byte: 0x${decrypted[0].toString(16).padStart(2, '0')}`);
    
    if (decrypted[0] === 0x47) {
      console.log(`\n✅ SUCCESS! First byte is 0x47 (MPEG-TS sync byte)`);
      console.log(`The key ${REAL_KEY_HEX} correctly decrypts DLHD streams!`);
    } else {
      console.log(`\n❌ First byte is 0x${decrypted[0].toString(16)}, expected 0x47`);
      console.log(`Key may be wrong or segment format different`);
    }
  } catch (err) {
    console.log(`\n❌ Decryption error: ${err.message}`);
    
    // Also try with fake key to compare
    console.log(`\nTrying with FAKE key for comparison...`);
    try {
      const fakeKey = Buffer.from('45db13cfa0ed393fdb7da4dfe9b5ac81', 'hex');
      const decipher2 = crypto.createDecipheriv('aes-128-cbc', fakeKey, iv);
      const dec2 = Buffer.concat([decipher2.update(segResp.buf), decipher2.final()]);
      console.log(`Fake key decrypted: ${dec2.length} bytes, first byte: 0x${dec2[0].toString(16)}`);
    } catch (e2) {
      console.log(`Fake key also fails: ${e2.message}`);
    }
  }
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
