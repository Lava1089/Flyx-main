#!/usr/bin/env node
/**
 * We found the XOR key repeats with period 24 for hitsplay URLs.
 * Key (hex): 6b042c60426d2d153b6a07516a5b6d6f5e65235a7c6b5a3f
 * Let's verify by decoding the full blob and checking if the result makes sense.
 */
const fs = require('fs');
const path = require('path');

function extractBlob(filepath) {
  const html = fs.readFileSync(filepath, 'utf8');
  const m = html.match(/window\['ZpQw9XkLmN8c3vR3'\]\s*=\s*'([^']+)'/);
  return m ? m[1] : null;
}

// Key derived from hitsplay-31 known plaintext
const KEY_HEX = '6b042c60426d2d153b6a07516a5b6d6f5e65235a7c6b5a3f';
const keyBytes = Buffer.from(KEY_HEX, 'hex');
console.log(`Key (${keyBytes.length} bytes): ${KEY_HEX}`);
console.log(`Key as ASCII: ${keyBytes.toString('ascii').replace(/[^\x20-\x7e]/g, '.')}`);

// Decode all blobs
const testFiles = [
  'dlhd-extractor-worker/test-artifacts/hitsplay-31.html',
  'dlhd-extractor-worker/test-artifacts/hitsplay-fresh-31.html',
  'dlhd-extractor-worker/test-artifacts/hitsplay-test.html',
  'dlhd-extractor-worker/test-artifacts/codepcplay-51.html',
  'dlhd-extractor-worker/test-artifacts/codepcplay-51-fresh.html',
  'dlhd-extractor-worker/test-artifacts/dlhd-stream-31.html',
  'dlhd-extractor-worker/test-artifacts/dlhd-stream-51.html',
  'dlhd-extractor-worker/test-artifacts/dlhd-stream-new.html',
  'dlhd-extractor-worker/test-artifacts/dlhd-stream-51-new.html',
  'dlhd-extractor-worker/test-artifacts/dlhd-player1-31.html',
  'dlhd-extractor-worker/test-artifacts/dlhd-cast-31.html',
  'dlhd-extractor-worker/test-artifacts/temp-player.html',
  'data/embed-44-raw.html',
];

for (const file of testFiles) {
  try {
    const blob = extractBlob(file);
    if (!blob) continue;
    const cipher = Buffer.from(blob, 'base64');
    const plain = Buffer.alloc(cipher.length);
    for (let i = 0; i < cipher.length; i++) {
      plain[i] = cipher[i] ^ keyBytes[i % keyBytes.length];
    }
    const decoded = plain.toString('utf8');
    // Check if it looks like valid text
    const printable = decoded.replace(/[^\x20-\x7e]/g, '.');
    console.log(`\n${path.basename(file)}:`);
    console.log(`  ${printable.substring(0, 200)}`);
    
    // Extract any URLs
    const urls = decoded.match(/https?:\/\/[^\s"'<>]+/g);
    if (urls) {
      console.log(`  URLs found: ${urls.join(', ')}`);
    }
  } catch (e) {
    console.log(`Error with ${file}: ${e.message}`);
  }
}

// The key might not be exactly right for all files.
// Let's try a different approach: maybe the key is derived from something on the page.
// The window variable name is 'ZpQw9XkLmN8c3vR3' — 16 chars.
// But our key is 24 bytes. Let's see if there's a relationship.

console.log('\n\n=== KEY ANALYSIS ===');
const keyName = 'ZpQw9XkLmN8c3vR3';
console.log(`Key name: ${keyName} (${keyName.length} chars)`);
console.log(`Key name hex: ${Buffer.from(keyName).toString('hex')}`);
console.log(`XOR key hex:  ${KEY_HEX}`);

// XOR the key with the key name to see if there's a pattern
const keyNameBytes = Buffer.from(keyName);
console.log('\nXOR of derived key with key name:');
for (let i = 0; i < keyBytes.length; i++) {
  const xored = keyBytes[i] ^ keyNameBytes[i % keyNameBytes.length];
  process.stdout.write(xored.toString(16).padStart(2, '0') + ' ');
}
console.log();

// Maybe the key is just the key name repeated and XOR'd with something else
// Or maybe the cipher is more complex than simple XOR

// Let's try: maybe the blob is decoded by the obfuscated JS using a specific algorithm
// that we can find by looking at how window['ZpQw9XkLmN8c3vR3'] is used in the code

// Actually, let me look at this from a completely different angle.
// The blob values differ between pages for the same channel when fetched from different domains.
// This means the blob encodes the FULL player URL including the domain.
// 
// For hitsplay-31: URL = https://hitsplay.fun/premiumtv/daddyhd.php?id=31
// For dlhd-stream-31: URL = https://SOME_DOMAIN/premiumtv/daddyhd.php?id=31
//
// The common prefix of 26 base64 chars = 19 bytes of ciphertext
// XOR with key[0:19] should give us "https://COMMON_PART"
// "https://" is 8 bytes, so 19 bytes = "https://" + 11 more chars
// But the domains are different lengths, so the common part should just be "https://"
// 
// Wait, 26 base64 chars = floor(26*6/8) = 19 bytes
// Let's check: what do the first 19 bytes decode to with our key?

console.log('\n\n=== FIRST 19 BYTES DECODED ===');
for (const file of testFiles.slice(0, 5)) {
  try {
    const blob = extractBlob(file);
    if (!blob) continue;
    const cipher = Buffer.from(blob, 'base64');
    const plain = Buffer.alloc(19);
    for (let i = 0; i < 19; i++) {
      plain[i] = cipher[i] ^ keyBytes[i % keyBytes.length];
    }
    console.log(`${path.basename(file)}: "${plain.toString('utf8')}"`);
  } catch {}
}
