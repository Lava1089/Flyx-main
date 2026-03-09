#!/usr/bin/env node
/**
 * Crack the blob cipher by known-plaintext attack.
 * 
 * We know the player URLs from the domain history:
 * - hitsplay-31.html -> https://hitsplay.fun/premiumtv/daddyhd.php?id=31
 * - codepcplay-51.html -> https://codepcplay.fun/premiumtv/daddyhd.php?id=51
 * - dlhd-stream-51.html -> https://DOMAIN/premiumtv/daddyhd.php?id=51
 * 
 * The blob is base64-decoded to raw bytes, then some cipher is applied.
 * Let's figure out the cipher by comparing known plaintext with ciphertext.
 */
const fs = require('fs');
const path = require('path');

function extractBlob(filepath) {
  const html = fs.readFileSync(filepath, 'utf8');
  const m = html.match(/window\['ZpQw9XkLmN8c3vR3'\]\s*=\s*'([^']+)'/);
  return m ? m[1] : null;
}

// Known mappings (filename -> expected player URL)
const known = [
  {
    file: 'dlhd-extractor-worker/test-artifacts/hitsplay-31.html',
    url: 'https://hitsplay.fun/premiumtv/daddyhd.php?id=31'
  },
  {
    file: 'dlhd-extractor-worker/test-artifacts/hitsplay-fresh-31.html',
    url: 'https://hitsplay.fun/premiumtv/daddyhd.php?id=31'
  },
  {
    file: 'dlhd-extractor-worker/test-artifacts/codepcplay-51.html',
    url: 'https://codepcplay.fun/premiumtv/daddyhd.php?id=51'
  },
  {
    file: 'dlhd-extractor-worker/test-artifacts/codepcplay-51-fresh.html',
    url: 'https://codepcplay.fun/premiumtv/daddyhd.php?id=51'
  },
];

// For each known pair, derive the XOR key
for (const { file, url } of known) {
  const blob = extractBlob(file);
  if (!blob) { console.log(`No blob in ${file}`); continue; }
  
  const cipherBytes = Buffer.from(blob, 'base64');
  const plainBytes = Buffer.from(url, 'utf8');
  
  console.log(`\n=== ${path.basename(file)} ===`);
  console.log(`Blob length: ${blob.length} chars, ${cipherBytes.length} bytes`);
  console.log(`URL length: ${url.length} chars`);
  console.log(`URL: ${url}`);
  
  // Derive XOR key
  const keyBytes = [];
  for (let i = 0; i < Math.min(cipherBytes.length, plainBytes.length); i++) {
    keyBytes.push(cipherBytes[i] ^ plainBytes[i]);
  }
  
  console.log(`XOR key (first 60 bytes): ${Buffer.from(keyBytes.slice(0, 60)).toString('hex')}`);
  console.log(`XOR key as ASCII: ${Buffer.from(keyBytes.slice(0, 60)).toString('ascii').replace(/[^\x20-\x7e]/g, '.')}`);
  
  // Check if key is repeating
  const keyStr = Buffer.from(keyBytes).toString('hex');
  for (let period = 1; period <= 32; period++) {
    const pattern = keyStr.substring(0, period * 2);
    let matches = true;
    for (let i = 0; i < keyStr.length - period * 2; i += period * 2) {
      if (keyStr.substring(i, i + period * 2) !== pattern) {
        matches = false;
        break;
      }
    }
    if (matches) {
      console.log(`Key repeats with period ${period}: ${pattern}`);
      break;
    }
  }
}

// Now let's try: maybe the URL has additional content after the PHP URL
// Like query params or the full page content
// Let's check if the remaining bytes after the URL decode to something

console.log('\n\n=== TRYING DIFFERENT URL FORMATS ===');
// Maybe the URL format is different
const urlFormats = [
  'https://hitsplay.fun/premiumtv/daddyhd.php?id=31',
  'https://www.hitsplay.fun/premiumtv/daddyhd.php?id=31',
  'https://hitsplay.fun/premiumtv/daddyhd.php?id=31&',
  '//hitsplay.fun/premiumtv/daddyhd.php?id=31',
];

const testBlob = extractBlob('dlhd-extractor-worker/test-artifacts/hitsplay-31.html');
const testCipher = Buffer.from(testBlob, 'base64');

for (const url of urlFormats) {
  const plainBytes = Buffer.from(url, 'utf8');
  const keyBytes = [];
  for (let i = 0; i < Math.min(testCipher.length, plainBytes.length); i++) {
    keyBytes.push(testCipher[i] ^ plainBytes[i]);
  }
  
  // Check if key looks like it could be a repeating pattern
  const keyHex = Buffer.from(keyBytes).toString('hex');
  console.log(`\nURL: ${url}`);
  console.log(`Key: ${keyHex.substring(0, 80)}`);
  
  // Try to find repeating pattern
  for (let period = 1; period <= 32; period++) {
    let isRepeating = true;
    for (let i = period; i < keyBytes.length; i++) {
      if (keyBytes[i] !== keyBytes[i % period]) {
        isRepeating = false;
        break;
      }
    }
    if (isRepeating && period <= 20) {
      console.log(`  REPEATING KEY with period ${period}: ${keyHex.substring(0, period * 2)}`);
      
      // Now decode ALL blobs with this key
      console.log('\n  === DECODING ALL BLOBS ===');
      const artifacts = fs.readdirSync('dlhd-extractor-worker/test-artifacts');
      for (const f of artifacts) {
        if (!f.endsWith('.html')) continue;
        try {
          const blob = extractBlob(path.join('dlhd-extractor-worker/test-artifacts', f));
          if (!blob) continue;
          const cipher = Buffer.from(blob, 'base64');
          const plain = Buffer.alloc(cipher.length);
          for (let i = 0; i < cipher.length; i++) {
            plain[i] = cipher[i] ^ keyBytes[i % period];
          }
          console.log(`  ${f}: ${plain.toString('utf8').substring(0, 120)}`);
        } catch {}
      }
      
      // Also decode the embed-44 blob
      try {
        const blob44 = extractBlob('data/embed-44-raw.html');
        if (blob44) {
          const cipher44 = Buffer.from(blob44, 'base64');
          const plain44 = Buffer.alloc(cipher44.length);
          for (let i = 0; i < cipher44.length; i++) {
            plain44[i] = cipher44[i] ^ keyBytes[i % period];
          }
          console.log(`\n  *** embed-44-raw.html: ${plain44.toString('utf8').substring(0, 200)}`);
        }
      } catch {}
      
      break;
    }
  }
}

// Alternative: maybe it's not XOR at all. Let's check if it's a simple addition/subtraction
console.log('\n\n=== TRYING ADDITION CIPHER ===');
{
  const url = 'https://hitsplay.fun/premiumtv/daddyhd.php?id=31';
  const plainBytes = Buffer.from(url, 'utf8');
  const diffBytes = [];
  for (let i = 0; i < Math.min(testCipher.length, plainBytes.length); i++) {
    diffBytes.push((testCipher[i] - plainBytes[i] + 256) % 256);
  }
  console.log(`Diff: ${Buffer.from(diffBytes.slice(0, 60)).toString('hex')}`);
  
  // Check for repeating pattern
  for (let period = 1; period <= 20; period++) {
    let isRepeating = true;
    for (let i = period; i < diffBytes.length; i++) {
      if (diffBytes[i] !== diffBytes[i % period]) {
        isRepeating = false;
        break;
      }
    }
    if (isRepeating) {
      console.log(`  REPEATING DIFF with period ${period}: ${Buffer.from(diffBytes.slice(0, period)).toString('hex')}`);
      break;
    }
  }
}
