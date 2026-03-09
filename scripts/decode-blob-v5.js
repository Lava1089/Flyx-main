#!/usr/bin/env node
/**
 * The XOR key is NOT repeating. It's a full-length key (OTP-like).
 * But the same blob value appears across different page loads for the same domain+channel.
 * 
 * Key insight: the blob is 560 bytes but the URL is only ~50 chars.
 * So the blob contains MORE than just the URL.
 * 
 * Let me look at what the blob actually contains by examining the structure.
 * Maybe it's a JSON object or HTML snippet that includes the URL.
 * 
 * New approach: The cipher might not be XOR at all. Let me look at the 
 * relationship between blob bytes and known plaintext bytes more carefully.
 */
const fs = require('fs');
const path = require('path');

function extractBlob(filepath) {
  const html = fs.readFileSync(filepath, 'utf8');
  const m = html.match(/window\['ZpQw9XkLmN8c3vR3'\]\s*=\s*'([^']+)'/);
  return m ? m[1] : null;
}

// The blob is 560 bytes but the URL is ~50 chars.
// Maybe the blob encodes a larger structure (JSON config, HTML, etc.)
// Let's look at the raw bytes more carefully.

const blob = extractBlob('dlhd-extractor-worker/test-artifacts/hitsplay-31.html');
const raw = Buffer.from(blob, 'base64');

