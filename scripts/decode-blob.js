#!/usr/bin/env node
/**
 * Decode the window[] blob from DaddyLive embed page
 * This blob contains the player iframe URL
 * 
 * The blob is a custom base64 encoding that uses a key derived from the variable name
 */
const fs = require('fs');
const html = fs.readFileSync('data/embed-44-raw.html', 'utf8');

const blobMatch = html.match(/window\['([^']+)'\]\s*=\s*'([^']+)'/);
if (!blobMatch) { console.log('No blob found'); process.exit(1); }

const key = blobMatch[1]; // ZpQw9XkLmN8c3vR3
const blob = blobMatch[2];

console.log(`Key: ${key} (length ${key.length})`);
console.log(`Blob: ${blob.substring(0, 80)}... (length ${blob.length})`);

// Standard base64 decode
const raw = Buffer.from(blob, 'base64');
console.log(`\nRaw bytes (${raw.length}): ${Array.from(raw.slice(0, 40)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);

// Try XOR with the key name
function xorWithKey(data, key) {
  const result = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) {
    result[i] = data[i] ^ key.charCodeAt(i % key.length);
  }
  return result;
}

const xored = xorWithKey(raw, key);
const xoredStr = xored.toString('utf8');
console.log(`\nXOR with key "${key}":`);
console.log(xoredStr.substring(0, 500));

// Try XOR with single bytes
for (let b = 1; b < 256; b++) {
  const result = Buffer.from(raw.map(byte => byte ^ b));
  const str = result.toString('utf8');
  if (str.includes('http') || str.includes('.sbs') || str.includes('.com/') || str.includes('premium') || str.includes('iframe')) {
    console.log(`\nXOR with byte ${b} (0x${b.toString(16)}):`);
    console.log(str.substring(0, 500));
    break;
  }
}

// Try simple character substitution (Caesar cipher on base64)
for (let shift = 1; shift < 64; shift++) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let shifted = '';
  for (const c of blob) {
    const idx = alphabet.indexOf(c);
    if (idx >= 0) {
      shifted += alphabet[(idx + shift) % 64];
    } else {
      shifted += c; // = padding
    }
  }
  try {
    const decoded = Buffer.from(shifted, 'base64').toString('utf8');
    if (decoded.includes('http') || decoded.includes('.sbs') || decoded.includes('premium') || decoded.includes('iframe')) {
      console.log(`\nBase64 Caesar shift ${shift}:`);
      console.log(decoded.substring(0, 500));
      break;
    }
  } catch {}
}

// The blob might use a Vigenere-like cipher on the base64 string itself
// Try using the key to shift each character
const b64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
let vigenere = '';
for (let i = 0; i < blob.length; i++) {
  const c = blob[i];
  const ci = b64chars.indexOf(c);
  const ki = b64chars.indexOf(key[i % key.length]);
  if (ci >= 0 && ki >= 0) {
    vigenere += b64chars[(ci - ki + 64) % 64];
  } else {
    vigenere += c;
  }
}
try {
  const vdecoded = Buffer.from(vigenere, 'base64').toString('utf8');
  if (/[\x20-\x7e]{10,}/.test(vdecoded)) {
    console.log(`\nVigenere decode:`);
    console.log(vdecoded.substring(0, 500));
  }
} catch {}

// Also try: the blob might just be the iframe URL with a simple XOR on the base64-decoded bytes
// using the key bytes cyclically
console.log('\n\nTrying all XOR key rotations...');
for (let startOffset = 0; startOffset < key.length; startOffset++) {
  const rotatedKey = key.substring(startOffset) + key.substring(0, startOffset);
  const result = xorWithKey(raw, rotatedKey);
  const str = result.toString('utf8');
  if (str.includes('http') || str.includes('.sbs') || str.includes('.com') || str.includes('premium')) {
    console.log(`Key rotation ${startOffset}: ${str.substring(0, 500)}`);
  }
}
