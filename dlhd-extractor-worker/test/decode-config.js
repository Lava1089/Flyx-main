/**
 * Decode the DLHD ZpQw9XkLmN8c3vR3 config
 * 
 * This config contains the stream configuration including:
 * - Server info
 * - Channel key
 * - Stream URL components
 */

const fs = require('fs');

// Read the stream page
const html = fs.readFileSync('dlhd-extractor-worker/stream-51-page.html', 'utf8');

// Extract the encoded config
const match = html.match(/window\['ZpQw9XkLmN8c3vR3'\]\s*=\s*'([^']+)'/);
if (!match) {
  console.log('Could not find encoded config');
  process.exit(1);
}

const encoded = match[1];
console.log('=== Encoded Config Analysis ===');
console.log('Length:', encoded.length);
console.log('First 100 chars:', encoded.substring(0, 100));

// Analyze character set
const chars = new Set(encoded);
console.log('\nUnique characters:', chars.size);
console.log('Characters:', [...chars].sort().join(''));

// The encoding looks like base64 but with XOR
// Let's try different XOR keys

function xorDecode(str, key) {
  return str.split('').map(c => String.fromCharCode(c.charCodeAt(0) ^ key)).join('');
}

function xorDecodeWithKey(str, keyStr) {
  return str.split('').map((c, i) => 
    String.fromCharCode(c.charCodeAt(0) ^ keyStr.charCodeAt(i % keyStr.length))
  ).join('');
}

// Try single-byte XOR keys
console.log('\n=== Single-byte XOR attempts ===');
for (let key = 0; key < 256; key++) {
  const decoded = xorDecode(encoded, key);
  // Check if result looks like valid base64 or JSON
  if (/^[A-Za-z0-9+/=]+$/.test(decoded.substring(0, 50))) {
    console.log(`Key 0x${key.toString(16)}: Looks like base64`);
    try {
      const b64decoded = Buffer.from(decoded, 'base64').toString('utf8');
      if (b64decoded.includes('{') || b64decoded.includes('http')) {
        console.log('  -> Decoded:', b64decoded.substring(0, 200));
      }
    } catch (e) {}
  }
  if (decoded.includes('http') || decoded.includes('.m3u8') || decoded.includes('stream')) {
    console.log(`Key 0x${key.toString(16)}: Contains stream data!`);
    console.log('  ->', decoded.substring(0, 200));
  }
}

// The encoding might be a custom substitution cipher
// Let's look at the obfuscated JS to find the decode function

// Search for decode patterns in the HTML
console.log('\n=== Looking for decode function ===');

// Look for atob usage (base64 decode)
const atobMatches = html.match(/atob\s*\([^)]+\)/g);
if (atobMatches) {
  console.log('atob calls:', atobMatches.length);
  atobMatches.slice(0, 5).forEach(m => console.log(' ', m.substring(0, 100)));
}

// Look for the string that references ZpQw9XkLmN8c3vR3
const refPattern = /ZpQw9XkLmN8c3vR3[^;]{0,500}/g;
const refs = html.match(refPattern);
if (refs) {
  console.log('\nReferences to config:');
  refs.forEach(r => console.log(' ', r.substring(0, 200)));
}

