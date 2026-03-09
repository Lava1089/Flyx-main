#!/usr/bin/env node
/**
 * Decode DaddyLive embed - obfuscator.io uses RC4 + base64 for string encoding
 * The _0x4ef1 function decodes strings using: base64decode -> RC4(key) -> URI decode
 */

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'data', 'embed-44-raw.html'), 'utf8');

// Extract the raw string array
const arrayFuncMatch = html.match(/function _0x4360\(\)\{[^[]*?\[([\s\S]*?)\];/);
if (!arrayFuncMatch) { console.log('ERROR: no array'); process.exit(1); }

const rawArray = arrayFuncMatch[1];
const strings = [];
const strRegex = /'([^']*)'/g;
let m;
while ((m = strRegex.exec(rawArray)) !== null) strings.push(m[1]);
console.log(`${strings.length} raw strings`);

// Find the decoder function to get the RC4 key and offset
// obfuscator.io pattern: the decoder does base64 -> RC4 decrypt with a key
// The key is usually embedded in the decoder function

// Find the offset first
const offsetMatch = html.match(/_0x4ef1\s*=\s*function\s*\(\s*_0x\w+\s*,\s*_0x\w+\s*\)\s*\{[\s\S]*?-=\s*(0x[0-9a-f]+)/);
let offset = 0;
if (offsetMatch) {
  offset = parseInt(offsetMatch[1]);
  console.log(`Offset: ${offset} (0x${offset.toString(16)})`);
}

// RC4 implementation
function rc4(key, str) {
  const s = [];
  let j = 0;
  let res = '';
  for (let i = 0; i < 256; i++) s[i] = i;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key.charCodeAt(i % key.length)) % 256;
    [s[i], s[j]] = [s[j], s[i]];
  }
  let i = 0;
  j = 0;
  for (let k = 0; k < str.length; k++) {
    i = (i + 1) % 256;
    j = (j + s[i]) % 256;
    [s[i], s[j]] = [s[j], s[i]];
    res += String.fromCharCode(str.charCodeAt(k) ^ s[(s[i] + s[j]) % 256]);
  }
  return res;
}

// Custom base64 decode (standard alphabet)
function b64decode(str) {
  return Buffer.from(str, 'base64').toString('binary');
}

// The decoder function typically looks like:
// function _0x4ef1(_0xidx, _0xkey) {
//   var arr = _0x4360();
//   _0x4ef1 = function(_0xidx, _0xkey) {
//     _0xidx -= OFFSET;
//     var str = arr[_0xidx];
//     // RC4 decode with _0xkey
//     if (!_0x4ef1.initialized) { ... setup ... }
//     var cached = _0x4ef1.cache[_0xidx];
//     if (cached) return cached;
//     str = b64decode(str);
//     str = rc4(_0xkey, str);
//     str = decodeURIComponent(escape(str));
//     _0x4ef1.cache[_0xidx] = str;
//     return str;
//   }
// }

// Extract the actual decoder to find the key pattern
// Look for how _0x4ef1 is called in the code to find keys
const callPattern = /_0x\w+=_0x4ef1\((0x[0-9a-f]+)\)/g;
const calls = [];
while ((m = callPattern.exec(html)) !== null && calls.length < 5) {
  calls.push(parseInt(m[1]));
}
console.log(`Sample call indices: ${calls.join(', ')}`);

// The second argument to _0x4ef1 is the RC4 key for each call
// Let's find calls with both arguments
const call2Pattern = /_0x4ef1\((0x[0-9a-f]+)\s*,\s*'([^']*)'\)/g;
const callsWithKeys = [];
while ((m = call2Pattern.exec(html)) !== null && callsWithKeys.length < 20) {
  callsWithKeys.push({ idx: parseInt(m[1]), key: m[2] });
}

