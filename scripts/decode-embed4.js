#!/usr/bin/env node
/**
 * Proper decoder for DaddyLive embed page
 * Encoding: base64 -> URI decode (no RC4!)
 * Offset: 0x1ef (495)
 */
const fs = require('fs');
const html = fs.readFileSync('data/embed-44-raw.html', 'utf8');

// Extract string array
const arrayMatch = html.match(/function _0x4360\(\)\{[^[]*?\[([\s\S]*?)\];/);
const strings = [];
let m;
const re = /'([^']*)'/g;
while ((m = re.exec(arrayMatch[1])) !== null) strings.push(m[1]);

// Base64 decode + URI decode (from the deobfuscated _0x4ef1)
function decode(str) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';
  let result = '', temp = '';
  for (let i = 0, chr, enc, p = 0; enc = str.charAt(p++); ~enc && (chr = i % 4 ? chr * 64 + enc : enc, i++ % 4) ? result += String.fromCharCode(0xff & chr >> (-2 * i & 6)) : 0) {
    enc = alphabet.indexOf(enc);
  }
  for (let i = 0; i < result.length; i++) {
    temp += '%' + ('00' + result.charCodeAt(i).toString(16)).slice(-2);
  }
  return decodeURIComponent(temp);
}

// The array gets shuffled at startup. We need to simulate the shuffle.
// The shuffle loop: while(true) { compute sum from parseInt of decoded strings; if sum === 0x55e2d break; else rotate }
// We need to find the right rotation.

const OFFSET = 0x1ef; // 495
const TARGET = 0x55e2d; // 351789

// The shuffle uses specific indices to compute a checksum
// From the code: parseInt(_0x35db1e(0x3dc))/1 * parseInt(_0x35db1e(0xc36))/2 + ...
// _0x35db1e is an alias for _0x4ef1, so these are lookups
// Indices used: 0x3dc, 0xc36, 0x1451, 0x130e, 0x76c, 0xd45, 0x3c8, 0x14f0, 0x924, 0xaea, 0x165c, 0xf8b
const checkIndices = [0x3dc, 0xc36, 0x1451, 0x130e, 0x76c, 0xd45, 0x3c8, 0x14f0, 0x924, 0xaea, 0x165c, 0xf8b];
// Coefficients: /1 * /2 + /3 * /4 + /5 * -/6 + -/7 * /8 + /9 * -/10 + /11 + -/12
// = (a/1)*(b/2) + (c/3)*(d/4) + (e/5)*(-f/6) + (-g/7)*(h/8) + (i/9)*(-j/10) + k/11 + (-l/12)

function computeChecksum(arr) {
  function lookup(idx) {
    const arrIdx = idx - OFFSET;
    if (arrIdx < 0 || arrIdx >= arr.length) return NaN;
    try { return parseInt(decode(arr[arrIdx])); } catch { return NaN; }
  }
  const vals = checkIndices.map(i => lookup(i));
  return (vals[0]/1)*(vals[1]/2) + (vals[2]/3)*(vals[3]/4) + (vals[4]/5)*(-vals[5]/6) + (-vals[6]/7)*(vals[7]/8) + (vals[8]/9)*(-vals[9]/10) + vals[10]/11 + (-vals[11]/12);
}

// Simulate the shuffle
let arr = [...strings];
let found = false;
for (let rotation = 0; rotation < strings.length; rotation++) {
  const checksum = computeChecksum(arr);
  if (checksum === TARGET) {
    console.log(`Found correct rotation: ${rotation}`);
    found = true;
    break;
  }
  arr.push(arr.shift()); // rotate
}

if (!found) {
  console.log('Could not find rotation, trying without shuffle...');
  arr = [...strings];
}

// Now decode all strings and search for interesting ones
console.log(`\nDecoding ${arr.length} strings...`);
const decoded = [];
for (let i = 0; i < arr.length; i++) {
  try {
    decoded.push(decode(arr[i]));
  } catch {
    decoded.push(`[DECODE_ERROR:${arr[i].substring(0,20)}]`);
  }
}

// Search for domains
console.log('\n=== DOMAINS ===');
decoded.forEach((d, i) => {
  if (/\.(sbs|xyz|fun|cfd|site|com|ru|cyou|top|net|io|live|dad|mp|pw|click)/.test(d) && d.length < 100) {
    console.log(`  [${i + OFFSET}=0x${(i + OFFSET).toString(16)}] "${d}"`);
  }
});

// Search for URLs
console.log('\n=== URLs ===');
decoded.forEach((d, i) => {
  if ((d.startsWith('http') || d.startsWith('//')) && d.length < 200) {
    console.log(`  [${i + OFFSET}=0x${(i + OFFSET).toString(16)}] "${d}"`);
  }
});

// Search for auth/key/player related
console.log('\n=== AUTH/KEY/PLAYER ===');
const keywords = ['auth', 'token', 'salt', 'eplayer', 'premium', 'daddyhd', 'premiumtv', 'mono', 'proxy', 'server_lookup', 'channel', 'bearer', 'hmac', 'nonce', 'fingerprint', 'captcha', 'recaptcha', 'iframe', 'player', 'embed', 'hls', 'm3u8', 'init', 'key', 'decrypt', 'encrypt', 'crypto'];
decoded.forEach((d, i) => {
  const lower = d.toLowerCase();
  if (keywords.some(kw => lower.includes(kw)) && d.length < 150) {
    console.log(`  [${i + OFFSET}=0x${(i + OFFSET).toString(16)}] "${d}"`);
  }
});
