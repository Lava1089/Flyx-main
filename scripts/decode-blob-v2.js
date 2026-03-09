#!/usr/bin/env node
/**
 * Decode the window['ZpQw9XkLmN8c3vR3'] blob from DaddyLive embed pages.
 * 
 * Strategy: Compare known blobs across different channels/pages to crack the cipher.
 * All blobs start with "A3BYEDFXAjpTA3Mi" — if the decoded URL starts with "https://"
 * we can derive the key/cipher from the known plaintext.
 */
const fs = require('fs');
const path = require('path');

// Collect all blobs from test artifacts
const blobDir = 'dlhd-extractor-worker/test-artifacts';
const dataDir = 'data';

function extractBlob(html) {
  const m = html.match(/window\['ZpQw9XkLmN8c3vR3'\]\s*=\s*'([^']+)'/);
  return m ? m[1] : null;
}

// Read all test artifacts
const files = [];
try {
  const artifacts = fs.readdirSync(blobDir);
  for (const f of artifacts) {
    if (f.endsWith('.html')) {
      try {
        const html = fs.readFileSync(path.join(blobDir, f), 'utf8');
        const blob = extractBlob(html);
        if (blob) files.push({ name: f, blob });
      } catch {}
    }
  }
} catch {}

// Also check data dir
try {
  const dataFiles = fs.readdirSync(dataDir);
  for (const f of dataFiles) {
    if (f.endsWith('.html')) {
      try {
        const html = fs.readFileSync(path.join(dataDir, f), 'utf8');
        const blob = extractBlob(html);
        if (blob) files.push({ name: `data/${f}`, blob });
      } catch {}
    }
  }
} catch {}

console.log(`Found ${files.length} blobs:\n`);
for (const f of files) {
  console.log(`${f.name}: ${f.blob.substring(0, 60)}... (len=${f.blob.length})`);
}

// The blob uses a custom base64 alphabet. Let's analyze.
// Standard base64: ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/
// The blob chars: A-Z, a-z, 0-9, +, /, =
// So it IS standard base64.

console.log('\n=== BASE64 DECODE ===');
for (const f of files) {
  const raw = Buffer.from(f.blob, 'base64');
  console.log(`\n${f.name} (${raw.length} bytes):`);
  console.log(`  Hex: ${raw.slice(0, 40).toString('hex')}`);
  console.log(`  ASCII: ${raw.slice(0, 40).toString('ascii').replace(/[^\x20-\x7e]/g, '.')}`);
}

// All blobs start with the same prefix "A3BYEDFXAjpTA3Mi"
// Base64 decode of "A3BYEDFXAjpTA3Mi" = 03 70 58 10 31 57 02 3a 53 03 72 22
// If the plaintext starts with "https://" (8 bytes = 68 74 74 70 73 3a 2f 2f)
// Then: 03^68=6b, 70^74=04, 58^74=2c, 10^70=60, 31^73=42, 57^3a=6d, 02^2f=2d, 3a^2f=15
// Key bytes: 6b 04 2c 60 42 6d 2d 15 ...
// That doesn't look like a repeating key.

// Let's try: maybe it's XOR with the key name "ZpQw9XkLmN8c3vR3" (16 chars)
const KEY = 'ZpQw9XkLmN8c3vR3';
console.log('\n=== XOR WITH KEY NAME ===');
for (const f of files.slice(0, 3)) {
  const raw = Buffer.from(f.blob, 'base64');
  const result = Buffer.alloc(raw.length);
  for (let i = 0; i < raw.length; i++) {
    result[i] = raw[i] ^ KEY.charCodeAt(i % KEY.length);
  }
  const str = result.toString('utf8');
  console.log(`\n${f.name}:`);
  console.log(`  ${str.substring(0, 200)}`);
  if (str.includes('http') || str.includes('.sbs') || str.includes('.com') || str.includes('premium')) {
    console.log('  *** FOUND URL PATTERN ***');
  }
}

// Maybe the blob is NOT base64 at all, but a custom encoding
// Let's look at the character set more carefully
console.log('\n=== CHARACTER ANALYSIS ===');
const charSet = new Set();
for (const f of files) {
  for (const c of f.blob) charSet.add(c);
}
const chars = [...charSet].sort();
console.log(`Unique chars (${chars.length}): ${chars.join('')}`);

// It uses: +/0-9=A-Za-z — that's standard base64 charset
// But maybe it's a CUSTOM base64 with a different alphabet mapping?