if (callsWithKeys.length === 0) {
  // Try alternate pattern with the lookup function name
  const alt = /_0x\w+\((0x[0-9a-f]+)\s*,\s*'([^']*)'\)/g;
  while ((m = alt.exec(html)) !== null && callsWithKeys.length < 20) {
    const idx = parseInt(m[1]);
    if (idx >= offset && idx < offset + strings.length) {
      callsWithKeys.push({ idx, key: m[2] });
    }
  }
}

console.log(`Found ${callsWithKeys.length} calls with RC4 keys`);

// Try decoding with the found keys
for (const { idx, key } of callsWithKeys.slice(0, 10)) {
  const arrIdx = idx - offset;
  if (arrIdx >= 0 && arrIdx < strings.length) {
    const raw = strings[arrIdx];
    try {
      const b64d = b64decode(raw);
      const decrypted = rc4(key, b64d);
      // Try URI decode
      let final;
      try { final = decodeURIComponent(escape(decrypted)); } catch { final = decrypted; }
      if (/^[\x20-\x7e\n\r\t]+$/.test(final)) {
        console.log(`  [0x${idx.toString(16)}] key="${key}" -> "${final}"`);
      }
    } catch (e) {
      // skip
    }
  }
}

// Now let's try to brute-force decode ALL strings with common keys
// First, find the most common RC4 keys used
const keyFreq = {};
const allCallPattern = /_0x\w+\((0x[0-9a-f]+)\s*,\s*'([^']*)'\)/g;
while ((m = allCallPattern.exec(html)) !== null) {
  const idx = parseInt(m[1]);
  if (idx >= offset && idx < offset + strings.length) {
    keyFreq[m[2]] = (keyFreq[m[2]] || 0) + 1;
  }
}

const topKeys = Object.entries(keyFreq).sort((a, b) => b[1] - a[1]).slice(0, 20);
console.log(`\nTop RC4 keys by frequency:`);
topKeys.forEach(([k, count]) => console.log(`  "${k}" used ${count} times`));

// Decode all strings with each key and look for domains/URLs
console.log('\n=== SEARCHING ALL DECODED STRINGS ===');
const interesting = [];
const allCallPattern2 = /_0x\w+\((0x[0-9a-f]+)\s*,\s*'([^']*)'\)/g;
while ((m = allCallPattern2.exec(html)) !== null) {
  const idx = parseInt(m[1]);
  const key = m[2];
  const arrIdx = idx - offset;
  if (arrIdx >= 0 && arrIdx < strings.length) {
    try {
      const b64d = b64decode(strings[arrIdx]);
      const decrypted = rc4(key, b64d);
      let final;
      try { final = decodeURIComponent(escape(decrypted)); } catch { final = decrypted; }
      if (/[\x20-\x7e]/.test(final)) {
        const lower = final.toLowerCase();
        if (lower.includes('.sbs') || lower.includes('.cfd') || lower.includes('.cyou') || 
            lower.includes('.site') || lower.includes('.xyz') || lower.includes('.ru') ||
            lower.includes('http') || lower.includes('premium') || lower.includes('daddyhd') ||
            lower.includes('auth') || lower.includes('token') || lower.includes('salt') ||
            lower.includes('eplayer') || lower.includes('mono.css') || lower.includes('proxy') ||
            lower.includes('server') || lower.includes('channel') || lower.includes('m3u8') ||
            lower.includes('hls') || lower.includes('key') || lower.includes('captcha') ||
            lower.includes('iframe') || lower.includes('player') || lower.includes('embed') ||
            lower.includes('init') || lower.includes('nonce') || lower.includes('fingerprint') ||
            lower.includes('hmac') || lower.includes('crypto') || lower.includes('recaptcha')) {
          interesting.push({ idx, key, decoded: final });
        }
      }
    } catch {}
  }
}

// Deduplicate and print
const seen = new Set();
interesting.forEach(({ idx, decoded }) => {
  if (!seen.has(decoded)) {
    seen.add(decoded);
    console.log(`  [0x${idx.toString(16)}] "${decoded}"`);
  }
});

console.log(`\nTotal interesting decoded strings: ${seen.size}`);
