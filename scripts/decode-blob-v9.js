#!/usr/bin/env node
/**
 * The decoder function _0x4ef1 takes (index, rc4Key).
 * Without the RC4 key, we get truncated strings.
 * 
 * Let's extract all calls to the decoder with their RC4 keys from the main code,
 * then decode them properly.
 */
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('data/embed-44-raw.html', 'utf8');

// Extract array function and decoder
const arrayMatch = html.match(/(function _0x4360\(\)\{var _0x[0-9a-f]+=\[[\s\S]*?\];return _0x4360=function\(\)\{return _0x[0-9a-f]+;\},_0x4360\(\);\})/);
const decoderMatch = html.match(/(function _0x4ef1\([^)]*\)\{[\s\S]*?return _0x4ef1\([^)]*\);\})/);

if (!arrayMatch || !decoderMatch) {
  console.log('Could not extract functions');
  process.exit(1);
}

// Extract shuffle
const shuffleMatch = html.match(/(\(function\(_0x[0-9a-f]+,_0x[0-9a-f]+\)\{const _0x[0-9a-f]+=_0x4ef1[\s\S]*?\}\)\(_0x4360,0x[0-9a-f]+\))/);

const setupCode = arrayMatch[1] + '\n' + decoderMatch[1] + '\n' + (shuffleMatch ? shuffleMatch[1] + ';' : '');

const context = vm.createContext({
  parseInt, String, Array, Object, Number, Boolean, RegExp, Math, Date, JSON,
  encodeURIComponent, decodeURIComponent, escape, unescape, isNaN, isFinite,
  console: { log: () => {}, warn: () => {}, error: () => {} },
});

vm.runInContext(setupCode, context, { timeout: 30000 });
const decoder = context._0x4ef1;

if (typeof decoder !== 'function') {
  console.log('Decoder not available');
  process.exit(1);
}

console.log('Decoder ready!');

// Now find all calls to the decoder alias in the main code
// The main code uses an alias like: const _0x35db1e = _0x4ef1;
// Then calls: _0x35db1e(0xNNN, 'key')

// Find the main script
const mainScriptMatch = html.match(/window\['ZpQw9XkLmN8c3vR3'\]='[^']+';([\s\S]+)$/);
const mainScript = mainScriptMatch ? mainScriptMatch[1] : '';

// Find all decoder calls with RC4 keys
// Pattern: _0xHEXNAME(0xHEX, 'KEY') or _0xHEXNAME(0xHEX)
// The alias names vary: _0x35db1e, _0x48d8d0, _0xfeabd6, etc.

// First, find all alias assignments
const aliasPattern = /const (_0x[0-9a-f]+)=_0x4ef1/g;
const aliases = new Set();
let am;
while ((am = aliasPattern.exec(mainScript)) !== null) {
  aliases.add(am[1]);
}
// Also find: var _0xXXX = _0x4ef1
const aliasPattern2 = /(?:var|let)\s+(_0x[0-9a-f]+)\s*=\s*_0x4ef1/g;
while ((am = aliasPattern2.exec(mainScript)) !== null) {
  aliases.add(am[1]);
}

console.log(`Found ${aliases.size} decoder aliases: ${[...aliases].join(', ')}`);

// Now find all calls to these aliases
const allCalls = new Map(); // idx -> { idx, key, decoded }

for (const alias of aliases) {
  // Escape the alias for regex
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  // Match calls with RC4 key: alias(0xHEX, 'KEY')
  const callPattern = new RegExp(escaped + "\\((0x[0-9a-f]+)\\s*,\\s*'([^']*)'\\)", 'g');
  let cm;
  while ((cm = callPattern.exec(mainScript)) !== null) {
    const idx = parseInt(cm[1]);
    const key = cm[2];
    if (!allCalls.has(`${idx}_${key}`)) {
      try {
        const decoded = decoder(idx, key);
        allCalls.set(`${idx}_${key}`, { idx, key, decoded });
      } catch {}
    }
  }
  
  // Also match calls without RC4 key: alias(0xHEX)
  const callPattern2 = new RegExp(escaped + "\\((0x[0-9a-f]+)\\)(?!\\s*,\\s*')", 'g');
  while ((cm = callPattern2.exec(mainScript)) !== null) {
    const idx = parseInt(cm[1]);
    if (!allCalls.has(`${idx}_`)) {
      try {
        const decoded = decoder(idx);
        allCalls.set(`${idx}_`, { idx, key: null, decoded });
      } catch {}
    }
  }
}

console.log(`\nDecoded ${allCalls.size} unique calls`);

// Filter for interesting strings
const interesting = [];
for (const [, { idx, key, decoded }] of allCalls) {
  if (typeof decoded !== 'string') continue;
  const lower = decoded.toLowerCase();
  
  // Domains and URLs
  if (/\.(sbs|cfd|xyz|fun|site|cyou|ru|com|net|io|live|dad|top|pw|click|my|sx)/.test(decoded) ||
      decoded.startsWith('http') || decoded.startsWith('//') ||
      lower.includes('auth') || lower.includes('token') || lower.includes('salt') ||
      lower.includes('eplayer') || lower.includes('premium') || lower.includes('daddyhd') ||
      lower.includes('premiumtv') || lower.includes('mono') || lower.includes('proxy') ||
      lower.includes('server') || lower.includes('channel') || lower.includes('bearer') ||
      lower.includes('hmac') || lower.includes('nonce') || lower.includes('fingerprint') ||
      lower.includes('iframe') || lower.includes('player') || lower.includes('embed') ||
      lower.includes('hls') || lower.includes('m3u8') || lower.includes('init') ||
      lower.includes('decrypt') || lower.includes('encrypt') || lower.includes('crypto') ||
      lower.includes('zpqw') || lower.includes('atob') || lower.includes('btoa') ||
      lower.includes('fromcharcode') || lower.includes('charcodeat') ||
      lower.includes('src') || lower.includes('href') || lower.includes('.php') ||
      lower.includes('key') || lower.includes('secret') || lower.includes('hash') ||
      lower.includes('sign') || lower.includes('digest') || lower.includes('subtle') ||
      lower.includes('xor') || lower.includes('cipher') || lower.includes('aes') ||
      lower.includes('base64') || lower.includes('decode') || lower.includes('encode')) {
    interesting.push({ idx, key, decoded });
  }
}

// Sort by index
interesting.sort((a, b) => a.idx - b.idx);

console.log(`\n=== ${interesting.length} INTERESTING STRINGS ===`);
for (const { idx, key, decoded } of interesting) {
  console.log(`  [0x${idx.toString(16)}] key="${key || ''}" -> "${decoded}"`);
}

// Also dump ALL decoded strings to a file for analysis
const allDecoded = [...allCalls.values()]
  .filter(v => typeof v.decoded === 'string')
  .sort((a, b) => a.idx - b.idx);

console.log(`\nTotal decoded strings: ${allDecoded.length}`);
console.log('Writing all decoded strings to data/decoded-strings.txt...');

let output = '';
for (const { idx, key, decoded } of allDecoded) {
  output += `[0x${idx.toString(16)}] key="${key || ''}" -> "${decoded}"\n`;
}
fs.writeFileSync('data/decoded-strings.txt', output);
console.log('Done!');
