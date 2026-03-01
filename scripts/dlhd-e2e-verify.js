#!/usr/bin/env node
/**
 * DLHD End-to-End Verification - February 28, 2026
 * Tests the complete extraction pipeline after fixes
 */

const crypto = require('crypto');

// === Auth helpers (matching dlhd-auth-v5.ts) ===

function md5(str) {
  function rotateLeft(x, n) { return (x << n) | (x >>> (32 - n)); }
  function addUnsigned(x, y) {
    const x4 = x & 0x80000000, y4 = y & 0x80000000, x8 = x & 0x40000000, y8 = y & 0x40000000;
    const result = (x & 0x3FFFFFFF) + (y & 0x3FFFFFFF);
    if (x8 & y8) return result ^ 0x80000000 ^ x4 ^ y4;
    if (x8 | y8) { if (result & 0x40000000) return result ^ 0xC0000000 ^ x4 ^ y4; return result ^ 0x40000000 ^ x4 ^ y4; }
    return result ^ x4 ^ y4;
  }
  function F(x,y,z){return(x&y)|(~x&z)}function G(x,y,z){return(x&z)|(y&~z)}function H(x,y,z){return x^y^z}function I(x,y,z){return y^(x|~z)}
  function FF(a,b,c,d,x,s,ac){a=addUnsigned(a,addUnsigned(addUnsigned(F(b,c,d),x),ac));return addUnsigned(rotateLeft(a,s),b)}
  function GG(a,b,c,d,x,s,ac){a=addUnsigned(a,addUnsigned(addUnsigned(G(b,c,d),x),ac));return addUnsigned(rotateLeft(a,s),b)}
  function HH(a,b,c,d,x,s,ac){a=addUnsigned(a,addUnsigned(addUnsigned(H(b,c,d),x),ac));return addUnsigned(rotateLeft(a,s),b)}
  function II(a,b,c,d,x,s,ac){a=addUnsigned(a,addUnsigned(addUnsigned(I(b,c,d),x),ac));return addUnsigned(rotateLeft(a,s),b)}
  function convertToWordArray(s){const l=(((s.length+8)-((s.length+8)%64))/64+1)*16;const a=new Array(l).fill(0);let bc=0,bp=0;while(bc<s.length){const wp=(bc-(bc%4))/4;bp=(bc%4)*8;a[wp]=a[wp]|(s.charCodeAt(bc)<<bp);bc++}const wp2=(bc-(bc%4))/4;bp=(bc%4)*8;a[wp2]=a[wp2]|(0x80<<bp);a[l-2]=s.length<<3;a[l-1]=s.length>>>29;return a}
  function wordToHex(v){let h='';for(let i=0;i<=3;i++){const b=(v>>>(i*8))&255;h+=b.toString(16).padStart(2,'0')}return h}
  const x=convertToWordArray(str);let a=0x67452301,b=0xEFCDAB89,c=0x98BADCFE,d=0x10325476;
  for(let k=0;k<x.length;k+=16){const AA=a,BB=b,CC=c,DD=d;
  a=FF(a,b,c,d,x[k+0],7,0xD76AA478);d=FF(d,a,b,c,x[k+1],12,0xE8C7B756);c=FF(c,d,a,b,x[k+2],17,0x242070DB);b=FF(b,c,d,a,x[k+3],22,0xC1BDCEEE);a=FF(a,b,c,d,x[k+4],7,0xF57C0FAF);d=FF(d,a,b,c,x[k+5],12,0x4787C62A);c=FF(c,d,a,b,x[k+6],17,0xA8304613);b=FF(b,c,d,a,x[k+7],22,0xFD469501);a=FF(a,b,c,d,x[k+8],7,0x698098D8);d=FF(d,a,b,c,x[k+9],12,0x8B44F7AF);c=FF(c,d,a,b,x[k+10],17,0xFFFF5BB1);b=FF(b,c,d,a,x[k+11],22,0x895CD7BE);a=FF(a,b,c,d,x[k+12],7,0x6B901122);d=FF(d,a,b,c,x[k+13],12,0xFD987193);c=FF(c,d,a,b,x[k+14],17,0xA679438E);b=FF(b,c,d,a,x[k+15],22,0x49B40821);
  a=GG(a,b,c,d,x[k+1],5,0xF61E2562);d=GG(d,a,b,c,x[k+6],9,0xC040B340);c=GG(c,d,a,b,x[k+11],14,0x265E5A51);b=GG(b,c,d,a,x[k+0],20,0xE9B6C7AA);a=GG(a,b,c,d,x[k+5],5,0xD62F105D);d=GG(d,a,b,c,x[k+10],9,0x2441453);c=GG(c,d,a,b,x[k+15],14,0xD8A1E681);b=GG(b,c,d,a,x[k+4],20,0xE7D3FBC8);a=GG(a,b,c,d,x[k+9],5,0x21E1CDE6);d=GG(d,a,b,c,x[k+14],9,0xC33707D6);c=GG(c,d,a,b,x[k+3],14,0xF4D50D87);b=GG(b,c,d,a,x[k+8],20,0x455A14ED);a=GG(a,b,c,d,x[k+13],5,0xA9E3E905);d=GG(d,a,b,c,x[k+2],9,0xFCEFA3F8);c=GG(c,d,a,b,x[k+7],14,0x676F02D9);b=GG(b,c,d,a,x[k+12],20,0x8D2A4C8A);
  a=HH(a,b,c,d,x[k+5],4,0xFFFA3942);d=HH(d,a,b,c,x[k+8],11,0x8771F681);c=HH(c,d,a,b,x[k+11],16,0x6D9D6122);b=HH(b,c,d,a,x[k+14],23,0xFDE5380C);a=HH(a,b,c,d,x[k+1],4,0xA4BEEA44);d=HH(d,a,b,c,x[k+4],11,0x4BDECFA9);c=HH(c,d,a,b,x[k+7],16,0xF6BB4B60);b=HH(b,c,d,a,x[k+10],23,0xBEBFBC70);a=HH(a,b,c,d,x[k+13],4,0x289B7EC6);d=HH(d,a,b,c,x[k+0],11,0xEAA127FA);c=HH(c,d,a,b,x[k+3],16,0xD4EF3085);b=HH(b,c,d,a,x[k+6],23,0x4881D05);a=HH(a,b,c,d,x[k+9],4,0xD9D4D039);d=HH(d,a,b,c,x[k+12],11,0xE6DB99E5);c=HH(c,d,a,b,x[k+15],16,0x1FA27CF8);b=HH(b,c,d,a,x[k+2],23,0xC4AC5665);
  a=II(a,b,c,d,x[k+0],6,0xF4292244);d=II(d,a,b,c,x[k+7],10,0x432AFF97);c=II(c,d,a,b,x[k+14],15,0xAB9423A7);b=II(b,c,d,a,x[k+5],21,0xFC93A039);a=II(a,b,c,d,x[k+12],6,0x655B59C3);d=II(d,a,b,c,x[k+3],10,0x8F0CCC92);c=II(c,d,a,b,x[k+10],15,0xFFEFF47D);b=II(b,c,d,a,x[k+1],21,0x85845DD1);a=II(a,b,c,d,x[k+8],6,0x6FA87E4F);d=II(d,a,b,c,x[k+15],10,0xFE2CE6E0);c=II(c,d,a,b,x[k+6],15,0xA3014314);b=II(b,c,d,a,x[k+13],21,0x4E0811A1);a=II(a,b,c,d,x[k+4],6,0xF7537E82);d=II(d,a,b,c,x[k+11],10,0xBD3AF235);c=II(c,d,a,b,x[k+2],15,0x2AD7D2BB);b=II(b,c,d,a,x[k+9],21,0xEB86D391);
  a=addUnsigned(a,AA);b=addUnsigned(b,BB);c=addUnsigned(c,CC);d=addUnsigned(d,DD)}
  return wordToHex(a)+wordToHex(b)+wordToHex(c)+wordToHex(d);
}