// Let's try: the blob might use a substitution cipher on the base64 string
// If we know "https://" maps to "A3BYEDFXAjpTA3Mi" in base64...
// "https://" in base64 = "aHR0cHM6Ly8=" (but that's only 8 bytes, 12 base64 chars with padding)
// Wait, the URL is longer. Let me think differently.

// Actually, let me try a completely different approach.
// The blob is likely XOR'd BEFORE base64 encoding, not after.
// So: plaintext -> XOR with key -> base64 encode = blob
// To decode: base64 decode blob -> XOR with key -> plaintext

// We already tried XOR with "ZpQw9XkLmN8c3vR3" above. Let me check if the result looks like a URL.
// Let me also try: maybe the XOR key is derived differently.

// Actually, let me look at this from a different angle.
// The embed page for stream-44 has the blob, and the decoded result should be a URL like:
// https://DOMAIN/premiumtv/daddyhd.php?id=44
// or similar player URL.

// Let me try XOR with various single-byte keys on the base64-decoded data
console.log('\n=== SINGLE BYTE XOR SCAN ===');
const testBlob = files[0].blob;
const testRaw = Buffer.from(testBlob, 'base64');
for (let key = 1; key < 256; key++) {
  const result = Buffer.alloc(testRaw.length);
  for (let i = 0; i < testRaw.length; i++) {
    result[i] = testRaw[i] ^ key;
  }
  const str = result.toString('utf8');
  if (str.includes('http') || str.includes('premium') || str.includes('.php')) {
    console.log(`Key ${key} (0x${key.toString(16)}): ${str.substring(0, 200)}`);
  }
}

// Let me also try: maybe it's NOT XOR but a simple byte shift/rotation
console.log('\n=== BYTE SHIFT SCAN ===');
for (let shift = 1; shift < 256; shift++) {
  const result = Buffer.alloc(testRaw.length);
  for (let i = 0; i < testRaw.length; i++) {
    result[i] = (testRaw[i] + shift) & 0xFF;
  }
  const str = result.toString('utf8');
  if (str.includes('http') || str.includes('premium') || str.includes('.php')) {
    console.log(`Shift +${shift}: ${str.substring(0, 200)}`);
  }
}

// Maybe the blob is a custom base64 with a SHUFFLED alphabet
// Standard: ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/
// Let me try to figure out the custom alphabet by assuming the plaintext starts with "https://"
// "https://" in bytes: 68 74 74 70 73 3a 2f 2f
// In base64 (standard): aHR0cHM6Ly8=
// But the blob starts with: A3BYEDFXAjpTA3Mi

// If the custom alphabet maps 'a' -> 'A', 'H' -> '3', 'R' -> 'B', '0' -> 'Y', etc.
// Let's build the mapping:
const stdB64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Known plaintext: "https://" -> base64 "aHR0cHM6Ly8"
// But wait, the URL is longer. Let me try different known prefixes.
// The player URL format is: https://DOMAIN/premiumtv/daddyhd.php?id=XX
// For channel 51 (dlhd-stream-51.html), the URL would end with id=51

// Actually, let me try a completely different approach.
// What if the encoding is NOT base64 at all, but a custom char-by-char substitution?
// Each character in the blob maps to a character in the plaintext.

// Let me compare blobs for the same channel from different domains to see what changes
console.log('\n=== COMPARING BLOBS FOR PATTERNS ===');
const grouped = {};
for (const f of files) {
  // Extract channel number from filename
  const chMatch = f.name.match(/(\d+)/);
  if (chMatch) {
    const ch = chMatch[1];
    if (!grouped[ch]) grouped[ch] = [];
    grouped[ch].push(f);
  }
}

for (const [ch, group] of Object.entries(grouped)) {
  if (group.length > 1) {
    console.log(`\nChannel ${ch} (${group.length} blobs):`);
    for (const f of group) {
      console.log(`  ${f.name}: ${f.blob.substring(0, 80)}...`);
    }
    // Find common prefix length
    let commonLen = 0;
    const first = group[0].blob;
    outer: for (let i = 0; i < first.length; i++) {
      for (let j = 1; j < group.length; j++) {
        if (group[j].blob[i] !== first[i]) break outer;
      }
      commonLen++;
    }
    console.log(`  Common prefix length: ${commonLen}`);
    
    // Find positions that differ
    const diffs = [];
    for (let i = 0; i < Math.min(...group.map(g => g.blob.length)); i++) {
      const chars = new Set(group.map(g => g.blob[i]));
      if (chars.size > 1) diffs.push(i);
    }
    console.log(`  Differing positions: ${diffs.slice(0, 20).join(', ')}${diffs.length > 20 ? '...' : ''} (${diffs.length} total)`);
  }
}
