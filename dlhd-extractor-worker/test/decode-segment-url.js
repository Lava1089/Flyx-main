#!/usr/bin/env node
/**
 * Analyze the segment URL encoding
 */

const crypto = require('crypto');

// Sample segment URL path (after domain)
const segmentPath = '9aa4a6a6a06a605c959ca05e969fa093a09f9699a2a060999c9d608ea6ac93939aa3929ea5a061696562686f6160695e666f6565626b5f69685d6169666668685e616366686e6768676e6466695d616b6662966ea19f6493a1a4695ea6aea16f96a56f6e6b67949b8f6296539bab6f666b6d8e696a8e975e9a9d6f6b65939566676d6b6665665e67698f98686366626c636696916b6b93926a6f60929661657195606b6c64609466629d9492979791939566636a9866679862669253';

console.log('═'.repeat(70));
console.log('SEGMENT URL ANALYSIS');
console.log('═'.repeat(70));

console.log(`\nSegment path length: ${segmentPath.length} chars`);
console.log(`Segment path (hex): ${segmentPath}`);

// Try to decode as hex
console.log('\n1. Trying hex decode...');
try {
  const decoded = Buffer.from(segmentPath, 'hex');
  console.log(`   Decoded length: ${decoded.length} bytes`);
  console.log(`   First 32 bytes: ${decoded.slice(0, 32).toString('hex')}`);
  console.log(`   As ASCII: ${decoded.toString('ascii').substring(0, 50)}`);
  
  // Check for patterns
  console.log('\n   Byte frequency analysis:');
  const freq = {};
  for (const byte of decoded) {
    freq[byte] = (freq[byte] || 0) + 1;
  }
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [byte, count] of sorted) {
    console.log(`   0x${parseInt(byte).toString(16).padStart(2, '0')}: ${count} times`);
  }
} catch (e) {
  console.log(`   Error: ${e.message}`);
}

// Split into parts
console.log('\n2. Analyzing structure...');
// The URL seems to have a fixed prefix
const prefix = segmentPath.substring(0, 64);
const middle = segmentPath.substring(64, 128);
const suffix = segmentPath.substring(128);

console.log(`   Prefix (0-64): ${prefix}`);
console.log(`   Middle (64-128): ${middle}`);
console.log(`   Suffix (128+): ${suffix.substring(0, 64)}...`);

// Check if parts are related
console.log('\n3. XOR analysis...');
const prefixBuf = Buffer.from(prefix, 'hex');
const middleBuf = Buffer.from(middle, 'hex');

const xorResult = Buffer.alloc(32);
for (let i = 0; i < 32; i++) {
  xorResult[i] = prefixBuf[i] ^ middleBuf[i];
}
console.log(`   Prefix XOR Middle: ${xorResult.toString('hex')}`);
console.log(`   As ASCII: ${xorResult.toString('ascii')}`);

// Check for known patterns
console.log('\n4. Looking for known patterns...');

// The secret key from WASM
const secretKey = '444c44cc8888888844444444';
const secretKeyBuf = Buffer.from(secretKey, 'hex');

// XOR with secret key
const xorSecret = Buffer.alloc(32);
for (let i = 0; i < 32; i++) {
  xorSecret[i] = prefixBuf[i] ^ secretKeyBuf[i % secretKeyBuf.length];
}
console.log(`   Prefix XOR Secret: ${xorSecret.toString('hex')}`);

// Check if it's a timestamp or counter
console.log('\n5. Checking for timestamps/counters...');
const decoded = Buffer.from(segmentPath, 'hex');

// Look for 4-byte values that could be timestamps
for (let i = 0; i < Math.min(decoded.length, 64); i += 4) {
  const val = decoded.readUInt32BE(i);
  const valLE = decoded.readUInt32LE(i);
  
  // Check if it's a reasonable timestamp (2020-2030)
  if (val > 1577836800 && val < 1893456000) {
    console.log(`   Offset ${i}: ${val} (BE) = ${new Date(val * 1000).toISOString()}`);
  }
  if (valLE > 1577836800 && valLE < 1893456000) {
    console.log(`   Offset ${i}: ${valLE} (LE) = ${new Date(valLE * 1000).toISOString()}`);
  }
}

// Check for base64-like patterns
console.log('\n6. Checking character distribution...');
const charFreq = {};
for (const char of segmentPath) {
  charFreq[char] = (charFreq[char] || 0) + 1;
}
const sortedChars = Object.entries(charFreq).sort((a, b) => b[1] - a[1]);
console.log(`   Unique chars: ${Object.keys(charFreq).length}`);
console.log(`   Top chars: ${sortedChars.slice(0, 10).map(([c, n]) => `${c}:${n}`).join(', ')}`);

// Check if it's hex-encoded something else
console.log('\n7. Trying different decodings...');

// Maybe it's double-encoded?
const hexDecoded = Buffer.from(segmentPath, 'hex');
const asUtf8 = hexDecoded.toString('utf8');
console.log(`   As UTF-8: ${asUtf8.substring(0, 50)}...`);

// Check if the hex values are printable ASCII
const printable = [];
for (let i = 0; i < segmentPath.length; i += 2) {
  const byte = parseInt(segmentPath.substring(i, i + 2), 16);
  if (byte >= 32 && byte <= 126) {
    printable.push(String.fromCharCode(byte));
  } else {
    printable.push('.');
  }
}
console.log(`   Printable: ${printable.join('').substring(0, 50)}...`);

// The IV from M3U8
const iv = '303030303030303030303030697a9998';
console.log(`\n8. IV analysis...`);
console.log(`   IV: ${iv}`);
console.log(`   IV decoded: ${Buffer.from(iv, 'hex').toString('ascii')}`);

// The IV looks like "000000000000" + something
const ivPrefix = iv.substring(0, 24);
const ivSuffix = iv.substring(24);
console.log(`   IV prefix: ${ivPrefix} = "${Buffer.from(ivPrefix, 'hex').toString('ascii')}"`);
console.log(`   IV suffix: ${ivSuffix} = ${parseInt(ivSuffix, 16)} (decimal)`);