console.log(`Blob: ${blob.length} base64 chars = ${raw.length} bytes`);
console.log(`\nFirst 100 bytes hex:`);
for (let i = 0; i < 100; i += 20) {
  const slice = raw.slice(i, Math.min(i + 20, 100));
  console.log(`  ${i.toString().padStart(3)}: ${Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
}

// Let me try a completely different approach.
// What if the blob is NOT encrypted at all, but is a custom encoding?
// The base64-decoded bytes might be a custom binary format.

// Actually, looking at the blob characters more carefully:
// A3BYEDFXAjpTA3MiGjcMFnADVjRTGyhaCEEhGCETGSAX...
// These look like they could be base64 of something, but also...
// What if each pair of characters represents something?

// Let me try: treat the blob as pairs of base64 chars, each encoding a byte
// using a custom mapping.

// Actually, let me try the simplest thing: maybe the blob is just 
// a different base encoding, like base62 or a custom alphabet.

// Wait — let me re-examine. The blob has chars A-Z, a-z, 0-9, +, /, =
// That's standard base64. And base64 decoding gives us 560 bytes.
// 560 bytes is way more than a URL.

// What if the 560 bytes is actually a COMPRESSED or structured payload?
// Like: [URL bytes] [padding] [auth data] [other config]

// Let me look for patterns in the raw bytes
console.log('\n\nByte frequency analysis:');
const freq = new Array(256).fill(0);
for (const b of raw) freq[b]++;
const nonZero = freq.map((f, i) => [i, f]).filter(([_, f]) => f > 0).sort((a, b) => b[1] - a[1]);
console.log(`Unique byte values: ${nonZero.length}`);
console.log('Top 20:', nonZero.slice(0, 20).map(([b, f]) => `0x${b.toString(16).padStart(2, '0')}(${f})`).join(', '));

// Let me try yet another approach: maybe the blob is NOT base64 at all
// but uses a CUSTOM alphabet that maps to different values.
// What if the "base64" string is actually a custom encoding where each
// character maps to a 6-bit value using a DIFFERENT alphabet?

// Standard base64: A=0, B=1, ..., Z=25, a=26, ..., z=51, 0=52, ..., 9=61, +=62, /=63
// What if the custom alphabet is reversed or shuffled?

// Let me try reversed alphabet
const stdAlpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const revAlpha = stdAlpha.split('').reverse().join('');

function customB64Decode(str, alphabet) {
  const lookup = {};
  for (let i = 0; i < alphabet.length; i++) lookup[alphabet[i]] = i;
  
  const bytes = [];
  let bits = 0, value = 0;
  for (const c of str) {
    if (c === '=') break;
    const v = lookup[c];
    if (v === undefined) continue;
    value = (value << 6) | v;
    bits += 6;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xFF);
    }
  }
  return Buffer.from(bytes);
}

// Try reversed alphabet
const revDecoded = customB64Decode(blob, revAlpha);
const revStr = revDecoded.toString('utf8');
console.log('\n\nReversed alphabet decode:');
console.log(revStr.substring(0, 200).replace(/[^\x20-\x7e]/g, '.'));

// Try swapped case alphabet (a-z first, then A-Z)
const swapAlpha = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/';
const swapDecoded = customB64Decode(blob, swapAlpha);
console.log('\nSwapped case alphabet:');
console.log(swapDecoded.toString('utf8').substring(0, 200).replace(/[^\x20-\x7e]/g, '.'));

// Try ROT13 on the base64 string first, then standard decode
let rot13Blob = '';
for (const c of blob) {
  if (c >= 'A' && c <= 'Z') rot13Blob += String.fromCharCode(((c.charCodeAt(0) - 65 + 13) % 26) + 65);
  else if (c >= 'a' && c <= 'z') rot13Blob += String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97);
  else rot13Blob += c;
}
try {
  const rot13Decoded = Buffer.from(rot13Blob, 'base64');
  console.log('\nROT13 then base64:');
  console.log(rot13Decoded.toString('utf8').substring(0, 200).replace(/[^\x20-\x7e]/g, '.'));
} catch {}

// What if each character in the blob directly maps to a character in the output
// via a substitution table? Let's check if the blob length matches the output length.
// Blob is 748 chars, output URL is ~50 chars. So it's not 1:1.

// Let me try: maybe the blob is actually a different format entirely.
// What if it's NOT base64 but looks like it? What if it's a custom encoding
// where groups of characters map to bytes differently?

// Actually, let me look at this from the JS side.
// The obfuscated JS reads window['ZpQw9XkLmN8c3vR3'] and decodes it.
// Let me search for how this variable is used in the code.

console.log('\n\n=== SEARCHING FOR BLOB USAGE IN CODE ===');
const htmlFiles = [
  'dlhd-extractor-worker/test-artifacts/hitsplay-31.html',
  'dlhd-extractor-worker/test-artifacts/dlhd-stream-51.html',
];

for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  
  // Search for ZpQw9XkLmN8c3vR3 usage (not the assignment)
  const usages = [];
  const re = /ZpQw9XkLmN8c3vR3/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const context = html.substring(Math.max(0, m.index - 50), Math.min(html.length, m.index + 80));
    usages.push(context.replace(/\n/g, ' '));
  }
  console.log(`\n${path.basename(file)}: ${usages.length} usages`);
  for (const u of usages) {
    console.log(`  ...${u}...`);
  }
}

// Also look for atob, btoa, or custom decode functions near the blob
for (const file of htmlFiles.slice(0, 1)) {
  const html = fs.readFileSync(file, 'utf8');
  
  // Find the code that reads the blob
  const blobIdx = html.indexOf("window['ZpQw9XkLmN8c3vR3']");
  if (blobIdx > 0) {
    // Look for the next script tag or function that uses it
    const afterBlob = html.substring(blobIdx);
    
    // Find patterns like: atob(window['ZpQw9XkLmN8c3vR3'])
    // or: someFunc(window['ZpQw9XkLmN8c3vR3'])
    const atobMatch = afterBlob.match(/atob\s*\(\s*window\[/);
    if (atobMatch) {
      console.log('\nFound atob usage on blob!');
    }
    
    // Look for the decode function pattern
    // The obfuscated code likely has something like:
    // var decoded = customDecode(window['ZpQw9XkLmN8c3vR3']);
    // document.getElementById('player').src = decoded;
    
    // Let me search for 'src' assignments near iframe creation
    const srcMatches = afterBlob.match(/\.src\s*=|\.setAttribute\s*\(\s*['"]src['"]/g);
    console.log(`\nFound ${srcMatches ? srcMatches.length : 0} .src assignments after blob`);
  }
}
