#!/usr/bin/env node
/**
 * Extract the string array, decoder, and shuffle from the obfuscated JS.
 * Run them to get the decoder function, then search for blob-related strings.
 */
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('data/embed-44-raw.html', 'utf8');
const blobMatch = html.match(/window\['ZpQw9XkLmN8c3vR3'\]\s*=\s*'([^']+)'/);
const blobValue = blobMatch[1];

// Find the main script block (the huge one)
const scripts = [];
const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
let m;
while ((m = scriptRe.exec(html)) !== null) {
  if (m[1].trim().length > 100) scripts.push(m[1].trim());
}

// The blob + obfuscated code is in one script block
const mainScript = scripts.find(s => s.includes('ZpQw9XkLmN8c3vR3') && s.length > 10000);
console.log(`Main script: ${mainScript ? mainScript.length : 0} chars`);

if (!mainScript) {
  console.log('Scripts found:', scripts.map(s => s.length));
  process.exit(1);
}

// The script structure is:
// window['ZpQw9XkLmN8c3vR3']='...';
// (function(_0xARRAY_PARAM, _0xTARGET) { 
//   const _0xDECODER_ALIAS = _0x4ef1;
//   const _0xARRAY_REF = _0xARRAY_PARAM();
//   while(true) { try { ... if(sum === target) break; else rotate; } catch { rotate; } }
// })(_0x4360, 0x55e2d),
// !(function() { 'use strict'; ... MAIN CODE ... })()

// Step 1: Extract the string array function
// It's defined BEFORE this script block, in a separate script
// Let's find it
const allScripts = [];
const allScriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
while ((m = allScriptRe.exec(html)) !== null) {
  allScripts.push(m[1].trim());
}

// Find the script with the array function
const arrayScript = allScripts.find(s => s.includes('function _0x4360') || s.includes("function _0x4ef1"));
if (arrayScript && arrayScript !== mainScript) {
  console.log(`Array script: ${arrayScript.length} chars (separate block)`);
}

// Actually, in the embed page, the array function might be in the same script
// or a preceding one. Let me check.
const hasArrayFunc = mainScript.includes('_0x4360');
const hasDecoderFunc = mainScript.includes('_0x4ef1');
console.log(`Main script has _0x4360: ${hasArrayFunc}, _0x4ef1: ${hasDecoderFunc}`);

// The array function and decoder are likely in a PRECEDING script block
// Let's find them
let arrayFuncCode = '';
let decoderFuncCode = '';

