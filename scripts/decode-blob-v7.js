#!/usr/bin/env node
/**
 * Extract and run ONLY the string decoder + blob decode from the obfuscated JS.
 * 
 * The obfuscated code has:
 * 1. String array function (_0x4360)
 * 2. String decoder function (_0x4ef1) 
 * 3. Array shuffle IIFE
 * 4. Main code that uses decoded strings
 * 
 * We need to:
 * 1. Extract and run the string array + decoder + shuffle
 * 2. Find which decoded string index corresponds to 'ZpQw9XkLmN8c3vR3'
 * 3. Find the decode function that processes the blob
 */
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('data/embed-44-raw.html', 'utf8');

// Extract the blob value
const blobMatch = html.match(/window\['ZpQw9XkLmN8c3vR3'\]\s*=\s*'([^']+)'/);
const blobValue = blobMatch[1];

// Find the main script
const scripts = [];
const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
let m;
while ((m = scriptRe.exec(html)) !== null) {
  if (m[1].trim().length > 100) scripts.push(m[1]);
}

const mainScript = scripts.find(s => s.length > 100000);
console.log(`Main script: ${mainScript.length} chars`);

// Extract the string array function, decoder, and shuffle
// Pattern: function _0x4360(){...} then function _0x4ef1(...){...} then IIFE shuffle

// Find the string array function
const arrayFuncStart = mainScript.indexOf('function _0x4360()');
if (arrayFuncStart < 0) {
  // Try alternate names
  const altMatch = mainScript.match(/function (_0x[0-9a-f]+)\(\)\{var _0x[0-9a-f]+=\['/);
  if (altMatch) {
    console.log(`Found array function: ${altMatch[1]}`);
  }
}

// The structure is:
// 1. window['ZpQw9XkLmN8c3vR3'] = 'blob';
// 2. (function(_0x4bf306, _0x52aed2) { ... shuffle ... })(_0x4360, 0x55e2d)
// 3. Main IIFE with all the code

// Let me extract everything up to and including the shuffle,
// then add code to decode the blob.

// The shuffle IIFE starts right after the blob assignment
const shuffleStart = mainScript.indexOf('(function(_0x');
if (shuffleStart < 0) {
  console.log('Could not find shuffle IIFE');
  process.exit(1);
}

// Find the end of the shuffle IIFE - it ends with })(_0x4360, 0x55e2d)
// Then the main code starts with !(function(){
const mainCodeStart = mainScript.indexOf('!(function(){');
if (mainCodeStart < 0) {
  console.log('Could not find main code start');
  // Try alternate pattern
  const alt = mainScript.indexOf(",!(function(){'use strict'");
  if (alt >= 0) {
    console.log(`Found main code at offset ${alt}`);
  }
}

// Extract just the setup code (array + decoder + shuffle)
// This is everything before the main IIFE
let setupEnd = mainScript.indexOf(",!(function(){'use strict'");
if (setupEnd < 0) setupEnd = mainScript.indexOf(',!(function(){');
if (setupEnd < 0) {
  console.log('Could not find setup/main boundary');
  process.exit(1);
}

const setupCode = mainScript.substring(0, setupEnd);
console.log(`Setup code: ${setupCode.length} chars`);

// Now we need to find the decoder function name
// It's called like _0x4ef1(0xNNN) or _0x4ef1(0xNNN, 'key')
const decoderMatch = setupCode.match(/const (_0x[0-9a-f]+)=_0x4ef1/);
const decoderName = decoderMatch ? decoderMatch[1] : '_0x4ef1';
console.log(`Decoder function: ${decoderName || '_0x4ef1'}`);

// Create a minimal context and run the setup code
const context = vm.createContext({
  parseInt,
  console: { log: () => {}, warn: () => {}, error: () => {} },
});

try {
  vm.runInContext(setupCode, context, { timeout: 10000 });
  console.log('Setup code executed successfully');
} catch (e) {
  console.log(`Setup error: ${e.message}`);
}

// Now the decoder function should be available
// Let's try to call it to decode strings
const decoderFunc = context._0x4ef1;
if (typeof decoderFunc === 'function') {
  console.log('\nDecoder function is available!');
  
  // Try decoding some indices to find interesting strings
  const interesting = [];
  for (let i = 0; i < 6000; i++) {
    try {
      const decoded = decoderFunc(i + 0x1ef); // offset is 0x1ef
      if (typeof decoded === 'string' && decoded.length > 0) {
        const lower = decoded.toLowerCase();
        if (lower.includes('http') || lower.includes('.sbs') || lower.includes('.cfd') ||
            lower.includes('.xyz') || lower.includes('.fun') || lower.includes('.site') ||
            lower.includes('.cyou') || lower.includes('.ru') || lower.includes('premium') ||
            lower.includes('daddyhd') || lower.includes('daddylive') || lower.includes('eplayer') ||
            lower.includes('auth') || lower.includes('token') || lower.includes('salt') ||
            lower.includes('iframe') || lower.includes('player') || lower.includes('embed') ||
            lower.includes('hls') || lower.includes('m3u8') || lower.includes('key') ||
            lower.includes('decrypt') || lower.includes('encrypt') || lower.includes('crypto') ||
            lower.includes('hmac') || lower.includes('nonce') || lower.includes('fingerprint') ||
            lower.includes('init') || lower.includes('mono.css') || lower.includes('proxy') ||
            lower.includes('server') || lower.includes('channel') || lower.includes('ZpQw')) {
          interesting.push({ idx: i + 0x1ef, hex: '0x' + (i + 0x1ef).toString(16), decoded });
        }
      }
    } catch {}
  }
  
  console.log(`\nFound ${interesting.length} interesting decoded strings:`);
  for (const { hex, decoded } of interesting) {
    console.log(`  [${hex}] "${decoded}"`);
  }
} else {
  console.log('Decoder function not available, trying alternate approach...');
  
  // The decoder might have a different name after the shuffle
  // Let's check what's in the context
  for (const key of Object.keys(context)) {
    if (typeof context[key] === 'function' && key.startsWith('_0x')) {
      console.log(`  Found function: ${key}`);
    }
  }
}

// Also try to find and extract the blob decode logic from the main code
console.log('\n\n=== SEARCHING FOR BLOB DECODE IN MAIN CODE ===');
const mainCode = mainScript.substring(setupEnd + 1);

// Search for 'ZpQw9XkLmN8c3vR3' in the main code (it will be an obfuscated string reference)
// The code will do something like: window[decodedString('ZpQw9XkLmN8c3vR3')]
// We need to find which index decodes to 'ZpQw9XkLmN8c3vR3'

if (typeof decoderFunc === 'function') {
  // Search all indices for 'ZpQw9XkLmN8c3vR3'
  for (let i = 0; i < 6000; i++) {
    try {
      const decoded = decoderFunc(i + 0x1ef);
      if (decoded === 'ZpQw9XkLmN8c3vR3') {
        console.log(`Found 'ZpQw9XkLmN8c3vR3' at index 0x${(i + 0x1ef).toString(16)}`);
      }
    } catch {}
  }
}
