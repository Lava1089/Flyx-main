/**
 * Extract and analyze the decoder function from DLHD stream page
 * 
 * The obfuscator uses:
 * - _0x3f5a: String array function
 * - _0x4e0a: Decoder function that maps indices to strings
 */

const fs = require('fs');

// Read the stream page
const html = fs.readFileSync('dlhd-extractor-worker/stream-51-page.html', 'utf8');

// Extract the string array
const arrayMatch = html.match(/function\s+_0x3f5a\s*\(\)\s*\{\s*(?:const|var|let)\s+(\w+)\s*=\s*\[([^\]]+)\]/);
if (!arrayMatch) {
  console.log('Could not find string array');
  process.exit(1);
}

// Parse the string array
const arrayContent = arrayMatch[2];
const strings = [];

// Extract strings from the array (they're base64 encoded)
const stringPattern = /'([^']+)'/g;
let strMatch;
while ((strMatch = stringPattern.exec(arrayContent)) !== null) {
  strings.push(strMatch[1]);
}

console.log('=== String Array Analysis ===');
console.log('Total strings:', strings.length);
console.log('First 20 strings:');
strings.slice(0, 20).forEach((s, i) => {
  // Try to decode as base64
  try {
    const decoded = Buffer.from(s, 'base64').toString('utf8');
    console.log(`  ${i}: "${s}" -> "${decoded}"`);
  } catch (e) {
    console.log(`  ${i}: "${s}" (not base64)`);
  }
});

// Look for stream-related strings
console.log('\n=== Stream-related strings ===');
strings.forEach((s, i) => {
  try {
    const decoded = Buffer.from(s, 'base64').toString('utf8');
    if (decoded.includes('stream') || decoded.includes('m3u8') || 
        decoded.includes('dvalna') || decoded.includes('premium') ||
        decoded.includes('Bearer') || decoded.includes('Authorization') ||
        decoded.includes('http') || decoded.includes('mono')) {
      console.log(`  ${i}: "${decoded}"`);
    }
  } catch (e) {}
});

// The decoder function _0x4e0a uses an offset
// Let's find the offset
const decoderMatch = html.match(/function\s+_0x4e0a\s*\([^)]+\)\s*\{[^}]+_0x4e0aca\s*=\s*_0x4e0aca\s*-\s*(0x[a-f0-9]+)/);
if (decoderMatch) {
  const offset = parseInt(decoderMatch[1], 16);
  console.log('\n=== Decoder offset ===');
  console.log('Offset:', offset, `(0x${offset.toString(16)})`);
}

// Now let's look at how the config is used
// The config ZpQw9XkLmN8c3vR3 is likely decoded using a specific function

// Search for where the config variable is read (not assigned)
console.log('\n=== Config usage ===');
const configUsagePattern = /window\s*\[\s*['"]ZpQw9XkLmN8c3vR3['"]\s*\](?!\s*=)/g;
let usageMatch;
let usageCount = 0;
while ((usageMatch = configUsagePattern.exec(html)) !== null) {
  usageCount++;
  const context = html.substring(usageMatch.index - 50, usageMatch.index + 150);
  console.log(`\nUsage ${usageCount}:`);
  console.log(context);
}

// The config is likely used in a function that decodes it
// Let's look for the pattern: someFunc(window['ZpQw9XkLmN8c3vR3'])
const funcCallPattern = /(\w+)\s*\(\s*window\s*\[\s*['"]ZpQw9XkLmN8c3vR3['"]\s*\]/g;
console.log('\n=== Functions called with config ===');
let funcMatch;
while ((funcMatch = funcCallPattern.exec(html)) !== null) {
  console.log('Function:', funcMatch[1]);
  // Find the function definition
  const funcDefPattern = new RegExp(`function\\s+${funcMatch[1]}\\s*\\([^)]*\\)\\s*\\{[^}]{0,500}`);
  const funcDef = html.match(funcDefPattern);
  if (funcDef) {
    console.log('Definition:', funcDef[0].substring(0, 200));
  }
}

// The encoded config might be decoded using a custom XOR or base64 variant
// Let's analyze the encoded string more carefully

const encodedConfig = html.match(/window\['ZpQw9XkLmN8c3vR3'\]\s*=\s*'([^']+)'/)[1];
console.log('\n=== Encoded Config Analysis ===');
console.log('Length:', encodedConfig.length);

// Check if it's a modified base64
// Standard base64 uses: A-Z, a-z, 0-9, +, /, =
// URL-safe base64 uses: A-Z, a-z, 0-9, -, _, =
const chars = new Set(encodedConfig);
console.log('Unique chars:', chars.size);
console.log('Has +:', encodedConfig.includes('+'));
console.log('Has /:', encodedConfig.includes('/'));
console.log('Has -:', encodedConfig.includes('-'));
console.log('Has _:', encodedConfig.includes('_'));
console.log('Has =:', encodedConfig.includes('='));

// The encoding might be a simple XOR with a key derived from the page
// Let's try to find the key

// Look for any hardcoded keys in the obfuscated code
console.log('\n=== Looking for decode key ===');
const keyPatterns = [
  /['"]([A-Za-z0-9]{16,32})['"]/g,  // Alphanumeric keys
  /key\s*[=:]\s*['"]([^'"]+)['"]/gi,  // Key assignments
  /secret\s*[=:]\s*['"]([^'"]+)['"]/gi,  // Secret assignments
];

const foundKeys = new Set();
for (const pattern of keyPatterns) {
  let keyMatch;
  while ((keyMatch = pattern.exec(html)) !== null) {
    if (keyMatch[1].length >= 8 && keyMatch[1].length <= 64) {
      foundKeys.add(keyMatch[1]);
    }
  }
}

console.log('Found potential keys:', foundKeys.size);
[...foundKeys].slice(0, 20).forEach(k => console.log(`  - ${k}`));

// The config might be decoded using a function that's called on page load
// Let's look for DOMContentLoaded or window.onload handlers
console.log('\n=== Page load handlers ===');
const loadPatterns = [
  /DOMContentLoaded/g,
  /window\.onload/g,
  /addEventListener\s*\(\s*['"]load['"]/g,
];

for (const pattern of loadPatterns) {
  const matches = html.match(pattern);
  if (matches) {
    console.log(`${pattern.source}: ${matches.length} matches`);
  }
}
