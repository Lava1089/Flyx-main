#!/usr/bin/env node
/**
 * Decode DaddyLive embed - the strings use a custom base64 variant
 * The _0x4ef1 function is the decoder that maps indices to decoded strings
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

// Print first 20 raw strings to understand encoding
console.log('\nFirst 20 raw strings:');
for (let i = 0; i < 20; i++) console.log(`  [${i}] ${strings[i]}`);

// The _0x4ef1 function is the string decoder - it takes an index and applies
// a rotation + base64 decode. Let's find the rotation offset.
// Pattern: _0x4ef1(idx) { ... _0x4360(); ... _0x4ef1 = function(idx) { idx -= OFFSET; ... atob(str) }
const decoderMatch = html.match(/_0x4ef1\s*=\s*function\s*\([^)]*\)\s*\{[^}]*?-=\s*(0x[0-9a-f]+|[0-9]+)/);
if (decoderMatch) {
  console.log(`\nDecoder offset: ${decoderMatch[1]} = ${parseInt(decoderMatch[1])}`);
}

// Also find the shuffle/rotation applied to the array
// Pattern: parseInt(...) === _0x52aed2 where _0x52aed2 is the target sum
const shuffleMatch = html.match(/\(_0x4360,\s*(0x[0-9a-f]+)\)/);
if (shuffleMatch) {
  console.log(`Shuffle target: ${shuffleMatch[1]} = ${parseInt(shuffleMatch[1])}`);
}

// The strings are base64 encoded with a custom alphabet or just standard atob
// Let's try decoding with standard base64 but check if they're valid
console.log('\nTrying base64 decode on first 50 strings:');
let decodedCount = 0;
const allDecoded = [];
for (let i = 0; i < strings.length; i++) {
  try {
    const d = Buffer.from(strings[i], 'base64').toString('utf8');
    // Check if result is printable ASCII
    if (/^[\x20-\x7e]+$/.test(d)) {
      allDecoded.push({ idx: i, raw: strings[i], decoded: d });
      if (decodedCount < 50) {
        console.log(`  [${i}] ${strings[i]} -> "${d}"`);
        decodedCount++;
      }
    }
  } catch {}
}

console.log(`\nTotal decodable strings: ${allDecoded.length} / ${strings.length}`);

// Search decoded strings for domains and interesting patterns
console.log('\n=== DECODED DOMAINS ===');
allDecoded.forEach(({ idx, decoded: d }) => {
  if (/\.(sbs|xyz|fun|cfd|site|com|ru|cyou|top|net|io|live|dad|mp)/.test(d)) {
    console.log(`  [${idx}] "${d}"`);
  }
});

console.log('\n=== DECODED URLs ===');
allDecoded.forEach(({ idx, decoded: d }) => {
  if (d.includes('http') || d.includes('//')) console.log(`  [${idx}] "${d}"`);
});

console.log('\n=== DECODED AUTH/KEY ===');
allDecoded.forEach(({ idx, decoded: d }) => {
  const lower = d.toLowerCase();
  if (['auth', 'token', 'salt', 'key', 'eplayer', 'premium', 'daddyhd', 'premiumtv', 'mono', 'proxy', 'server', 'channel', 'bearer', 'hmac', 'nonce', 'fingerprint', 'captcha', 'recaptcha', 'whitelist', 'init'].some(kw => lower.includes(kw))) {
    console.log(`  [${idx}] "${d}"`);
  }
});

console.log('\n=== DECODED PLAYER/STREAM ===');
allDecoded.forEach(({ idx, decoded: d }) => {
  const lower = d.toLowerCase();
  if (['iframe', 'player', 'embed', 'hls', 'm3u8', 'video', 'stream', 'source', 'manifest'].some(kw => lower.includes(kw))) {
    console.log(`  [${idx}] "${d}"`);
  }
});

// Also search for the encoded blob key in decoded strings
const blobMatch = html.match(/window\['([^']+)'\]/);
if (blobMatch) {
  const blobKey = blobMatch[1];
  console.log(`\n=== BLOB KEY "${blobKey}" in decoded ===`);
  allDecoded.forEach(({ idx, decoded: d }) => {
    if (d.includes(blobKey) || d === blobKey) console.log(`  [${idx}] "${d}"`);
  });
}
