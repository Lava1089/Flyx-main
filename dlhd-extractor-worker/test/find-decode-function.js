/**
 * Find the decode function for ZpQw9XkLmN8c3vR3 config
 * 
 * The obfuscated code uses a string array with hex indices.
 * We need to find where the config is read and decoded.
 */

const fs = require('fs');

// Read the stream page
const html = fs.readFileSync('dlhd-extractor-worker/stream-51-page.html', 'utf8');

// The obfuscated code uses _0x4e0a function to decode strings
// Let's find the string array

// Look for the main string array function
const arrayFuncMatch = html.match(/function\s+(_0x[a-f0-9]+)\s*\(\)\s*\{\s*(?:const|var|let)\s+\w+\s*=\s*\[([^\]]+)\]/);
if (arrayFuncMatch) {
  console.log('Found string array function:', arrayFuncMatch[1]);
  console.log('First 500 chars of array:', arrayFuncMatch[2].substring(0, 500));
}

// Look for the decoder function pattern
// Usually it's: function _0xXXXX(_0xYYYY, _0xZZZZ) { ... return _0xAAAA[_0xYYYY - offset]; }
const decoderPattern = /function\s+(_0x[a-f0-9]+)\s*\(\s*_0x[a-f0-9]+\s*,\s*_0x[a-f0-9]+\s*\)\s*\{[^}]{0,500}return[^}]+\}/g;
let match;
console.log('\n=== Potential decoder functions ===');
while ((match = decoderPattern.exec(html)) !== null) {
  console.log('\nFunction:', match[1]);
  console.log('Body preview:', match[0].substring(0, 200));
}

// Look for where ZpQw9XkLmN8c3vR3 is accessed
console.log('\n=== Config access patterns ===');
const accessPattern = /window\s*\[\s*['"]ZpQw9XkLmN8c3vR3['"]\s*\]/g;
const accesses = html.match(accessPattern);
if (accesses) {
  console.log('Found', accesses.length, 'accesses to config');
}

// Find the context around the config access
const configIdx = html.indexOf("window['ZpQw9XkLmN8c3vR3']");
if (configIdx > 0) {
  // Find the next 2000 chars after the config assignment
  const afterConfig = html.substring(configIdx, configIdx + 3000);
  
  // Look for function calls that might decode it
  const funcCallPattern = /(_0x[a-f0-9]+)\s*\(\s*window\s*\[\s*['"]ZpQw9XkLmN8c3vR3['"]\s*\]/g;
  const funcCalls = afterConfig.match(funcCallPattern);
  if (funcCalls) {
    console.log('\nFunctions called with config:', funcCalls);
  }
}

// The config might be decoded using atob or a custom function
// Let's look for atob usage near the config
console.log('\n=== atob usage ===');
const atobPattern = /atob\s*\([^)]+\)/g;
const atobMatches = html.match(atobPattern);
if (atobMatches) {
  console.log('Found', atobMatches.length, 'atob calls');
  atobMatches.slice(0, 10).forEach((m, i) => console.log(`  ${i + 1}:`, m));
}

// Look for the actual decode logic
// The pattern is usually: decode the string array, then use indices
console.log('\n=== Looking for decode pattern ===');

// Find where the config value is used (not just assigned)
const usePattern = /window\s*\[\s*['"]ZpQw9XkLmN8c3vR3['"]\s*\][^=]/g;
let useMatch;
while ((useMatch = usePattern.exec(html)) !== null) {
  const context = html.substring(useMatch.index, useMatch.index + 200);
  console.log('\nConfig usage context:');
  console.log(context);
}

// The key insight: the obfuscated code likely has a function that:
// 1. Takes the encoded string
// 2. Decodes it using a custom algorithm
// 3. Returns the decoded config object

// Let's look for JSON.parse usage which would indicate config parsing
console.log('\n=== JSON.parse usage ===');
const jsonParsePattern = /JSON\s*\.\s*parse\s*\([^)]+\)/g;
const jsonParseMatches = html.match(jsonParsePattern);
if (jsonParseMatches) {
  console.log('Found', jsonParseMatches.length, 'JSON.parse calls');
  jsonParseMatches.slice(0, 5).forEach((m, i) => console.log(`  ${i + 1}:`, m.substring(0, 100)));
}

// Look for the string that contains stream/server info
console.log('\n=== Searching for stream-related strings ===');
const streamPatterns = [
  /dvalna\.ru/gi,
  /premium\d+/gi,
  /mono\.css/gi,
  /\.m3u8/gi,
  /Bearer/gi,
  /Authorization/gi,
];

for (const pattern of streamPatterns) {
  const matches = html.match(pattern);
  if (matches) {
    console.log(`${pattern.source}: ${matches.length} matches`);
    matches.slice(0, 3).forEach(m => console.log(`  - ${m}`));
  }
}

// The encoded config might contain the stream URL components
// Let's try to find the decode function by looking at the structure

// Look for functions that take a string and return an object
console.log('\n=== Functions that might decode config ===');
const decodeFuncPattern = /function\s+\w+\s*\(\s*\w+\s*\)\s*\{[^}]*(?:JSON\.parse|atob|decode)[^}]*\}/gi;
const decodeFuncs = html.match(decodeFuncPattern);
if (decodeFuncs) {
  decodeFuncs.forEach((f, i) => {
    console.log(`\nDecode function ${i + 1}:`);
    console.log(f.substring(0, 300));
  });
}

// Let's also check if the config is used in a specific way
// by looking at the obfuscated variable names

// Extract all unique obfuscated function names
const funcNames = new Set();
const funcNamePattern = /_0x[a-f0-9]+/g;
let funcMatch;
while ((funcMatch = funcNamePattern.exec(html)) !== null) {
  funcNames.add(funcMatch[0]);
}
console.log('\n=== Obfuscated function count ===');
console.log('Unique obfuscated names:', funcNames.size);

// The decode function is likely one of the first functions defined
// Let's extract the first 10 function definitions
console.log('\n=== First 10 function definitions ===');
const allFuncs = html.match(/function\s+_0x[a-f0-9]+\s*\([^)]*\)\s*\{/g);
if (allFuncs) {
  allFuncs.slice(0, 10).forEach((f, i) => console.log(`${i + 1}: ${f}`));
}
