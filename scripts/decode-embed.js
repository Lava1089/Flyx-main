#!/usr/bin/env node
/**
 * Decode the obfuscated DaddyLive embed page to find:
 * 1. Current player domain (where auth/EPlayerAuth is fetched from)
 * 2. CDN/proxy domains for M3U8 and keys
 * 3. Auth flow (EPlayerAuth.init pattern)
 */

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'data', 'embed-44-raw.html'), 'utf8');

// Step 1: Extract the string array
// The obfuscator uses a function like _0x4360() that returns an array of encoded strings
const arrayFuncMatch = html.match(/function _0x4360\(\)\{[^[]*?\[([\s\S]*?)\];/);
if (!arrayFuncMatch) {
  console.log('ERROR: Could not find string array function');
  process.exit(1);
}

// Parse the string array
const rawArray = arrayFuncMatch[1];
const strings = [];
const strRegex = /'([^']*)'/g;
let m;
while ((m = strRegex.exec(rawArray)) !== null) {
  strings.push(m[1]);
}
console.log(`Found ${strings.length} strings in lookup array\n`);

// Step 2: Decode the strings - they use base64 with atob
// The obfuscator encodes strings as base64
const decoded = strings.map(s => {
  try {
    return Buffer.from(s, 'base64').toString('utf8');
  } catch {
    return s; // Not base64, return as-is
  }
});

// Step 3: Search for interesting strings
console.log('=== DOMAINS ===');
const domainPattern = /^[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?\.(sbs|xyz|fun|cfd|site|com|ru|cyou|top|net|io|live|dad|mp|sx|link|click|my|one|pw)$/;
decoded.forEach((s, i) => {
  if (domainPattern.test(s)) console.log(`  [${i}] ${s}`);
});

console.log('\n=== URLs ===');
decoded.forEach((s, i) => {
  if (s.startsWith('http') || s.startsWith('//')) console.log(`  [${i}] ${s}`);
});

console.log('\n=== AUTH/KEY RELATED ===');
const authKeywords = ['auth', 'token', 'salt', 'key', 'EPlayer', 'init', 'premium', 'daddyhd', 'premiumtv', 'mono.css', 'proxy', 'server_lookup', 'channel', 'Bearer', 'HMAC', 'SHA', 'MD5', 'nonce', 'fingerprint', 'captcha', 'recaptcha', 'whitelist'];
decoded.forEach((s, i) => {
  const lower = s.toLowerCase();
  for (const kw of authKeywords) {
    if (lower.includes(kw.toLowerCase())) {
      console.log(`  [${i}] ${s}`);
      break;
    }
  }
});

console.log('\n=== PLAYER/IFRAME RELATED ===');
const playerKeywords = ['iframe', 'player', 'embed', 'src', 'hls', 'm3u8', 'video', 'stream'];
decoded.forEach((s, i) => {
  const lower = s.toLowerCase();
  for (const kw of playerKeywords) {
    if (lower === kw || (lower.includes(kw) && s.length < 100)) {
      console.log(`  [${i}] ${s}`);
      break;
    }
  }
});

console.log('\n=== CRYPTO RELATED ===');
const cryptoKeywords = ['encrypt', 'decrypt', 'xor', 'cipher', 'aes', 'hmac', 'hash', 'digest', 'subtle', 'crypto'];
decoded.forEach((s, i) => {
  const lower = s.toLowerCase();
  for (const kw of cryptoKeywords) {
    if (lower.includes(kw)) {
      console.log(`  [${i}] ${s}`);
      break;
    }
  }
});

// Step 4: Also decode the window[] encoded blob
const blobMatch = html.match(/window\['([^']+)'\]='([^']+)'/);
if (blobMatch) {
  const key = blobMatch[1];
  const val = blobMatch[2];
  console.log(`\n=== ENCODED BLOB ===`);
  console.log(`Key: ${key}`);
  console.log(`Value length: ${val.length}`);
  
  // Try standard base64
  try {
    const decoded64 = Buffer.from(val, 'base64').toString('utf8');
    if (decoded64.length > 0 && !decoded64.includes('\ufffd')) {
      console.log(`Base64 decoded: ${decoded64.substring(0, 500)}`);
    } else {
      console.log('Not standard base64 (contains replacement chars)');
    }
  } catch {
    console.log('Not standard base64');
  }
  
  // Try XOR with common keys
  const valBytes = Buffer.from(val, 'base64');
  for (let xorKey = 1; xorKey < 256; xorKey++) {
    const xored = Buffer.from(valBytes.map(b => b ^ xorKey));
    const str = xored.toString('utf8');
    if (str.includes('http') || str.includes('.sbs') || str.includes('.com') || str.includes('premium')) {
      console.log(`XOR key ${xorKey}: ${str.substring(0, 300)}`);
      break;
    }
  }
}

// Step 5: Look for the encoded blob key in the string array to find how it's used
console.log('\n=== BLOB KEY USAGE ===');
if (blobMatch) {
  const blobKey = blobMatch[1];
  decoded.forEach((s, i) => {
    if (s === blobKey || s.includes(blobKey)) {
      console.log(`  [${i}] ${s}`);
    }
  });
}