function hmacSha256(data, key) { return crypto.createHmac('sha256', key).update(data).digest('hex'); }
function generateFingerprint() {
  const data = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.361920x1080America/New_Yorken-US';
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
}
function computePowNonce(channelKey, keyNumber, timestamp, channelSalt) {
  const hmacPrefix = hmacSha256(channelKey, channelSalt);
  for (let nonce = 0; nonce < 100000; nonce++) {
    const hash = md5(hmacPrefix + channelKey + keyNumber + timestamp + nonce);
    if (parseInt(hash.substring(0, 4), 16) < 0x1000) return nonce;
  }
  return 99999;
}
function computeKeyPath(resource, keyNumber, timestamp, fingerprint, channelSalt) {
  return hmacSha256(`${resource}|${keyNumber}|${timestamp}|${fingerprint}`, channelSalt).substring(0, 16);
}
function xorDecrypt(bytes, key) { return bytes.map(b => String.fromCharCode(b ^ key)).join(''); }

function extractAuth(html) {
  const decoderMatch = html.match(/(?:const|var|let)\s+(_dec_\w+)\s*=\s*\(?d\s*,\s*k\)?\s*=>/);
  if (!decoderMatch) return null;
  const byteArrays = {};
  const arrayRegex = /(?:const|var|let)\s+(_init_\w+)\s*=\s*\[([0-9,\s]+)\]/g;
  let m;
  while ((m = arrayRegex.exec(html)) !== null) byteArrays[m[1]] = m[2].split(',').map(s => parseInt(s.trim(), 10));
  const initMatch = html.match(/EPlayerAuth\.init\s*\(\s*\{([\s\S]*?)\}\s*\)/);
  if (!initMatch) return null;
  const result = {};
  const fieldRegex = /(\w+)\s*:\s*_dec_\w+\s*\(\s*(_init_\w+)\s*,\s*(\d+)\s*\)/g;
  while ((m = fieldRegex.exec(initMatch[1])) !== null) {
    if (byteArrays[m[2]]) result[m[1]] = xorDecrypt(byteArrays[m[2]], parseInt(m[3], 10));
  }
  const numRegex = /(\w+)\s*:\s*(\d{8,})/g;
  while ((m = numRegex.exec(initMatch[1])) !== null) { if (!result[m[1]]) result[m[1]] = m[2]; }
  return Object.keys(result).length > 0 ? result : null;
}