// The obfuscated code uses a string array with hex indices
// Let's find the _0x3f5a array (or similar)
const arrayPattern = /function\s+_0x[a-f0-9]+\s*\(\)\s*\{\s*(?:const|var|let)\s+[^=]+=\s*\[/;
const arrayMatch = html.match(arrayPattern);
if (arrayMatch) {
  console.log('\nFound string array function at index:', arrayMatch.index);
}

// Try a different approach - the config might be decoded using a key from the page
// Look for any hardcoded keys
const keyPatterns = [
  /['"]([a-f0-9]{16,64})['"]/gi,  // Hex strings
  /secret['":\s]+['"]([^'"]+)['"]/gi,  // Secret values
  /key['":\s]+['"]([^'"]+)['"]/gi,  // Key values
];

console.log('\n=== Potential keys in HTML ===');
for (const pattern of keyPatterns) {
  const matches = html.matchAll(pattern);
  for (const m of matches) {
    if (m[1].length >= 8 && m[1].length <= 64) {
      console.log(`${pattern.source}: ${m[1]}`);
    }
  }
}

// The encoding appears to be a custom base64 with XOR
// Let's try the standard approach: decode base64 first, then XOR

console.log('\n=== Base64 + XOR attempts ===');

// First, try standard base64 decode
try {
  const b64decoded = Buffer.from(encoded, 'base64');
  console.log('Base64 decoded length:', b64decoded.length);
  console.log('First 50 bytes (hex):', b64decoded.slice(0, 50).toString('hex'));
  
  // Try XOR with common keys
  for (let key = 0; key < 256; key++) {
    const xored = Buffer.from(b64decoded.map(b => b ^ key));
    const str = xored.toString('utf8');
    if (str.includes('{') && str.includes('}')) {
      console.log(`\nXOR key 0x${key.toString(16)} produces JSON-like:`);
      console.log(str.substring(0, 300));
    }
    if (str.includes('http') || str.includes('m3u8')) {
      console.log(`\nXOR key 0x${key.toString(16)} produces URL:`);
      console.log(str.substring(0, 300));
    }
  }
} catch (e) {
  console.log('Base64 decode failed:', e.message);
}

// Try URL-safe base64
console.log('\n=== URL-safe Base64 attempt ===');
const urlSafeEncoded = encoded.replace(/-/g, '+').replace(/_/g, '/');
try {
  const decoded = Buffer.from(urlSafeEncoded, 'base64');
  console.log('Decoded length:', decoded.length);
  console.log('First 100 chars:', decoded.toString('utf8').substring(0, 100));
} catch (e) {
  console.log('URL-safe base64 failed:', e.message);
}

// The config might use a rotating XOR key
console.log('\n=== Rotating XOR attempts ===');
const commonKeys = [
  'ZpQw9XkLmN8c3vR3',  // The variable name itself
  'dlhd',
  'stream',
  'premium',
  '444c44cc8888888844444444',  // HMAC secret from fast-extractor
];

for (const keyStr of commonKeys) {
  const decoded = xorDecodeWithKey(encoded, keyStr);
  if (decoded.includes('http') || decoded.includes('{')) {
    console.log(`Key "${keyStr}": Found data!`);
    console.log(decoded.substring(0, 200));
  }
  
  // Also try base64 decode after XOR
  try {
    const b64 = Buffer.from(decoded, 'base64').toString('utf8');
    if (b64.includes('http') || b64.includes('{')) {
      console.log(`Key "${keyStr}" + base64: Found data!`);
      console.log(b64.substring(0, 200));
    }
  } catch (e) {}
}

// Let's also look at what the obfuscated code does with the config
console.log('\n=== Searching for config usage pattern ===');

// The config is likely accessed via window['ZpQw9XkLmN8c3vR3']
// and then decoded using some function

// Look for patterns like: someFunc(window['ZpQw9XkLmN8c3vR3'])
const usagePattern = /\w+\s*\(\s*window\s*\[\s*['"]ZpQw9XkLmN8c3vR3['"]\s*\]/g;
const usages = html.match(usagePattern);
if (usages) {
  console.log('Config usage patterns:');
  usages.forEach(u => console.log(' ', u));
}

// The actual decode might happen in the obfuscated code
// Let's extract the first few function definitions
console.log('\n=== First function definitions ===');
const funcPattern = /function\s+_0x[a-f0-9]+\s*\([^)]*\)\s*\{[^}]{0,200}/g;
const funcs = html.match(funcPattern);
if (funcs) {
  funcs.slice(0, 5).forEach((f, i) => {
    console.log(`\nFunction ${i + 1}:`);
    console.log(f.substring(0, 150));
  });
}