for (const s of allScripts) {
  if (s.includes('function _0x4360')) {
    // Extract the function
    const start = s.indexOf('function _0x4360');
    // Find the matching closing brace
    let depth = 0;
    let end = start;
    for (let i = start; i < s.length; i++) {
      if (s[i] === '{') depth++;
      if (s[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    arrayFuncCode = s.substring(start, end);
    console.log(`Found _0x4360: ${arrayFuncCode.length} chars`);
  }
  if (s.includes('function _0x4ef1')) {
    const start = s.indexOf('function _0x4ef1');
    let depth = 0;
    let end = start;
    for (let i = start; i < s.length; i++) {
      if (s[i] === '{') depth++;
      if (s[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    decoderFuncCode = s.substring(start, end);
    console.log(`Found _0x4ef1: ${decoderFuncCode.length} chars`);
  }
}

if (!arrayFuncCode) {
  console.log('Array function not found in any script block');
  // It might be defined inline. Let me search the full HTML
  const fullArrayMatch = html.match(/(function _0x4360\(\)\{var _0x[0-9a-f]+=\[[\s\S]*?\];return _0x4360=function\(\)\{return _0x[0-9a-f]+;\},_0x4360\(\);\})/);
  if (fullArrayMatch) {
    arrayFuncCode = fullArrayMatch[1];
    console.log(`Found _0x4360 in full HTML: ${arrayFuncCode.length} chars`);
  }
}

if (!decoderFuncCode) {
  console.log('Decoder function not found in any script block');
  const fullDecoderMatch = html.match(/(function _0x4ef1\([^)]*\)\{[\s\S]*?return _0x4ef1\([^)]*\);\})/);
  if (fullDecoderMatch) {
    decoderFuncCode = fullDecoderMatch[1];
    console.log(`Found _0x4ef1 in full HTML: ${decoderFuncCode.length} chars`);
  }
}

// Now extract the shuffle IIFE from the main script
// Pattern: (function(_0xXXX, _0xYYY) { ... })(_0x4360, 0x55e2d)
const shuffleMatch = mainScript.match(/\(function\((_0x[0-9a-f]+),\s*(_0x[0-9a-f]+)\)\{const (_0x[0-9a-f]+)=_0x4ef1[\s\S]*?\}\)\(_0x4360,\s*(0x[0-9a-f]+)\)/);
let shuffleCode = '';
if (shuffleMatch) {
  shuffleCode = shuffleMatch[0];
  console.log(`Found shuffle IIFE: ${shuffleCode.length} chars, target: ${shuffleMatch[4]}`);
}

// Combine and execute
if (arrayFuncCode && decoderFuncCode) {
  const fullSetup = arrayFuncCode + '\n' + decoderFuncCode + '\n' + (shuffleCode ? shuffleCode + ';' : '');
  console.log(`\nFull setup code: ${fullSetup.length} chars`);
  
  const context = vm.createContext({
    parseInt,
    String,
    Array,
    Object,
    console: { log: (...args) => {}, warn: () => {}, error: () => {} },
  });
  
  try {
    vm.runInContext(fullSetup, context, { timeout: 30000 });
    console.log('Setup executed successfully!');
    
    const decoder = context._0x4ef1;
    if (typeof decoder === 'function') {
      console.log('Decoder function available!');
      
      // Decode ALL strings and search for interesting ones
      const results = [];
      for (let i = 0; i < 6000; i++) {
        try {
          const idx = i + 0x1ef;
          const decoded = decoder(idx);
          if (typeof decoded === 'string' && decoded.length > 0) {
            results.push({ idx, decoded });
          }
        } catch {}
      }
      
      console.log(`\nDecoded ${results.length} strings total`);
      
      // Search for domains, URLs, and key terms
      console.log('\n=== DOMAINS & URLs ===');
      for (const { idx, decoded } of results) {
        if (/\.(sbs|cfd|xyz|fun|site|cyou|ru|com|net|io|live|dad|top|pw|click|my|sx)/.test(decoded) ||
            decoded.startsWith('http') || decoded.startsWith('//')) {
          console.log(`  [0x${idx.toString(16)}] "${decoded}"`);
        }
      }
      
      console.log('\n=== AUTH/KEY/PLAYER ===');
      const keywords = ['auth', 'token', 'salt', 'eplayer', 'premium', 'daddyhd', 'premiumtv',
        'mono', 'proxy', 'server', 'channel', 'bearer', 'hmac', 'nonce', 'fingerprint',
        'captcha', 'recaptcha', 'iframe', 'player', 'embed', 'hls', 'm3u8', 'init',
        'decrypt', 'encrypt', 'crypto', 'ZpQw', 'atob', 'btoa', 'fromCharCode',
        'charCodeAt', 'src', 'href'];
      for (const { idx, decoded } of results) {
        const lower = decoded.toLowerCase();
        if (keywords.some(kw => lower.includes(kw.toLowerCase())) && decoded.length < 200) {
          console.log(`  [0x${idx.toString(16)}] "${decoded}"`);
        }
      }
      
      // Find 'ZpQw9XkLmN8c3vR3'
      console.log('\n=== BLOB KEY ===');
      for (const { idx, decoded } of results) {
        if (decoded === 'ZpQw9XkLmN8c3vR3' || decoded.includes('ZpQw')) {
          console.log(`  [0x${idx.toString(16)}] "${decoded}"`);
        }
      }
    }
  } catch (e) {
    console.log(`Execution error: ${e.message}`);
    console.log(e.stack?.split('\n').slice(0, 5).join('\n'));
  }
} else {
  console.log('\nCould not extract required functions');
  console.log(`Array func: ${arrayFuncCode.length} chars`);
  console.log(`Decoder func: ${decoderFuncCode.length} chars`);
}