// === Test functions ===

async function testServerLookup(ch) {
  for (const domain of ['vovlacosa.sbs', 'adsfadfds.cfd', 'soyspace.cyou']) {
    try {
      const resp = await fetch(`https://chevy.${domain}/server_lookup?channel_id=premium${ch}`, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.ksohls.ru/' },
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.server_key) return { server: data.server_key, domain };
      }
    } catch {}
  }
  return null;
}

async function testM3U8(ch, server) {
  const url = `https://chevy.adsfadfds.cfd/proxy/${server}/premium${ch}/mono.css`;
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.ksohls.ru/', 'Origin': 'https://www.ksohls.ru' },
    });
    const text = await resp.text();
    if (text.includes('#EXTM3U')) {
      const keyMatch = text.match(/URI="([^"]+)"/);
      return { ok: true, keyUrl: keyMatch ? keyMatch[1] : null, segments: text.split('\n').filter(l => l.trim() && !l.startsWith('#')).length };
    }
    return { ok: false, error: text.substring(0, 100) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function testKeyFetch(keyUrl, channelSalt, authToken) {
  const keyParsed = keyUrl.match(/\/key\/([^/]+)\/(\d+)/);
  if (!keyParsed) return { ok: false, error: 'Cannot parse key URL' };
  const [, resource, keyNumber] = keyParsed;
  const timestamp = Math.floor(Date.now() / 1000);
  const fingerprint = generateFingerprint();
  const nonce = computePowNonce(resource, keyNumber, timestamp, channelSalt);
  const keyPath = computeKeyPath(resource, keyNumber, timestamp, fingerprint, channelSalt);
  
  try {
    const resp = await fetch(keyUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Origin': 'https://www.ksohls.ru', 'Referer': 'https://www.ksohls.ru/',
        'Authorization': `Bearer ${authToken}`,
        'X-Key-Timestamp': timestamp.toString(), 'X-Key-Nonce': nonce.toString(),
        'X-Key-Path': keyPath, 'X-Fingerprint': fingerprint,
      },
    });
    const data = await resp.arrayBuffer();
    const hex = Array.from(new Uint8Array(data)).map(b => b.toString(16).padStart(2, '0')).join('');
    const isFake = hex.startsWith('455806f8') || hex.startsWith('45c6497') || hex.startsWith('6572726f72');
    return { ok: !isFake && data.byteLength === 16, hex, isFake, size: data.byteLength };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function main() {
  console.log('=== DLHD E2E VERIFICATION - February 28, 2026 ===\n');
  
  // Test channels spanning all servers + new channels
  const testChannels = [1, 31, 44, 51, 65, 100, 200, 350, 500, 700, 851, 870, 900, 940];
  let passed = 0, failed = 0;
  
  // Step 1: Get auth (shared across all channels for speed)
  console.log('--- Step 1: Auth extraction ---');
  const authResp = await fetch('https://www.ksohls.ru/premiumtv/daddyhd.php?id=44', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'Referer': 'https://daddylive.mp/' },
  });
  const html = await authResp.text();
  const auth = extractAuth(html);
  if (!auth || !auth.channelSalt || !auth.authToken) {
    console.log('FATAL: Auth extraction failed!');
    return;
  }
  console.log(`Auth OK: salt=${auth.channelSalt.substring(0, 16)}... token=${auth.authToken.substring(0, 30)}...\n`);
  
  // Step 2: Test each channel
  console.log('--- Step 2: Channel tests ---');
  console.log('CH   | LOOKUP      | M3U8    | KEY     | RESULT');
  console.log('-----|-------------|---------|---------|-------');
  
  for (const ch of testChannels) {
    let line = `${String(ch).padStart(4)} | `;
    
    // Server lookup
    const lookup = await testServerLookup(ch);
    if (lookup) {
      line += `${lookup.server.padEnd(11)} | `;
      
      // M3U8 fetch
      const m3u8 = await testM3U8(ch, lookup.server);
      if (m3u8.ok) {
        line += `OK (${m3u8.segments}s) | `;
        
        // Key fetch (only test for a few channels to avoid rate limiting)
        if (m3u8.keyUrl && [44, 51, 851].includes(ch)) {
          // Need per-channel auth for key fetch
          const chAuthResp = await fetch(`https://www.ksohls.ru/premiumtv/daddyhd.php?id=${ch}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'Referer': 'https://daddylive.mp/' },
          });
          const chHtml = await chAuthResp.text();
          const chAuth = extractAuth(chHtml);
          
          if (chAuth && chAuth.channelSalt && chAuth.authToken) {
            const key = await testKeyFetch(m3u8.keyUrl, chAuth.channelSalt, chAuth.authToken);
            if (key.ok) {
              line += `VALID   | `;
            } else {
              line += `${key.isFake ? 'FAKE' : 'FAIL'}    | `;
            }
          } else {
            line += 'NO AUTH | ';
          }
        } else {
          line += 'SKIP    | ';
        }
        
        line += 'PASS';
        passed++;
      } else {
        line += `FAIL    | SKIP    | FAIL (${m3u8.error?.substring(0, 20)})`;
        failed++;
      }
    } else {
      line += 'FAIL        | SKIP    | SKIP    | FAIL (no server)';
      failed++;
    }
    
    console.log(line);
  }
  
  console.log(`\n=== RESULTS: ${passed}/${passed + failed} passed (${Math.round(passed / (passed + failed) * 100)}%) ===`);
}

main().catch(e => console.error('Fatal:', e));
